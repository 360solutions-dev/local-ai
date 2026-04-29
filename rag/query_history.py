"""PostgreSQL-backed query history and chat messages (prompts + responses)."""

import json
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import List, Optional

from config import DATABASE_URL

# --- Connection pooling ---
_pool = None


def _get_pool():
    global _pool
    if _pool is None and DATABASE_URL:
        import psycopg2.pool
        _pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=1, maxconn=10, dsn=DATABASE_URL
        )
    return _pool


@contextmanager
def _get_connection_ctx():
    """Context manager that borrows a connection from the pool and returns it."""
    pool = _get_pool()
    if pool is None:
        yield None
        return
    conn = None
    try:
        conn = pool.getconn()
        yield conn
    except Exception:
        yield None
    finally:
        if conn is not None:
            pool.putconn(conn)


def _get_connection():
    """Legacy helper — returns a pooled connection. Caller MUST NOT close() it directly."""
    pool = _get_pool()
    if pool is None:
        return None
    try:
        return pool.getconn()
    except Exception:
        return None


def _return_connection(conn):
    """Return a connection back to the pool (replaces conn.close())."""
    pool = _get_pool()
    if pool is not None and conn is not None:
        pool.putconn(conn)


def init_db() -> bool:
    """Create query_history table if it does not exist. Returns True if DB is available."""
    conn = _get_connection()
    if conn is None:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS query_history (
                    id SERIAL PRIMARY KEY,
                    query_text TEXT NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
        conn.commit()
        return True
    except Exception:
        return False
    finally:
        _return_connection(conn)


def ensure_messages_table() -> bool:
    """Create messages table if it does not exist (for persistent chat)."""
    conn = _get_connection()
    if conn is None:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS messages (
                    id SERIAL PRIMARY KEY,
                    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
                    content TEXT NOT NULL,
                    sources TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
        conn.commit()
        return True
    except Exception:
        return False
    finally:
        _return_connection(conn)


def ensure_conversations_schema() -> bool:
    """Ensure conversations table and conversation_id on messages exist (run after migrations)."""
    conn = _get_connection()
    if conn is None:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS conversations (
                    id SERIAL PRIMARY KEY,
                    title TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute("INSERT INTO conversations (title) SELECT 'Default' WHERE NOT EXISTS (SELECT 1 FROM conversations LIMIT 1)")
            try:
                cur.execute(
                    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS conversation_id INT REFERENCES conversations(id)"
                )
            except Exception:
                pass
            cur.execute(
                "UPDATE messages SET conversation_id = (SELECT id FROM conversations ORDER BY id ASC LIMIT 1) WHERE conversation_id IS NULL"
            )
            try:
                cur.execute("ALTER TABLE messages ADD COLUMN IF NOT EXISTS turn_id UUID")
            except Exception:
                pass
            try:
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS idx_messages_conversation_turn ON messages (conversation_id, turn_id) WHERE turn_id IS NOT NULL"
                )
            except Exception:
                pass
        conn.commit()
        return True
    except Exception:
        return False
    finally:
        _return_connection(conn)


def list_conversations() -> List[dict]:
    """Return all conversations, newest first. Each dict: id, title, created_at."""
    conn = _get_connection()
    if conn is None:
        return []
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, title, created_at FROM conversations ORDER BY created_at DESC"
            )
            rows = cur.fetchall()
        return [{"id": r[0], "title": r[1] or f"Chat", "created_at": r[2]} for r in rows]
    except Exception:
        return []
    finally:
        _return_connection(conn)


def create_conversation(title: Optional[str] = None) -> Optional[int]:
    """Create a new conversation. Returns new id or None."""
    conn = _get_connection()
    if conn is None:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO conversations (title, created_at) VALUES (%s, %s) RETURNING id",
                (title or "New chat", datetime.now(timezone.utc)),
            )
            (cid,) = cur.fetchone()
        conn.commit()
        return cid
    except Exception:
        return None
    finally:
        _return_connection(conn)


def title_from_user_message(prompt: str, max_len: int = 72) -> str:
    """Derive a sidebar title from the first user message (ChatGPT-style)."""
    t = " ".join((prompt or "").strip().split())
    if not t:
        return "New chat"
    if len(t) > max_len:
        return t[: max_len - 1] + "…"
    return t


def maybe_update_conversation_title_from_first_user_message(
    conversation_id: int, prompt: str
) -> bool:
    """If this conversation has exactly one user message, set conversations.title from that prompt."""
    conn = _get_connection()
    if conn is None:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT COUNT(*) FROM messages
                   WHERE conversation_id = %s AND role = 'user'""",
                (conversation_id,),
            )
            (cnt,) = cur.fetchone()
            if cnt != 1:
                return False
            title = title_from_user_message(prompt)
            cur.execute(
                "UPDATE conversations SET title = %s WHERE id = %s",
                (title, conversation_id),
            )
        conn.commit()
        return True
    except Exception:
        return False
    finally:
        _return_connection(conn)


def delete_conversation(conversation_id: int) -> bool:
    """Delete a conversation and its messages. Returns True if successful."""
    conn = _get_connection()
    if conn is None:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM messages WHERE conversation_id = %s", (conversation_id,))
            cur.execute("DELETE FROM conversations WHERE id = %s", (conversation_id,))
        conn.commit()
        return True
    except Exception:
        return False
    finally:
        _return_connection(conn)


def get_messages_for_conversation(conversation_id: int) -> List[dict]:
    """Return messages for one conversation in order. Each dict: id, role, content, sources, turn_id."""
    conn = _get_connection()
    if conn is None:
        return []
    try:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    """SELECT id, role, content, sources, turn_id FROM messages
                       WHERE conversation_id = %s ORDER BY created_at ASC""",
                    (conversation_id,),
                )
                rows = cur.fetchall()
                out = []
                for r in rows:
                    mid, role, content, sources_raw, turn_raw = r
                    sources = json.loads(sources_raw) if sources_raw else None
                    tid = str(turn_raw) if turn_raw is not None else None
                    out.append({"id": mid, "role": role, "content": content, "sources": sources, "turn_id": tid})
                return out
            except Exception:
                cur.execute(
                    """SELECT id, role, content, sources FROM messages
                       WHERE conversation_id = %s ORDER BY created_at ASC""",
                    (conversation_id,),
                )
                rows = cur.fetchall()
                return [
                    {
                        "id": r[0],
                        "role": r[1],
                        "content": r[2],
                        "sources": json.loads(r[3]) if r[3] else None,
                        "turn_id": None,
                    }
                    for r in rows
                ]
    except Exception:
        return []
    finally:
        _return_connection(conn)


def get_all_messages() -> List[dict]:
    """Return all chat messages in order (legacy / no conversation filter)."""
    conn = _get_connection()
    if conn is None:
        return []
    try:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    """SELECT id, role, content, sources, turn_id FROM messages
                       ORDER BY created_at ASC"""
                )
                rows = cur.fetchall()
                return [
                    {
                        "id": r[0],
                        "role": r[1],
                        "content": r[2],
                        "sources": json.loads(r[3]) if r[3] else None,
                        "turn_id": str(r[4]) if r[4] is not None else None,
                    }
                    for r in rows
                ]
            except Exception:
                cur.execute(
                    """SELECT id, role, content, sources FROM messages ORDER BY created_at ASC"""
                )
                rows = cur.fetchall()
                return [
                    {
                        "id": r[0],
                        "role": r[1],
                        "content": r[2],
                        "sources": json.loads(r[3]) if r[3] else None,
                        "turn_id": None,
                    }
                    for r in rows
                ]
    except Exception:
        return []
    finally:
        _return_connection(conn)


def add_message(
    role: str,
    content: str,
    sources: Optional[List[str]] = None,
    conversation_id: Optional[int] = None,
    turn_id: Optional[str] = None,
) -> tuple[Optional[int], Optional[str]]:
    """Insert one message. Returns (new row id, None) or (None, error_message)."""
    conn = _get_connection()
    if conn is None:
        return (None, "Database connection failed. Is PostgreSQL running? Is DATABASE_URL correct in config.py?")
    try:
        sources_json = json.dumps(sources) if sources else None
        # Pass UUID as str — psycopg2 does not adapt uuid.UUID objects unless extensions are registered
        tid: Optional[str] = None
        if turn_id:
            try:
                tid = str(uuid.UUID(turn_id))
            except ValueError:
                return (None, "Invalid turn_id format")
        with conn.cursor() as cur:
            try:
                if conversation_id is not None:
                    cur.execute(
                        """INSERT INTO messages (role, content, sources, created_at, conversation_id, turn_id)
                           VALUES (%s, %s, %s, %s, %s, %s) RETURNING id""",
                        (
                            role,
                            content.strip(),
                            sources_json,
                            datetime.now(timezone.utc),
                            conversation_id,
                            tid,
                        ),
                    )
                else:
                    cur.execute(
                        """INSERT INTO messages (role, content, sources, created_at, turn_id)
                           VALUES (%s, %s, %s, %s, %s) RETURNING id""",
                        (role, content.strip(), sources_json, datetime.now(timezone.utc), tid),
                    )
            except Exception as e:
                err = str(e).lower()
                if "turn_id" in err or "column" in err:
                    # Fallback: schema may lack turn_id (run: python run_migrations.py)
                    if conversation_id is not None:
                        cur.execute(
                            """INSERT INTO messages (role, content, sources, created_at, conversation_id)
                               VALUES (%s, %s, %s, %s, %s) RETURNING id""",
                            (
                                role,
                                content.strip(),
                                sources_json,
                                datetime.now(timezone.utc),
                                conversation_id,
                            ),
                        )
                    else:
                        cur.execute(
                            """INSERT INTO messages (role, content, sources, created_at)
                               VALUES (%s, %s, %s, %s) RETURNING id""",
                            (role, content.strip(), sources_json, datetime.now(timezone.utc)),
                        )
                else:
                    raise
            (mid,) = cur.fetchone()
        conn.commit()
        return (mid, None)
    except Exception as e:
        return (None, str(e))
    finally:
        _return_connection(conn)


def delete_message(message_id: int) -> bool:
    """Remove one message by id. Returns True if deleted."""
    conn = _get_connection()
    if conn is None:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM messages WHERE id = %s", (message_id,))
            deleted = cur.rowcount
        conn.commit()
        return deleted > 0
    except Exception:
        return False
    finally:
        _return_connection(conn)


def delete_turn(conversation_id: int, turn_id: str) -> bool:
    """Delete all messages in one Q&A turn (same turn_id). Returns True if any row removed."""
    conn = _get_connection()
    if conn is None:
        return False
    try:
        tid_s = str(uuid.UUID(turn_id))
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM messages WHERE conversation_id = %s AND turn_id = %s",
                (conversation_id, tid_s),
            )
            deleted = cur.rowcount
        conn.commit()
        return deleted > 0
    except Exception:
        return False
    finally:
        _return_connection(conn)


def log_query(query_text: str) -> bool:
    """Append one user query to query_history (legacy audit). Returns True if logged successfully."""
    conn = _get_connection()
    if conn is None:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO query_history (query_text, created_at) VALUES (%s, %s)",
                (query_text.strip(), datetime.now(timezone.utc)),
            )
        conn.commit()
        return True
    except Exception:
        return False
    finally:
        _return_connection(conn)


# ---------------------------------------------------------------------------
# Indexed files metadata (stored in PostgreSQL)
# ---------------------------------------------------------------------------

def ensure_indexed_files_table() -> bool:
    """Create indexed_files table if it does not exist."""
    conn = _get_connection()
    if conn is None:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS indexed_files (
                    id VARCHAR(12) PRIMARY KEY,
                    name TEXT NOT NULL,
                    size INTEGER NOT NULL,
                    chunks INTEGER NOT NULL,
                    type VARCHAR(10) NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
        conn.commit()
        return True
    except Exception:
        return False
    finally:
        _return_connection(conn)


def list_indexed_files() -> List[dict]:
    """Return all indexed files, newest first."""
    conn = _get_connection()
    if conn is None:
        return []
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, name, size, chunks, type FROM indexed_files ORDER BY created_at DESC"
            )
            return [
                {"id": r[0], "name": r[1], "size": r[2], "chunks": r[3], "type": r[4]}
                for r in cur.fetchall()
            ]
    except Exception:
        return []
    finally:
        _return_connection(conn)


def add_indexed_file(file_id: str, name: str, size: int, chunks: int, file_type: str) -> bool:
    """Insert a new indexed file record."""
    conn = _get_connection()
    if conn is None:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO indexed_files (id, name, size, chunks, type) VALUES (%s, %s, %s, %s, %s)",
                (file_id, name, size, chunks, file_type),
            )
        conn.commit()
        return True
    except Exception:
        return False
    finally:
        _return_connection(conn)


def delete_indexed_file(file_id: str) -> bool:
    """Delete an indexed file record. Returns True if deleted."""
    conn = _get_connection()
    if conn is None:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM indexed_files WHERE id = %s", (file_id,))
            deleted = cur.rowcount
        conn.commit()
        return deleted > 0
    except Exception:
        return False
    finally:
        _return_connection(conn)


def delete_all_indexed_files() -> bool:
    """Delete all indexed file records. Returns True if successful."""
    conn = _get_connection()
    if conn is None:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM indexed_files")
        conn.commit()
        return True
    except Exception:
        return False
    finally:
        _return_connection(conn)
