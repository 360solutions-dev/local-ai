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
RAG_SERVICE_URL = os.environ["RAG_SERVICE_URL"]
RAG_API_KEY = os.environ.get("RAG_API_KEY", "")

# Whisper speech-to-text service (separate Docker container)
WHISPER_SERVICE_URL = os.environ["WHISPER_SERVICE_URL"]
WHISPER_API_KEY = os.environ.get("WHISPER_API_KEY", "")
# 10 MB cap on uploaded audio — enough for ~10 minutes of opus, well beyond
# any reasonable chat-input voice clip.
TRANSCRIBE_MAX_BYTES = 10 * 1024 * 1024

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
        turn_id = serializer.validated_data.get("turn_id") or str(uuid.uuid4())

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

        # Look up chat provider from ModelConfig for routing
        provider_base_url = None
        provider_type = None
        try:
            from system.models import ModelConfig
            config = ModelConfig.get_or_create_singleton()
            if config.chat_provider:
                provider = config.chat_provider
                provider_base_url = provider.endpoint.rstrip("/")
                provider_type = provider.type
                if not model:
                    model = config.chat_model or None

                # Resolve Docker hostnames for container-to-container comms
                from urllib.parse import urlparse
                parsed = urlparse(provider_base_url)
                hostname = parsed.hostname or ""
                port = parsed.port or (443 if parsed.scheme == "https" else 80)
                docker_map = {
                    ("localhost", 11434): "ollama",
                    ("127.0.0.1", 11434): "ollama",
                }
                docker_host = docker_map.get((hostname, port))
                if docker_host:
                    provider_base_url = f"{parsed.scheme}://{docker_host}:{port}"
        except Exception:
            pass  # Fall back to RAG defaults

        try:
            rag_url = urljoin(RAG_SERVICE_URL, "/api/ask")
            payload = {"question": content}
            if model:
                payload["model"] = model
            if provider_base_url:
                payload["base_url"] = provider_base_url
            if provider_type:
                payload["provider_type"] = provider_type
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


# Recommended embedding models for document indexing (Ollama library names, without :latest)
RECOMMENDED_EMBEDDING_MODELS = (
    "nomic-embed-text",
    "mxbai-embed-large",
    "snowflake-arctic-embed",
    "all-minilm",
)


def _normalize_model_base(name: str) -> str:
    if not name:
        return ""
    return name.split(":")[0].strip().lower()


def _ollama_tags_list():
    ollama_url = os.environ.get("OLLAMA_HOST", "http://ollama:11434")
    resp = requests.get(f"{ollama_url.rstrip('/')}/api/tags", timeout=8)
    resp.raise_for_status()
    return resp.json().get("models", [])


class EmbeddingModelsStatusView(APIView):
    """Report whether the configured embedding model is present in Ollama."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from system.models import ModelConfig

        config = ModelConfig.get_or_create_singleton()
        configured = (config.embedding_model or "").strip() or "nomic-embed-text"
        base_want = _normalize_model_base(configured)

        try:
            tags = _ollama_tags_list()
        except Exception as e:
            return Response(
                {
                    "configured_embedding_model": configured,
                    "installed": False,
                    "installed_embedding_models": [],
                    "recommended": list(RECOMMENDED_EMBEDDING_MODELS),
                    "error": str(e),
                }
            )

        installed_embedding = []
        for m in tags:
            name = m.get("name", "")
            if "embed" in name.lower():
                size_bytes = m.get("size", 0)
                size_gb = round(size_bytes / (1024 ** 3), 2) if size_bytes else 0
                label = f"{size_gb} GB" if size_gb >= 0.01 else f"{max(1, round(size_bytes / (1024 ** 2)))} MB"
                installed_embedding.append({"name": name, "size": label})

        installed = any(_normalize_model_base(m.get("name", "")) == base_want for m in tags)

        return Response(
            {
                "configured_embedding_model": configured,
                "installed": installed,
                "installed_embedding_models": installed_embedding,
                "recommended": list(RECOMMENDED_EMBEDDING_MODELS),
            }
        )


class ModelListAllView(APIView):
    """List all Ollama models including embeddings (Model Engines downloaded table)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            rag_url = urljoin(RAG_SERVICE_URL, "/api/models/all")
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
                        decoded = line.decode().strip()
                        # Ensure proper SSE format: "data: ...\n\n"
                        if decoded.startswith("data: "):
                            yield decoded + "\n\n"
                        else:
                            yield f"data: {decoded}\n\n"
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
        _ensure_tables()
        with connection.cursor() as cur:
            cur.execute("DELETE FROM messages WHERE id = %s RETURNING id", [message_id])
            deleted = cur.fetchone()
        if not deleted:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Message not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response({"message": "Message deleted."})


class TurnDeleteView(APIView):
    """Delete all messages (user + assistant) for a single turn.

    Used by the Stop button to remove the user message and any partial/completed
    assistant message that the backend may have persisted after the client aborted.
    """

    permission_classes = [IsAuthenticated]

    def delete(self, request, turn_id):
        _ensure_tables()
        with connection.cursor() as cur:
            cur.execute(
                "DELETE FROM messages WHERE turn_id = %s RETURNING id",
                [turn_id],
            )
            deleted_count = len(cur.fetchall())
        return Response({"deleted": deleted_count})


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
        from system.models import InstanceSettings

        uploaded_file = request.FILES.get("file")
        if not uploaded_file:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "No file provided."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Enforce file size limit
        settings_obj = InstanceSettings.get_or_create_singleton()
        max_bytes = settings_obj.max_file_size_mb * 1024 * 1024
        if uploaded_file.size > max_bytes:
            return Response(
                {
                    "error": {
                        "code": "FILE_TOO_LARGE",
                        "message": f"File exceeds the {settings_obj.max_file_size_mb} MB limit.",
                    }
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Enforce max files per chat limit
        if settings_obj.max_files_per_chat > 0:
            try:
                rag_url = urljoin(RAG_SERVICE_URL, "/api/files")
                resp = requests.get(rag_url, headers=_rag_headers(), timeout=10)
                resp.raise_for_status()
                current_count = len(resp.json().get("files", []))
                if current_count >= settings_obj.max_files_per_chat:
                    return Response(
                        {
                            "error": {
                                "code": "FILE_LIMIT_REACHED",
                                "message": f"Maximum of {settings_obj.max_files_per_chat} files allowed.",
                            }
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            except Exception:
                pass  # Don't block upload if count check fails

        try:
            from system.models import ModelConfig

            config = ModelConfig.get_or_create_singleton()
            embedding_model = (config.embedding_model or "").strip() or "nomic-embed-text"

            rag_url = urljoin(RAG_SERVICE_URL, "/api/files/upload")
            files = {"file": (uploaded_file.name, uploaded_file.read(), uploaded_file.content_type)}
            data = {"embedding_model": embedding_model}
            resp = requests.post(rag_url, files=files, data=data, headers=_rag_headers(), timeout=300)
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


class TranscribeAudioView(APIView):
    """Proxy a recorded audio blob to the local whisper container.

    The frontend records the user's voice with MediaRecorder and POSTs the
    resulting blob here as multipart/form-data under the field name "audio".
    We forward the bytes to the whisper service (offline, runs locally) and
    return its transcription. Auth and request size limits live here so the
    whisper service stays a simple internal-only worker.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        uploaded = request.FILES.get("audio")
        if not uploaded:
            return Response(
                {"error": {"code": "MISSING_AUDIO", "message": "No audio file provided."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if uploaded.size and uploaded.size > TRANSCRIBE_MAX_BYTES:
            return Response(
                {"error": {"code": "AUDIO_TOO_LARGE", "message": "Audio recording is too large."}},
                status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            )

        headers = {}
        if WHISPER_API_KEY:
            headers["X-API-Key"] = WHISPER_API_KEY

        # Optional language hint forwarded as a query param when the caller
        # provides one (e.g. derived from the UI locale).
        params = {}
        language = request.data.get("language")
        if language:
            params["language"] = language

        try:
            files = {
                "audio": (
                    uploaded.name or "audio.webm",
                    uploaded.read(),
                    uploaded.content_type or "audio/webm",
                ),
            }
            resp = requests.post(
                urljoin(WHISPER_SERVICE_URL, "/transcribe"),
                files=files,
                headers=headers,
                params=params,
                timeout=120,
            )
            resp.raise_for_status()
            return Response(resp.json())
        except requests.HTTPError as e:
            logger.warning("Whisper service returned %s: %s", e.response.status_code, e.response.text[:200])
            return Response(
                {"error": {"code": "TRANSCRIBE_FAILED", "message": "Transcription service rejected the request."}},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except requests.RequestException as e:
            logger.exception("Whisper service unreachable")
            return Response(
                {"error": {"code": "TRANSCRIBE_UNAVAILABLE", "message": str(e)}},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
