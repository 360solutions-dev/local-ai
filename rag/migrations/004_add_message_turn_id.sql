-- Migration: 004_add_message_turn_id
-- Links user prompt + assistant reply so one action deletes both (conversation turn).

ALTER TABLE messages ADD COLUMN IF NOT EXISTS turn_id UUID;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_turn ON messages (conversation_id, turn_id)
    WHERE turn_id IS NOT NULL;

COMMENT ON COLUMN messages.turn_id IS 'Shared UUID for one Q&A turn; user and assistant rows in the same turn share this value.';
