-- Up Migration
ALTER TABLE messages
  ADD COLUMN reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN forwarded BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN deleted_at TIMESTAMPTZ;  -- "deleted for everyone": row kept as a tombstone, content cleared

-- A deleted message has no content left.
ALTER TABLE messages DROP CONSTRAINT messages_content_check;
ALTER TABLE messages ADD CONSTRAINT messages_content_check
  CHECK (deleted_at IS NOT NULL OR body IS NOT NULL OR media_key IS NOT NULL
         OR contact_user_id IS NOT NULL OR type = 'contact');

-- "Delete for me": hidden only for that user.
CREATE TABLE message_hidden (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  hidden_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);

-- Down Migration
DROP TABLE IF EXISTS message_hidden;
DELETE FROM messages WHERE deleted_at IS NOT NULL;
ALTER TABLE messages DROP CONSTRAINT messages_content_check;
ALTER TABLE messages ADD CONSTRAINT messages_content_check
  CHECK (body IS NOT NULL OR media_key IS NOT NULL OR contact_user_id IS NOT NULL OR type = 'contact');
ALTER TABLE messages DROP COLUMN deleted_at, DROP COLUMN forwarded, DROP COLUMN reply_to_id;
