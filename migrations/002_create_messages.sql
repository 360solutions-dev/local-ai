-- Migration: 002_create_messages
-- Description: Stores full chat (prompts + responses) so history survives reload. Supports delete.

CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    sources TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages (created_at ASC);

COMMENT ON TABLE messages IS 'Chat messages (prompts and responses) for the document chatbot. Persists across reloads.';
COMMENT ON COLUMN messages.sources IS 'JSON array of source filenames for assistant messages; NULL for user.';
