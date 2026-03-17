-- Migration: 001_create_query_history
-- Description: Creates the query_history table for storing user prompts/queries from the chatbot.
-- Required for: prompt history and chatbot logging.

CREATE TABLE IF NOT EXISTS query_history (
    id SERIAL PRIMARY KEY,
    query_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optional: index for listing recent queries by time
CREATE INDEX IF NOT EXISTS idx_query_history_created_at ON query_history (created_at DESC);

COMMENT ON TABLE query_history IS 'Stores each user prompt/query submitted to the document chatbot.';
