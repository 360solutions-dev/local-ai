-- Migration: 003_add_conversations
-- Description: Multiple chats - conversations table and conversation_id on messages.

CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,
    title TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO conversations (title) SELECT 'Default' WHERE NOT EXISTS (SELECT 1 FROM conversations LIMIT 1);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS conversation_id INT REFERENCES conversations(id);
UPDATE messages SET conversation_id = (SELECT id FROM conversations ORDER BY id ASC LIMIT 1) WHERE conversation_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages (conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations (created_at DESC);

COMMENT ON TABLE conversations IS 'Chat conversations; each has many messages.';
