"""Chat API views — thin REST layer over the existing RAG conversation tables."""

import json
import logging
import os
import uuid
from urllib.parse import urljoin

import requests
from django.db import connection
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import CreateConversationSerializer, RenameConversationSerializer, SendMessageSerializer

logger = logging.getLogger(__name__)

# RAG service URL (runs in a separate Docker container)
RAG_SERVICE_URL = os.environ.get("RAG_SERVICE_URL", "http://localhost:8080")
RAG_API_KEY = os.environ.get("RAG_API_KEY", "")

def _rag_headers():
    """Return headers for RAG service requests, including API key auth."""
    headers = {}
    if RAG_API_KEY:
        headers["X-API-Key"] = RAG_API_KEY
    return headers


# ---------------------------------------------------------------------------
# SQL helpers (same pattern as system/rag_queries.py)
# ---------------------------------------------------------------------------

def _table_exists(table_name: str) -> bool:
    with connection.cursor() as cur:
        cur.execute(
            "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = %s)",
            [table_name],
        )
        return cur.fetchone()[0]


def _ensure_tables():
    """Create conversations/messages tables if they don't exist yet."""
    with connection.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS conversations (
                id SERIAL PRIMARY KEY,
                title VARCHAR(255),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                sources TEXT,
                conversation_id INT REFERENCES conversations(id),
                turn_id UUID,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )


def _row_to_message(row):
    """Convert a DB row tuple to a message dict."""
    sources_raw = row[3]
    if sources_raw:
        try:
            sources = json.loads(sources_raw)
        except (json.JSONDecodeError, TypeError):
            sources = sources_raw
    else:
        sources = None
    return {
        "id": row[0],
        "role": row[1],
        "content": row[2],
        "sources": sources,
        "turn_id": str(row[4]) if row[4] else None,
        "created_at": row[5].isoformat() if row[5] else None,
    }


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------

class ConversationListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        """List all conversations (newest first)."""
        _ensure_tables()
        with connection.cursor() as cur:
            cur.execute(
                "SELECT id, title, created_at FROM conversations ORDER BY created_at DESC"
            )
            conversations = [
                {
                    "id": row[0],
                    "title": row[1] or "Untitled",
                    "created_at": row[2].isoformat() if row[2] else None,
                }
                for row in cur.fetchall()
            ]
        return Response({"conversations": conversations})

    def post(self, request):
        """Create a new conversation."""
        serializer = CreateConversationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        title = serializer.validated_data.get("title") or None

        _ensure_tables()
        with connection.cursor() as cur:
            cur.execute(
                "INSERT INTO conversations (title, created_at) VALUES (%s, NOW()) RETURNING id, title, created_at",
                [title],
            )
            row = cur.fetchone()
        conversation = {
            "id": row[0],
            "title": row[1] or "Untitled",
            "created_at": row[2].isoformat() if row[2] else None,
        }
        return Response({"conversation": conversation}, status=status.HTTP_201_CREATED)


class ConversationDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, conversation_id):
        """Rename a conversation."""
        serializer = RenameConversationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        title = serializer.validated_data["title"]
        _ensure_tables()
        with connection.cursor() as cur:
            cur.execute(
                "UPDATE conversations SET title = %s WHERE id = %s RETURNING id, title, created_at",
                [title, conversation_id],
            )
            row = cur.fetchone()
        if not row:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Conversation not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response({
            "conversation": {"id": row[0], "title": row[1] or "Untitled", "created_at": row[2].isoformat()},
        })

    def delete(self, request, conversation_id):
        """Delete a conversation and all its messages."""
        _ensure_tables()
        with connection.cursor() as cur:
            cur.execute("DELETE FROM messages WHERE conversation_id = %s", [conversation_id])
            cur.execute("DELETE FROM conversations WHERE id = %s RETURNING id", [conversation_id])
            deleted = cur.fetchone()
        if not deleted:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Conversation not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response({"message": "Conversation deleted."})


class ConversationMessagesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, conversation_id):
        """Retrieve all messages for a conversation."""
        _ensure_tables()
        with connection.cursor() as cur:
            cur.execute(
                "SELECT id, role, content, sources, turn_id, created_at "
                "FROM messages WHERE conversation_id = %s ORDER BY created_at ASC",
                [conversation_id],
            )
            messages = [_row_to_message(row) for row in cur.fetchall()]
        return Response({"messages": messages})

    def post(self, request, conversation_id):
        """Send a message: save user message, generate AI response, return both."""
        serializer = SendMessageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        content = serializer.validated_data["content"]
        turn_id = str(uuid.uuid4())

        _ensure_tables()

        # Verify conversation exists
        with connection.cursor() as cur:
            cur.execute("SELECT id FROM conversations WHERE id = %s", [conversation_id])
            if not cur.fetchone():
                return Response(
                    {"error": {"code": "NOT_FOUND", "message": "Conversation not found."}},
                    status=status.HTTP_404_NOT_FOUND,
                )

        # Save user message
        with connection.cursor() as cur:
            cur.execute(
                "INSERT INTO messages (role, content, sources, conversation_id, turn_id, created_at) "
                "VALUES ('user', %s, NULL, %s, %s, NOW()) "
                "RETURNING id, role, content, sources, turn_id, created_at",
                [content, conversation_id, turn_id],
            )
            user_msg = _row_to_message(cur.fetchone())

        # Auto-title conversation from first user message
        with connection.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM messages WHERE conversation_id = %s AND role = 'user'",
                [conversation_id],
            )
            user_count = cur.fetchone()[0]
            if user_count == 1:
                title = content[:80] + ("..." if len(content) > 80 else "")
                cur.execute(
                    "UPDATE conversations SET title = %s WHERE id = %s",
                    [title, conversation_id],
                )

        # Generate AI response via RAG service (separate container)
        model = serializer.validated_data.get("model") or None
        file_filter = serializer.validated_data.get("file_filter") or None
        ai_error = None
        try:
            rag_url = urljoin(RAG_SERVICE_URL, "/api/ask")
            payload = {"question": content}
            if model:
                payload["model"] = model
            if file_filter:
                payload["file_filter"] = file_filter
            resp = requests.post(rag_url, json=payload, headers=_rag_headers(), timeout=300)
            resp.raise_for_status()
            rag_data = resp.json()
            answer = rag_data.get("answer", "No response from RAG service.")
            sources = rag_data.get("sources", [])
            if rag_data.get("error"):
                ai_error = rag_data["error"]
        except Exception as e:
            logger.exception("RAG service call failed")
            answer = "I encountered an error generating a response. Please try again later."
            sources = []
            ai_error = str(e)

        # Save assistant message
        sources_json = json.dumps(sources) if sources else None
        with connection.cursor() as cur:
            cur.execute(
                "INSERT INTO messages (role, content, sources, conversation_id, turn_id, created_at) "
                "VALUES ('assistant', %s, %s, %s, %s, NOW()) "
                "RETURNING id, role, content, sources, turn_id, created_at",
                [answer, sources_json, conversation_id, turn_id],
            )
            assistant_msg = _row_to_message(cur.fetchone())

        response_data = {
            "user_message": user_msg,
            "assistant_message": assistant_msg,
        }
        if ai_error:
            response_data["ai_error"] = ai_error

        return Response(response_data, status=status.HTTP_201_CREATED)


class ModelListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        """List installed Ollama models."""
        try:
            rag_url = urljoin(RAG_SERVICE_URL, "/api/models")
            resp = requests.get(rag_url, headers=_rag_headers(), timeout=10)
            resp.raise_for_status()
            return Response(resp.json())
        except Exception as e:
            return Response({"models": [], "error": str(e)})


class ModelPullView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        """Pull a model from Ollama — streams SSE progress."""
        from django.http import StreamingHttpResponse

        name = request.data.get("name")
        if not name:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "Model name required."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        def stream():
            try:
                rag_url = urljoin(RAG_SERVICE_URL, "/api/models/pull")
                resp = requests.post(rag_url, json={"name": name}, headers=_rag_headers(), timeout=600, stream=True)
                resp.raise_for_status()
                for line in resp.iter_lines():
                    if line:
                        yield line.decode() + "\n"
            except Exception as e:
                yield f"data: {json.dumps({'status': 'error', 'error': str(e)})}\n\n"

        response = StreamingHttpResponse(stream(), content_type="text/event-stream")
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response


class ModelDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, model_name):
        """Delete a model from Ollama."""
        try:
            rag_url = urljoin(RAG_SERVICE_URL, f"/api/models/{model_name}")
            resp = requests.delete(rag_url, headers=_rag_headers(), timeout=30)
            resp.raise_for_status()
            return Response(resp.json())
        except Exception as e:
            logger.exception("Model delete failed")
            return Response(
                {"error": {"code": "DELETE_ERROR", "message": str(e)}},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class MessageDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, message_id):
        """Delete a single message."""
        with connection.cursor() as cur:
            cur.execute("DELETE FROM messages WHERE id = %s RETURNING id", [message_id])
            deleted = cur.fetchone()
        if not deleted:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Message not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response({"message": "Message deleted."})


# ---------------------------------------------------------------------------
# File management (proxy to RAG service)
# ---------------------------------------------------------------------------

class FileListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        """List indexed files."""
        try:
            rag_url = urljoin(RAG_SERVICE_URL, "/api/files")
            resp = requests.get(rag_url, headers=_rag_headers(), timeout=10)
            resp.raise_for_status()
            return Response(resp.json())
        except Exception as e:
            return Response({"files": [], "error": str(e)})


class FileUploadView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        """Upload a file to the RAG service for indexing."""
        uploaded_file = request.FILES.get("file")
        if not uploaded_file:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "No file provided."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            rag_url = urljoin(RAG_SERVICE_URL, "/api/files/upload")
            files = {"file": (uploaded_file.name, uploaded_file.read(), uploaded_file.content_type)}
            resp = requests.post(rag_url, files=files, headers=_rag_headers(), timeout=300)
            resp.raise_for_status()
            data = resp.json()
            if "error" in data:
                return Response(
                    {"error": {"code": "PROCESSING_ERROR", "message": data["error"]}},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            return Response(data, status=status.HTTP_201_CREATED)
        except Exception as e:
            logger.exception("File upload to RAG failed")
            return Response(
                {"error": {"code": "UPLOAD_ERROR", "message": str(e)}},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class FileDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, file_id):
        """Delete a file from the index."""
        try:
            rag_url = urljoin(RAG_SERVICE_URL, f"/api/files/{file_id}")
            resp = requests.delete(rag_url, headers=_rag_headers(), timeout=10)
            resp.raise_for_status()
            return Response(resp.json())
        except Exception as e:
            return Response(
                {"error": {"code": "DELETE_ERROR", "message": str(e)}},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
