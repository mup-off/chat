-- Up Migration
-- Attachments: documents (any whitelisted file) and shared contacts (another user's card).
ALTER TABLE messages DROP CONSTRAINT messages_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_type_check
  CHECK (type IN ('text', 'image', 'audio', 'document', 'contact'));

ALTER TABLE messages
  ADD COLUMN media_name TEXT CHECK (char_length(media_name) <= 255),  -- original file name (documents)
  ADD COLUMN media_size BIGINT CHECK (media_size >= 0),
  ADD COLUMN media_type TEXT,                                           -- MIME type as stored
  ADD COLUMN contact_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE messages DROP CONSTRAINT messages_check;
ALTER TABLE messages ADD CONSTRAINT messages_content_check
  CHECK (body IS NOT NULL OR media_key IS NOT NULL OR contact_user_id IS NOT NULL OR type = 'contact');

-- The media route looks messages up by key to check access and get the file name.
CREATE INDEX messages_media_key_idx ON messages (media_key) WHERE media_key IS NOT NULL;

-- Down Migration
DROP INDEX IF EXISTS messages_media_key_idx;
DELETE FROM messages WHERE type IN ('document', 'contact');
ALTER TABLE messages DROP CONSTRAINT messages_content_check;
ALTER TABLE messages ADD CONSTRAINT messages_check CHECK (body IS NOT NULL OR media_key IS NOT NULL);
ALTER TABLE messages
  DROP COLUMN contact_user_id,
  DROP COLUMN media_type,
  DROP COLUMN media_size,
  DROP COLUMN media_name;
ALTER TABLE messages DROP CONSTRAINT messages_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_type_check CHECK (type IN ('text', 'image', 'audio'));
