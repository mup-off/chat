-- Up Migration
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fast ILIKE search on usernames

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT NOT NULL UNIQUE CHECK (username ~ '^[a-zA-Z0-9_]{3,30}$'),
  phone         TEXT UNIQUE,
  display_name  TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 60),
  password_hash TEXT NOT NULL,
  last_seen_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX users_username_trgm ON users USING gin (username gin_trgm_ops);

CREATE TABLE conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            TEXT NOT NULL DEFAULT 'direct' CHECK (type IN ('direct', 'group')),
  direct_key      TEXT UNIQUE,          -- 'minUserId:maxUserId' for direct chats; NULL for groups
  last_message_id UUID,                 -- FK added below, after messages exists
  last_message_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (type <> 'direct' OR direct_key IS NOT NULL)
);
CREATE INDEX conversations_last_message_at_idx ON conversations (last_message_at DESC NULLS LAST);

CREATE TABLE participants (
  conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_delivered_at TIMESTAMPTZ,
  last_read_at      TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX participants_user_idx ON participants (user_id);

CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES users(id),
  client_msg_id   UUID NOT NULL,
  type            TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'image', 'audio')),
  body            TEXT CHECK (char_length(body) <= 4000),
  media_key       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (sender_id, client_msg_id),
  CHECK (body IS NOT NULL OR media_key IS NOT NULL)
);
CREATE INDEX messages_conv_created_idx ON messages (conversation_id, created_at DESC, id DESC);

ALTER TABLE conversations
  ADD CONSTRAINT conversations_last_message_fk
  FOREIGN KEY (last_message_id) REFERENCES messages(id) ON DELETE SET NULL;

-- Down Migration
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_last_message_fk;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS participants;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS users;
