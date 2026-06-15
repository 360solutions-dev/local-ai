"""Tests for per-chat file scoping introduced in Phase 1.5a.

These tests verify that:
  1. Files uploaded to one chat appear only in that chat's file list.
  2. Deleting a file removes it from chat_files but no other chat is affected.
  3. Deleting a conversation removes its chat_files rows (CASCADE) and
     attempts RAG cleanup for each linked file.

The RAG service is mocked because we can't depend on it in unit tests.
"""

from unittest.mock import patch

from django.db import connection
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from chat.views import _ensure_tables


def _make_conv(title: str) -> int:
    """Insert a conversation row directly and return its id."""
    _ensure_tables()
    with connection.cursor() as cur:
        cur.execute(
            "INSERT INTO conversations (title) VALUES (%s) RETURNING id",
            [title],
        )
        return cur.fetchone()[0]


def _make_chat_file(conv_id: int, file_id: str, name: str) -> None:
    """Insert a chat_files row directly (bypasses RAG)."""
    with connection.cursor() as cur:
        cur.execute(
            """
            INSERT INTO chat_files (conversation_id, file_id, file_name, file_size, chunks)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (conversation_id, file_id) DO NOTHING
            """,
            [conv_id, file_id, name, 1024, 5],
        )


class FileScopingTests(TestCase):
    """Per-chat file scoping behavior."""

    def setUp(self):
        # Auth setup — required since file endpoints are IsAuthenticated
        self.user = User.objects.create_user(
            username="admin@test.com",
            email="admin@test.com",
            password="testpass123",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_file_list_returns_only_files_for_requested_chat(self):
        """Files uploaded to chat A must not appear in chat B's list."""
        conv_a = _make_conv("Chat A")
        conv_b = _make_conv("Chat B")
        _make_chat_file(conv_a, "file-a1", "alpha.pdf")
        _make_chat_file(conv_a, "file-a2", "bravo.pdf")
        _make_chat_file(conv_b, "file-b1", "charlie.pdf")

        # Chat A should see exactly its 2 files
        resp = self.client.get(f"/api/chat/files/?conversation_id={conv_a}")
        self.assertEqual(resp.status_code, 200)
        names_a = sorted(f["name"] for f in resp.data["files"])
        self.assertEqual(names_a, ["alpha.pdf", "bravo.pdf"])

        # Chat B should see only its 1 file (no leak from chat A)
        resp = self.client.get(f"/api/chat/files/?conversation_id={conv_b}")
        self.assertEqual(resp.status_code, 200)
        names_b = [f["name"] for f in resp.data["files"]]
        self.assertEqual(names_b, ["charlie.pdf"])

        # No conversation_id means empty list (no global file access)
        resp = self.client.get("/api/chat/files/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["files"], [])

    @patch("chat.views.requests.delete")
    def test_file_delete_only_removes_link_for_requested_chat(self, mock_rag_delete):
        """Deleting a file from chat A doesn't touch chat B's reference."""
        mock_rag_delete.return_value.raise_for_status = lambda: None
        mock_rag_delete.return_value.json = lambda: {"deleted": True}

        conv_a = _make_conv("Chat A")
        conv_b = _make_conv("Chat B")
        # Same file_id is associated with both chats (per-chat duplication
        # would normally use different ids, but this test ensures scoping
        # is strict even when ids overlap)
        _make_chat_file(conv_a, "shared-file", "report.pdf")
        _make_chat_file(conv_b, "shared-file", "report.pdf")

        # Delete from chat A only
        resp = self.client.delete(
            f"/api/chat/files/shared-file/?conversation_id={conv_a}"
        )
        self.assertEqual(resp.status_code, 200)

        # Chat A should now have 0 files
        resp = self.client.get(f"/api/chat/files/?conversation_id={conv_a}")
        self.assertEqual(resp.data["files"], [])

        # Chat B still has its reference (no leak)
        resp = self.client.get(f"/api/chat/files/?conversation_id={conv_b}")
        self.assertEqual(len(resp.data["files"]), 1)
        self.assertEqual(resp.data["files"][0]["name"], "report.pdf")

    @patch("chat.views.requests.delete")
    def test_conversation_delete_cascades_to_chat_files(self, mock_rag_delete):
        """Deleting a chat removes its chat_files rows via CASCADE and
        attempts RAG cleanup for each linked file."""
        mock_rag_delete.return_value.raise_for_status = lambda: None
        mock_rag_delete.return_value.json = lambda: {"deleted": True}

        conv_id = _make_conv("To Be Deleted")
        _make_chat_file(conv_id, "file-1", "one.pdf")
        _make_chat_file(conv_id, "file-2", "two.pdf")

        resp = self.client.delete(f"/api/chat/conversations/{conv_id}/")
        self.assertEqual(resp.status_code, 200)

        # chat_files rows for this conversation must be gone (CASCADE)
        with connection.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM chat_files WHERE conversation_id = %s",
                [conv_id],
            )
            self.assertEqual(cur.fetchone()[0], 0)

        # RAG cleanup attempted for each linked file
        self.assertEqual(mock_rag_delete.call_count, 2)

    def test_file_delete_without_conversation_id_rejected(self):
        """The delete endpoint rejects requests missing conversation_id
        to prevent accidentally deleting a file that belongs to another chat."""
        resp = self.client.delete("/api/chat/files/some-id/")
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(
            resp.data["error"]["code"],
            "VALIDATION_ERROR",
        )
