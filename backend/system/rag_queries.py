"""Raw SQL helpers to query RAG tables (conversations, messages, query_history)
that live in the shared PostgreSQL database."""

import json

from django.db import connection


def get_all_chat_data():
    """Return all conversations with their messages as a nested structure."""
    with connection.cursor() as cur:
        # Check if conversations table exists
        cur.execute(
            "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'conversations')"
        )
        if not cur.fetchone()[0]:
            return []

        cur.execute("SELECT id, title, created_at FROM conversations ORDER BY created_at DESC")
        conversations = cur.fetchall()

        result = []
        for conv_id, title, created_at in conversations:
            cur.execute(
                "SELECT id, role, content, sources, created_at FROM messages "
                "WHERE conversation_id = %s ORDER BY created_at ASC",
                [conv_id],
            )
            messages = [
                {
                    "id": row[0],
                    "role": row[1],
                    "content": row[2],
                    "sources": json.loads(row[3]) if row[3] else None,
                    "created_at": row[4].isoformat() if row[4] else None,
                }
                for row in cur.fetchall()
            ]
            result.append(
                {
                    "id": conv_id,
                    "title": title or "Untitled",
                    "created_at": created_at.isoformat() if created_at else None,
                    "messages": messages,
                }
            )
    return result


def get_query_history():
    """Return all query history entries."""
    with connection.cursor() as cur:
        cur.execute(
            "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'query_history')"
        )
        if not cur.fetchone()[0]:
            return []

        cur.execute("SELECT id, query_text, created_at FROM query_history ORDER BY created_at DESC")
        return [
            {
                "id": row[0],
                "query_text": row[1],
                "created_at": row[2].isoformat() if row[2] else None,
            }
            for row in cur.fetchall()
        ]


# Whitelist of tables that can be used in dynamic queries
_ALLOWED_TABLES = frozenset({"messages", "conversations", "query_history"})


def delete_all_chat_data():
    """Delete all rows from messages, conversations, and query_history."""
    with connection.cursor() as cur:
        for table in ["messages", "conversations", "query_history"]:
            if table not in _ALLOWED_TABLES:
                continue
            cur.execute(
                "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = %s)",
                [table],
            )
            if cur.fetchone()[0]:
                # Table name is validated against whitelist above — safe to interpolate
                cur.execute("DELETE FROM " + table)


def get_chat_stats():
    """Return basic chat statistics."""
    stats = {"total_conversations": 0, "total_messages": 0, "total_queries": 0}
    with connection.cursor() as cur:
        for table, key in [
            ("conversations", "total_conversations"),
            ("messages", "total_messages"),
            ("query_history", "total_queries"),
        ]:
            if table not in _ALLOWED_TABLES:
                continue
            cur.execute(
                "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = %s)",
                [table],
            )
            if cur.fetchone()[0]:
                # Table name is validated against whitelist above — safe to interpolate
                cur.execute("SELECT COUNT(*) FROM " + table)
                stats[key] = cur.fetchone()[0]
    return stats
