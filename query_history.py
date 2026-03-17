"""PostgreSQL-backed query history and chat messages (prompts + responses)."""

import json
from datetime import datetime, timezone
from typing import List, Optional

from config import DATABASE_URL


def _get_connection():
    if not DATABASE_URL:
        return None
    try:
        import psycopg2
        return psycopg2.connect(DATABASE_URL)
    except Exception:
        return None


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
        conn.close()


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
        conn.close()


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
                    "ALTER TABLE messages ADD COLUMN conversation_id INT REFERENCES conversations(id)"
                )
            except Exception:
                pass
            cur.execute(
                "UPDATE messages SET conversation_id = (SELECT id FROM conversations ORDER BY id ASC LIMIT 1) WHERE conversation_id IS NULL"
            )
        conn.commit()
        return True
    except Exception:
        return False
    finally:
        conn.close()


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
        conn.close()


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
        conn.close()


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
        conn.close()


def get_messages_for_conversation(conversation_id: int) -> List[dict]:
    """Return messages for one conversation in order. Each dict: id, role, content, sources."""
    conn = _get_connection()
    if conn is None:
        return []
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, role, content, sources FROM messages
                   WHERE conversation_id = %s ORDER BY created_at ASC""",
                (conversation_id,),
            )
            rows = cur.fetchall()
        out = []
        for r in rows:
            mid, role, content, sources_raw = r
            sources = json.loads(sources_raw) if sources_raw else None
            out.append({"id": mid, "role": role, "content": content, "sources": sources})
        return out
    except Exception:
        return []
    finally:
        conn.close()


def get_all_messages() -> List[dict]:
    """Return all chat messages in order (legacy / no conversation filter)."""
    conn = _get_connection()
    if conn is None:
        return []
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, role, content, sources FROM messages
                   ORDER BY created_at ASC"""
            )
            rows = cur.fetchall()
        out = []
        for r in rows:
            mid, role, content, sources_raw = r
            sources = json.loads(sources_raw) if sources_raw else None
            out.append({"id": mid, "role": role, "content": content, "sources": sources})
        return out
    except Exception:
        return []
    finally:
        conn.close()


def add_message(
    role: str,
    content: str,
    sources: Optional[List[str]] = None,
    conversation_id: Optional[int] = None,
) -> Optional[int]:
    """Insert one message. Returns the new row id, or None on failure."""
    conn = _get_connection()
    if conn is None:
        return None
    try:
        sources_json = json.dumps(sources) if sources else None
        with conn.cursor() as cur:
            if conversation_id is not None:
                cur.execute(
                    """INSERT INTO messages (role, content, sources, created_at, conversation_id)
                       VALUES (%s, %s, %s, %s, %s) RETURNING id""",
                    (role, content.strip(), sources_json, datetime.now(timezone.utc), conversation_id),
                )
            else:
                cur.execute(
                    "INSERT INTO messages (role, content, sources, created_at) VALUES (%s, %s, %s, %s) RETURNING id",
                    (role, content.strip(), sources_json, datetime.now(timezone.utc)),
                )
            (mid,) = cur.fetchone()
        conn.commit()
        return mid
    except Exception:
        return None
    finally:
        conn.close()


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
        conn.close()


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
        conn.close()
