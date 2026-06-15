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

from .serializers import (
    ConversationFileUploadSerializer,
    CreateConversationSerializer,
    RenameConversationSerializer,
    SendMessageSerializer,
)

logger = logging.getLogger(__name__)

# RAG service URL (runs in a separate Docker container)
RAG_SERVICE_URL = os.environ["RAG_SERVICE_URL"]
RAG_API_KEY = os.environ.get("RAG_API_KEY", "")

# Where each Ollama engine lives, so the UI can choose to install/delete a model
# on the host machine (GPU/Metal, fast) or inside the Docker container (CPU).
# Overridable via env; defaults match the compose service + host gateway.
OLLAMA_MACHINE_URL = os.environ.get("OLLAMA_MACHINE_URL", "http://host.docker.internal:11434")
OLLAMA_DOCKER_URL = os.environ.get("OLLAMA_DOCKER_URL", "http://ollama:11434")


def _resolve_ollama_target(target):
    """Map a UI placement choice ("machine" | "docker") to an Ollama base URL.
    Returns None for any other value so the RAG service falls back to its own
    configured OLLAMA_BASE_URL (the placement chosen at install time)."""
    if target == "machine":
        return OLLAMA_MACHINE_URL
    if target == "docker":
        return OLLAMA_DOCKER_URL
    return None

# Sentinel file_filter for chats that have NO attached files. Passing None
# would let RAG search the ENTIRE index (every chat's documents), leaking
# other conversations' files. This value matches no real filename, so RAG
# retrieves zero document chunks and the model answers without context.
_NO_FILES_FILTER = "\x00__no_files__\x00"

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
    """Create conversations/messages/chat_files tables if they don't exist yet."""
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
        # Pin / archive support (added after initial release — ADD COLUMN
        # IF NOT EXISTS makes this safe to run on existing databases).
        cur.execute("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE")
        cur.execute("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE")
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
        # Which model generated each assistant message (added after initial
        # release — shown next to the response. NULL for older rows / user msgs).
        cur.execute("ALTER TABLE messages ADD COLUMN IF NOT EXISTS model TEXT")
        # Per-chat file association. ON DELETE CASCADE means deleting a
        # conversation removes its file links automatically. The RAG-side
        # vector data is deleted out-of-band by FileDeleteView / on chat
        # delete (see ConversationDeleteView).
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_files (
                id SERIAL PRIMARY KEY,
                conversation_id INT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                file_id VARCHAR(255) NOT NULL,
                file_name VARCHAR(500) NOT NULL,
                file_size BIGINT NOT NULL DEFAULT 0,
                chunks INT NOT NULL DEFAULT 0,
                indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(conversation_id, file_id)
            )
            """
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_chat_files_conv ON chat_files(conversation_id)"
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
        "model": row[6] if len(row) > 6 else None,
    }


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------

class ConversationListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        """List conversations with cursor pagination.

        Default view excludes archived chats and orders pinned ones first.
        Pinned chats all appear on the first page (they're few); subsequent
        cursor pages contain only non-pinned recents so nothing duplicates.
        Pass ?archived=true to list the archived chats instead.
        """
        _ensure_tables()
        cursor = request.query_params.get("cursor")
        limit = min(int(request.query_params.get("limit", 30)), 100)
        show_archived = request.query_params.get("archived") == "true"

        with connection.cursor() as cur:
            if show_archived:
                cur.execute(
                    "SELECT id, title, created_at, pinned, archived FROM conversations "
                    "WHERE archived = TRUE "
                    + ("AND created_at < %s " if cursor else "")
                    + "ORDER BY created_at DESC LIMIT %s",
                    ([cursor, limit + 1] if cursor else [limit + 1]),
                )
            elif cursor:
                # Cursor pages: non-pinned recents only (pinned already shown on page 1).
                cur.execute(
                    "SELECT id, title, created_at, pinned, archived FROM conversations "
                    "WHERE archived = FALSE AND pinned = FALSE AND created_at < %s "
                    "ORDER BY created_at DESC LIMIT %s",
                    [cursor, limit + 1],
                )
            else:
                # First page: pinned first, then recents.
                cur.execute(
                    "SELECT id, title, created_at, pinned, archived FROM conversations "
                    "WHERE archived = FALSE "
                    "ORDER BY pinned DESC, created_at DESC LIMIT %s",
                    [limit + 1],
                )
            rows = cur.fetchall()

        has_more = len(rows) > limit
        rows = rows[:limit]
        conversations = [
            {
                "id": row[0],
                "title": row[1] or "Untitled",
                "created_at": row[2].isoformat() if row[2] else None,
                "pinned": bool(row[3]),
                "archived": bool(row[4]),
            }
            for row in rows
        ]
        next_cursor = conversations[-1]["created_at"] if has_more and conversations else None
        return Response({
            "conversations": conversations,
            "next_cursor": next_cursor,
            "has_more": has_more,
        })

    def post(self, request):
        """Create a new conversation."""
        serializer = CreateConversationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        title = serializer.validated_data.get("title") or None

        _ensure_tables()
        with connection.cursor() as cur:
            cur.execute(
                "INSERT INTO conversations (title, created_at) VALUES (%s, NOW()) "
                "RETURNING id, title, created_at, pinned, archived",
                [title],
            )
            row = cur.fetchone()
        conversation = {
            "id": row[0],
            "title": row[1] or "Untitled",
            "created_at": row[2].isoformat() if row[2] else None,
            "pinned": bool(row[3]),
            "archived": bool(row[4]),
        }
        return Response({"conversation": conversation}, status=status.HTTP_201_CREATED)


class ConversationDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, conversation_id):
        """Update a conversation: rename and/or toggle pinned / archived.

        Accepts any subset of {title, pinned, archived}. Renaming still works
        as before; pin/archive are partial updates from the sidebar menu.
        """
        _ensure_tables()

        set_clauses = []
        params = []
        if "title" in request.data:
            serializer = RenameConversationSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            set_clauses.append("title = %s")
            params.append(serializer.validated_data["title"])
        if "pinned" in request.data:
            set_clauses.append("pinned = %s")
            params.append(bool(request.data.get("pinned")))
        if "archived" in request.data:
            set_clauses.append("archived = %s")
            params.append(bool(request.data.get("archived")))

        if not set_clauses:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "Nothing to update."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        params.append(conversation_id)
        with connection.cursor() as cur:
            cur.execute(
                f"UPDATE conversations SET {', '.join(set_clauses)} WHERE id = %s "
                "RETURNING id, title, created_at, pinned, archived",
                params,
            )
            row = cur.fetchone()
        if not row:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Conversation not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response({
            "conversation": {
                "id": row[0],
                "title": row[1] or "Untitled",
                "created_at": row[2].isoformat() if row[2] else None,
                "pinned": bool(row[3]),
                "archived": bool(row[4]),
            },
        })

    def delete(self, request, conversation_id):
        """Delete a conversation, its messages, and any linked RAG files.

        chat_files rows are removed via ON DELETE CASCADE. The underlying
        RAG vector data is deleted out-of-band (best-effort) so that
        deleting a chat fully reclaims its file storage.
        """
        _ensure_tables()
        with connection.cursor() as cur:
            cur.execute(
                "SELECT file_id FROM chat_files WHERE conversation_id = %s",
                [conversation_id],
            )
            file_ids_to_purge = [row[0] for row in cur.fetchall()]
            cur.execute("DELETE FROM messages WHERE conversation_id = %s", [conversation_id])
            cur.execute("DELETE FROM conversations WHERE id = %s RETURNING id", [conversation_id])
            deleted = cur.fetchone()

        if not deleted:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Conversation not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Best-effort RAG cleanup. chat_files rows are already gone via CASCADE.
        for fid in file_ids_to_purge:
            try:
                requests.delete(
                    urljoin(RAG_SERVICE_URL, f"/api/files/{fid}"),
                    headers=_rag_headers(),
                    timeout=10,
                )
            except Exception:
                logger.warning("RAG cleanup failed for orphaned file %s after chat %s delete", fid, conversation_id)

        return Response({"message": "Conversation deleted."})


class ConversationDuplicateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, conversation_id):
        """Duplicate a conversation including all its messages.

        Files are global to the user (not per-conversation in this app), so
        message-level file references via `sources` are copied verbatim.
        Fresh turn_ids are generated to avoid joining duplicated turns to the
        original.
        """
        _ensure_tables()
        with connection.cursor() as cur:
            cur.execute(
                "SELECT title FROM conversations WHERE id = %s",
                [conversation_id],
            )
            row = cur.fetchone()
            if not row:
                return Response(
                    {"error": {"code": "NOT_FOUND", "message": "Conversation not found."}},
                    status=status.HTTP_404_NOT_FOUND,
                )
            original_title = row[0] or "Untitled"
            new_title = f"{original_title} (copy)"[:255]

            cur.execute(
                "INSERT INTO conversations (title, created_at) VALUES (%s, NOW()) "
                "RETURNING id, title, created_at",
                [new_title],
            )
            new_row = cur.fetchone()
            new_id = new_row[0]

            cur.execute(
                "SELECT role, content, sources, turn_id, created_at FROM messages "
                "WHERE conversation_id = %s ORDER BY id ASC",
                [conversation_id],
            )
            old_messages = cur.fetchall()

            turn_id_map: dict = {}
            for role, content, sources, turn_id, created_at in old_messages:
                if turn_id is not None:
                    if turn_id not in turn_id_map:
                        cur.execute("SELECT gen_random_uuid()")
                        turn_id_map[turn_id] = cur.fetchone()[0]
                    new_turn_id = turn_id_map[turn_id]
                else:
                    new_turn_id = None
                cur.execute(
                    "INSERT INTO messages (role, content, sources, conversation_id, turn_id, created_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s)",
                    [role, content, sources, new_id, new_turn_id, created_at],
                )

        conversation = {
            "id": new_row[0],
            "title": new_row[1] or "Untitled",
            "created_at": new_row[2].isoformat() if new_row[2] else None,
        }
        return Response({"conversation": conversation}, status=status.HTTP_201_CREATED)


class ConversationMessagesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, conversation_id):
        """Retrieve messages for a conversation with cursor pagination.

        Returns the most recent messages first (paginate backwards in time).
        Use ?cursor=<id> to load older messages before the given message id.
        Response messages are sorted ascending (oldest first) for display.
        """
        _ensure_tables()
        cursor = request.query_params.get("cursor")
        limit = min(int(request.query_params.get("limit", 50)), 200)

        with connection.cursor() as cur:
            if cursor:
                # Load messages older than the cursor (smaller id)
                cur.execute(
                    "SELECT id, role, content, sources, turn_id, created_at, model "
                    "FROM messages WHERE conversation_id = %s AND id < %s "
                    "ORDER BY id DESC LIMIT %s",
                    [conversation_id, cursor, limit + 1],
                )
            else:
                # Load the most recent messages
                cur.execute(
                    "SELECT id, role, content, sources, turn_id, created_at, model "
                    "FROM messages WHERE conversation_id = %s "
                    "ORDER BY id DESC LIMIT %s",
                    [conversation_id, limit + 1],
                )
            rows = cur.fetchall()

        has_more = len(rows) > limit
        rows = rows[:limit]
        # Reverse so messages are in chronological order (oldest first)
        rows.reverse()
        messages = [_row_to_message(row) for row in rows]
        next_cursor = messages[0]["id"] if has_more and messages else None
        return Response({
            "messages": messages,
            "next_cursor": next_cursor,
            "has_more": has_more,
        })

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
        # The frontend may pass file_filter to constrain answers to specific
        # files (e.g., user typed "@filename"). We always intersect the
        # request's file_filter with the conversation's file scope to prevent
        # cross-chat citation leaks. If the user didn't pass anything, we
        # scope to ALL files attached to this chat.
        user_file_filter = serializer.validated_data.get("file_filter") or None
        with connection.cursor() as cur:
            cur.execute(
                "SELECT file_name FROM chat_files WHERE conversation_id = %s",
                [conversation_id],
            )
            chat_file_names = {row[0] for row in cur.fetchall()}

        if user_file_filter:
            # Intersect requested filter with this chat's files only.
            requested = {n.strip() for n in user_file_filter.split(",") if n.strip()}
            allowed = requested & chat_file_names
            file_filter = ",".join(sorted(allowed)) if allowed else _NO_FILES_FILTER
        elif chat_file_names:
            file_filter = ",".join(sorted(chat_file_names))
        else:
            # No files in this chat — scope to nothing so RAG doesn't fall back
            # to searching every other chat's documents.
            file_filter = _NO_FILES_FILTER

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
            from system.models import ModelConfig
            mc = ModelConfig.get_or_create_singleton()
            active_embedding_model = (mc.embedding_model or "").strip() or None
        except Exception:
            active_embedding_model = None

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
            if active_embedding_model:
                payload["embedding_model"] = active_embedding_model
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
                "INSERT INTO messages (role, content, sources, conversation_id, turn_id, created_at, model) "
                "VALUES ('assistant', %s, %s, %s, %s, NOW(), %s) "
                "RETURNING id, role, content, sources, turn_id, created_at, model",
                [answer, sources_json, conversation_id, turn_id, model],
            )
            assistant_msg = _row_to_message(cur.fetchone())

        response_data = {
            "user_message": user_msg,
            "assistant_message": assistant_msg,
        }
        if ai_error:
            response_data["ai_error"] = ai_error

        return Response(response_data, status=status.HTTP_201_CREATED)


def _resolve_rag_payload(conversation_id, content, model, user_file_filter):
    """Build the RAG /api/ask payload, mirroring the blocking SendMessage path.

    Returns the payload dict ready to POST to the RAG service. Handles
    per-chat file scoping, provider routing (Docker hostname resolution),
    and the active embedding model — shared by both the blocking and
    streaming chat endpoints.
    """
    # Per-chat file scoping (intersect request filter with this chat's files)
    with connection.cursor() as cur:
        cur.execute(
            "SELECT file_name FROM chat_files WHERE conversation_id = %s",
            [conversation_id],
        )
        chat_file_names = {row[0] for row in cur.fetchall()}

    if user_file_filter:
        requested = {n.strip() for n in user_file_filter.split(",") if n.strip()}
        allowed = requested & chat_file_names
        file_filter = ",".join(sorted(allowed)) if allowed else _NO_FILES_FILTER
    elif chat_file_names:
        file_filter = ",".join(sorted(chat_file_names))
    else:
        # No files in this chat — scope to nothing so RAG doesn't fall back
        # to searching every other chat's documents.
        file_filter = _NO_FILES_FILTER

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
        pass

    try:
        from system.models import ModelConfig
        mc = ModelConfig.get_or_create_singleton()
        active_embedding_model = (mc.embedding_model or "").strip() or None
    except Exception:
        active_embedding_model = None

    payload = {"question": content}
    if model:
        payload["model"] = model
    if provider_base_url:
        payload["base_url"] = provider_base_url
    if provider_type:
        payload["provider_type"] = provider_type
    if file_filter:
        payload["file_filter"] = file_filter
    if active_embedding_model:
        payload["embedding_model"] = active_embedding_model
    return payload


class MessageStreamView(APIView):
    """Streaming chat: save the user message, proxy the RAG token stream to the
    browser as SSE, accumulate the answer, and persist the assistant message
    when the stream completes. The frontend renders tokens as they arrive so
    the user sees the answer building instead of staring at "Thinking...".
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, conversation_id):
        from django.http import StreamingHttpResponse

        serializer = SendMessageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        content = serializer.validated_data["content"]
        turn_id = serializer.validated_data.get("turn_id") or str(uuid.uuid4())
        model = serializer.validated_data.get("model") or None
        user_file_filter = serializer.validated_data.get("file_filter") or None

        _ensure_tables()

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

        # Auto-title from first user message
        with connection.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM messages WHERE conversation_id = %s AND role = 'user'",
                [conversation_id],
            )
            if cur.fetchone()[0] == 1:
                title = content[:80] + ("..." if len(content) > 80 else "")
                cur.execute(
                    "UPDATE conversations SET title = %s WHERE id = %s",
                    [title, conversation_id],
                )

        payload = _resolve_rag_payload(conversation_id, content, model, user_file_filter)
        resolved_model = payload.get("model")

        def event_stream():
            # First, hand the client the saved user message + turn id so it can
            # reconcile its optimistic bubble.
            yield f"data: {json.dumps({'user_message': user_msg})}\n\n"

            answer_parts = []
            sources = []
            had_error = None
            try:
                rag_url = urljoin(RAG_SERVICE_URL, "/api/ask/stream")
                resp = requests.post(
                    rag_url, json=payload, headers=_rag_headers(),
                    timeout=300, stream=True,
                )
                resp.raise_for_status()
                for line in resp.iter_lines():
                    if not line:
                        continue
                    decoded = line.decode("utf-8").strip()
                    if not decoded.startswith("data: "):
                        continue
                    data_str = decoded[len("data: "):]
                    try:
                        data = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue
                    if "sources" in data and isinstance(data["sources"], list):
                        sources = data["sources"]
                    if "token" in data:
                        answer_parts.append(data["token"])
                        yield f"data: {json.dumps({'token': data['token']})}\n\n"
                    if data.get("error"):
                        had_error = data["error"]
                    if data.get("done"):
                        break
            except Exception as e:
                logger.exception("Streaming RAG call failed")
                had_error = str(e)

            answer = "".join(answer_parts).strip()
            if not answer:
                answer = "I encountered an error generating a response. Please try again later."

            # Persist the assistant message now that the full answer is known.
            sources_json = json.dumps(sources) if sources else None
            try:
                with connection.cursor() as cur:
                    cur.execute(
                        "INSERT INTO messages (role, content, sources, conversation_id, turn_id, created_at, model) "
                        "VALUES ('assistant', %s, %s, %s, %s, NOW(), %s) "
                        "RETURNING id, role, content, sources, turn_id, created_at, model",
                        [answer, sources_json, conversation_id, turn_id, resolved_model],
                    )
                    assistant_msg = _row_to_message(cur.fetchone())
            except Exception:
                logger.exception("Failed to save streamed assistant message")
                assistant_msg = {
                    "id": None, "role": "assistant", "content": answer,
                    "sources": sources, "turn_id": turn_id, "created_at": None,
                    "model": resolved_model,
                }

            done_payload = {"done": True, "assistant_message": assistant_msg, "sources": sources}
            if had_error:
                done_payload["ai_error"] = had_error
            yield f"data: {json.dumps(done_payload)}\n\n"

        response = StreamingHttpResponse(event_stream(), content_type="text/event-stream")
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response


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

        # Optional placement: "machine" (host Ollama) or "docker" (container).
        # Omitted → RAG uses its default engine (the install-time choice).
        target_base_url = _resolve_ollama_target(request.data.get("target"))

        def stream():
            try:
                rag_url = urljoin(RAG_SERVICE_URL, "/api/models/pull")
                payload = {"name": name}
                if target_base_url:
                    payload["base_url"] = target_base_url
                resp = requests.post(rag_url, json=payload, headers=_rag_headers(), timeout=600, stream=True)
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
        """Delete a model from Ollama. Optional ?target=machine|docker selects
        which engine to delete from."""
        try:
            rag_url = urljoin(RAG_SERVICE_URL, f"/api/models/{model_name}")
            target_base_url = _resolve_ollama_target(request.query_params.get("target"))
            params = {"base_url": target_base_url} if target_base_url else None
            resp = requests.delete(rag_url, headers=_rag_headers(), params=params, timeout=30)
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
        """List indexed files for a specific conversation.

        Query params:
          - conversation_id (required): integer chat id

        Returns only files linked to that chat via chat_files. If the param
        is missing or invalid, returns an empty list (no global file access).
        """
        _ensure_tables()

        # scope=all → every file across all chats (distinct by file_id), for
        # the dashboard's total-files count. Default stays per-chat scoped.
        if request.query_params.get("scope") == "all":
            with connection.cursor() as cur:
                cur.execute(
                    """
                    SELECT DISTINCT ON (file_id) file_id, file_name, file_size, chunks, indexed_at
                    FROM chat_files
                    ORDER BY file_id, indexed_at DESC
                    """
                )
                rows = cur.fetchall()
            files = [
                {
                    "id": row[0],
                    "name": row[1],
                    "size": row[2],
                    "chunks": row[3],
                    "indexed_at": row[4].isoformat() if row[4] else None,
                }
                for row in rows
            ]
            return Response({"files": files})

        cid_raw = request.query_params.get("conversation_id")
        if not cid_raw:
            return Response({"files": []})
        try:
            conversation_id = int(cid_raw)
        except (TypeError, ValueError):
            return Response({"files": []})

        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT file_id, file_name, file_size, chunks, indexed_at
                FROM chat_files
                WHERE conversation_id = %s
                ORDER BY indexed_at DESC
                """,
                [conversation_id],
            )
            rows = cur.fetchall()

        files = [
            {
                "id": row[0],
                "name": row[1],
                "size": row[2],
                "chunks": row[3],
                "indexed_at": row[4].isoformat() if row[4] else None,
                "type": (row[1].rsplit(".", 1)[-1] if "." in row[1] else ""),
            }
            for row in rows
        ]
        return Response({"files": files})


class FileUploadView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        """Upload a file to the RAG service and link it to a conversation.

        Flow:
          1. Validate file + conversation_id
          2. Enforce size/count limits (count is per-chat now)
          3. Upload to RAG
          4. Insert chat_files row
          5. If step 4 fails, attempt to clean up the RAG file (best-effort)
        """
        from system.models import InstanceSettings

        # Validate conversation_id from form data
        cid_serializer = ConversationFileUploadSerializer(data=request.data)
        if not cid_serializer.is_valid():
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "conversation_id is required and must be a positive integer."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        conversation_id = cid_serializer.validated_data["conversation_id"]

        uploaded_file = request.FILES.get("file")
        if not uploaded_file:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "No file provided."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if uploaded_file.size == 0:
            return Response(
                {"error": {"code": "EMPTY_FILE", "message": "The uploaded file is empty. Please choose a non-empty file."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        _ensure_tables()

        # Confirm the conversation exists (prevents orphan chat_files rows)
        with connection.cursor() as cur:
            cur.execute("SELECT id FROM conversations WHERE id = %s", [conversation_id])
            if not cur.fetchone():
                return Response(
                    {"error": {"code": "NOT_FOUND", "message": "Conversation not found."}},
                    status=status.HTTP_404_NOT_FOUND,
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

        # Enforce max files PER CHAT (now correctly scoped, was global before)
        if settings_obj.max_files_per_chat > 0:
            with connection.cursor() as cur:
                cur.execute(
                    "SELECT COUNT(*) FROM chat_files WHERE conversation_id = %s",
                    [conversation_id],
                )
                current_count = cur.fetchone()[0]
                if current_count >= settings_obj.max_files_per_chat:
                    return Response(
                        {
                            "error": {
                                "code": "FILE_LIMIT_REACHED",
                                "message": f"Maximum of {settings_obj.max_files_per_chat} files allowed per chat.",
                            }
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

        # Step 1: upload to RAG
        rag_file_id = None
        rag_response_data = None
        try:
            from system.models import ModelConfig

            config = ModelConfig.get_or_create_singleton()
            embedding_model = (config.embedding_model or "").strip() or "nomic-embed-text"

            rag_url = urljoin(RAG_SERVICE_URL, "/api/files/upload")
            files = {"file": (uploaded_file.name, uploaded_file.read(), uploaded_file.content_type)}
            form_data = {"embedding_model": embedding_model}
            resp = requests.post(rag_url, files=files, data=form_data, headers=_rag_headers(), timeout=300)
            resp.raise_for_status()
            rag_response_data = resp.json()
            if "error" in rag_response_data:
                return Response(
                    {"error": {"code": "PROCESSING_ERROR", "message": rag_response_data["error"]}},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            rag_file_id = rag_response_data.get("file", {}).get("id") or rag_response_data.get("id")
            if not rag_file_id:
                logger.warning("RAG response missing file id: %s", rag_response_data)
                return Response(
                    {"error": {"code": "UPLOAD_ERROR", "message": "RAG service did not return a file id."}},
                    status=status.HTTP_502_BAD_GATEWAY,
                )
        except Exception as e:
            logger.exception("File upload to RAG failed")
            return Response(
                {"error": {"code": "UPLOAD_ERROR", "message": str(e)}},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # Step 2: insert chat_files link. If this fails, clean up RAG file
        # to avoid an orphan vector record.
        try:
            file_info = rag_response_data.get("file", rag_response_data)
            with connection.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO chat_files (conversation_id, file_id, file_name, file_size, chunks)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (conversation_id, file_id) DO NOTHING
                    """,
                    [
                        conversation_id,
                        rag_file_id,
                        file_info.get("name") or uploaded_file.name,
                        file_info.get("size") or uploaded_file.size,
                        file_info.get("chunks") or 0,
                    ],
                )
        except Exception as e:
            logger.exception("Failed to insert chat_files row, rolling back RAG upload")
            # Best-effort RAG cleanup
            try:
                requests.delete(
                    urljoin(RAG_SERVICE_URL, f"/api/files/{rag_file_id}"),
                    headers=_rag_headers(),
                    timeout=10,
                )
            except Exception:
                logger.warning("Failed to clean up orphan RAG file %s", rag_file_id)
            return Response(
                {"error": {"code": "DB_ERROR", "message": str(e)}},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(rag_response_data, status=status.HTTP_201_CREATED)


class FileDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, file_id):
        """Delete a file from a specific chat.

        Query params:
          - conversation_id (required): integer chat id

        Removes the chat_files row first, then deletes from RAG (per-chat
        duplication model — each chat has its own RAG file even if the
        underlying content was the same). If conversation_id is missing,
        rejects with 400.
        """
        _ensure_tables()
        cid_raw = request.query_params.get("conversation_id")
        if not cid_raw:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "conversation_id query parameter is required."}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            conversation_id = int(cid_raw)
        except (TypeError, ValueError):
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "conversation_id must be an integer."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Remove the link row first
        with connection.cursor() as cur:
            cur.execute(
                "DELETE FROM chat_files WHERE conversation_id = %s AND file_id = %s RETURNING id",
                [conversation_id, file_id],
            )
            deleted_row = cur.fetchone()

        if not deleted_row:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "File not found in this chat."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Then delete from RAG (best-effort — chat_files row already gone,
        # so the file is effectively detached from this chat regardless).
        try:
            rag_url = urljoin(RAG_SERVICE_URL, f"/api/files/{file_id}")
            resp = requests.delete(rag_url, headers=_rag_headers(), timeout=10)
            resp.raise_for_status()
            return Response(resp.json())
        except Exception as e:
            logger.warning("RAG delete failed for file %s (chat link removed): %s", file_id, e)
            return Response({"message": "File detached from chat."})


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
