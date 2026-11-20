# WhatsApp-Style Chat App — Implementation Plan (Revised)

A real-time 1-on-1 chat app built in five phases over ~16 days, moving from schema and auth to real-time messaging, WhatsApp-style UX, and production deployment.

**Stack:** React + Vite + Tailwind (client) · Node.js + Express + Socket.io (server) · PostgreSQL · S3 / Cloudflare R2 (media)

---

## Scope

**In scope (v1)**
- Register / log in, search users, start 1-on-1 chats
- Real-time text messaging with history and pagination
- Presence (online / last seen), typing indicators
- Sent / delivered / read ticks and unread badges
- Image sharing
- Multi-tab support and reconnection recovery

**Out of scope (v1)** — schema leaves room for these, but they are not built:
- Group chats (schema supports `type = 'group'`, no UI)
- Voice notes (stretch goal, only if Phase 4 finishes early)
- Push notifications, E2E encryption, message edit/delete, profile photos, video/voice calls

---

## Key decisions (made up front)

| Decision | Choice | Reason |
|---|---|---|
| DB access | `pg` + `node-pg-migrate` (or Prisma — pick one and stick with it) | Versioned migrations from day 1 |
| Validation | `zod` on every REST body and socket payload | One validation approach for HTTP and WS |
| Auth token | httpOnly `Secure` cookie, `SameSite=None`, 7-day expiry | Not readable by JS; works cross-domain (Vercel ↔ Railway) |
| Socket rooms | **Per-user rooms only** (`user:{id}`) | Messages, sidebar updates and multi-tab all use one path; no per-conversation join/leave bookkeeping |
| Message send | Socket.io **ack** callback + `client_msg_id` | Optimistic UI, idempotent retries, single-tick confirmation |
| Read / delivered state | Per-participant watermarks (`last_delivered_at`, `last_read_at`), not per-message status | No mass UPDATEs; works for groups later |
| Pagination | Keyset cursor on `(created_at, id)` | Stable ordering, no skipped/duplicated rows |
| Media | Store object **key**, serve via signed GET URL | Private chat images are not publicly guessable |
| Scaling | Single server instance; in-memory presence | Documented limitation — scale-out needs the Socket.io Redis adapter |

---

## Phase 1 — Foundation & Database (Days 1–2)

### Tasks
1. **Repo structure**
   ```
   /client   React + Vite + Tailwind
   /server   Express + Socket.io
     /src/db        pool, queries
     /src/routes    REST
     /src/sockets   socket handlers
     /src/middleware
     /migrations
   ```
2. **PostgreSQL** locally (Docker) or Neon/Supabase free tier.
3. **DB client** with a connection pool; config via `.env` (`DATABASE_URL`, `JWT_SECRET`, `CLIENT_ORIGIN`). Commit `.env.example`, never `.env`.
4. **Migrations** for the schema below.

### Schema

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fast ILIKE search

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT NOT NULL UNIQUE CHECK (username ~ '^[a-zA-Z0-9_]{3,30}$'),
  phone         TEXT UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  last_seen_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX users_username_trgm ON users USING gin (username gin_trgm_ops);

CREATE TABLE conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            TEXT NOT NULL DEFAULT 'direct' CHECK (type IN ('direct', 'group')),
  direct_key      TEXT UNIQUE,          -- 'minUserId:maxUserId' for direct chats; NULL for groups
  last_message_id UUID,                 -- FK added after messages table exists
  last_message_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (type <> 'direct' OR direct_key IS NOT NULL)
);

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
```

### Deliverable
- `npm run migrate` creates all tables, constraints and indexes on a fresh DB.
- Seed script creating 3 test users.

---

## Phase 2 — Authentication & Contact Discovery (Days 3–5)

### Backend
- `POST /api/auth/register` — zod-validate, bcrypt hash (cost 12), insert user, set auth cookie, return profile.
- `POST /api/auth/login` — verify credentials, set cookie, return profile. Same error message for "no such user" and "wrong password".
- `POST /api/auth/logout` — clear cookie.
- `GET /api/auth/me` — return current user (used on app load).
- **Rate limiting now:** `express-rate-limit` on `/api/auth/*` (e.g. 10 requests / 15 min / IP).
- **Middleware**
  - `requireAuth` for REST: verify JWT from cookie, attach `req.user`.
  - `io.use()` for sockets: parse cookie from handshake headers, verify JWT, attach `socket.data.userId`; reject otherwise.
- **CORS** set up now (not Phase 5): `origin: CLIENT_ORIGIN`, `credentials: true` — for both Express and Socket.io.
- `GET /api/users?search=q` — min 2 chars, max 20 results, exclude self. Search-as-you-type: partial match on username, display name, or phone digits (local `07…` format also matches `+2507…`). Phone numbers are never returned; search is rate-limited to 60/min per user to limit number-guessing.
- `POST /api/conversations { userId }` — find-or-create atomically:
  ```sql
  INSERT INTO conversations (type, direct_key)
  VALUES ('direct', $key)
  ON CONFLICT (direct_key) DO UPDATE SET direct_key = EXCLUDED.direct_key
  RETURNING id;
  -- then INSERT both participants ... ON CONFLICT DO NOTHING (same transaction)
  ```
  where `$key = least(a,b) || ':' || greatest(a,b)`. No check-then-insert race.

### Frontend
- Login and Register pages, auth context driven by `/api/auth/me`, protected routes.
- `fetch` / axios configured with `credentials: 'include'`.
- "New chat" search panel (debounced 300 ms) → opens the conversation.

### Tests (automated)
- Register / login / bad password / duplicate username.
- Find-or-create called twice concurrently returns the same conversation.

### Deliverable
Users can register, log in, search for another user, and open an empty chat thread.

---

## Phase 3 — Core Real-Time Messaging (Days 6–9)

### REST
- `GET /api/conversations` — the user's chats with the other participant, last message preview and unread count, ordered by `last_message_at DESC NULLS LAST`:
  ```sql
  -- unread for me = messages from others newer than my last_read_at
  SELECT count(*) FROM messages m
  WHERE m.conversation_id = c.id
    AND m.sender_id <> $me
    AND m.created_at > COALESCE(p.last_read_at, 'epoch')
  ```
- `GET /api/conversations/:id/messages?before=<created_at>,<id>&limit=30` — keyset pagination:
  ```sql
  WHERE conversation_id = $1 AND (created_at, id) < ($2, $3)
  ORDER BY created_at DESC, id DESC LIMIT 30
  ```
- **Every route that takes a conversation id checks the caller is a participant** (shared `assertParticipant(userId, convId)` helper → 404 if not).

### Socket architecture
- On connect: `socket.join('user:' + userId)`. No conversation rooms.
- `send_message` `{ conversationId, clientMsgId, body }` with ack callback:
  1. zod-validate; `assertParticipant`.
  2. In one transaction: insert message (`ON CONFLICT (sender_id, client_msg_id) DO NOTHING`, then select the existing row if it was a retry) and update `conversations.last_message_id/at`.
  3. `ack({ ok: true, message })` to the sender.
  4. `io.to('user:' + id).emit('message:new', message)` for **every participant** (covers the recipient, the sender's other tabs, and sidebar previews).
- On error: `ack({ ok: false, error })`; never crash the socket.

### Frontend
- Split layout: sidebar (conversation list) + thread panel.
- Optimistic send: render with a clock icon at once → replace with the server row on ack (match by `clientMsgId`) → show a retry button on failure.
- Deduplicate incoming `message:new` by `id` (sender tabs receive their own messages).
- Auto-scroll to bottom only if the user is already near the bottom; "load older" on scroll-to-top keeps scroll position.
- State: one store (Zustand or React Query + socket event handlers) keyed by conversation id.

### Tests (automated)
- User C cannot read or send to a conversation between A and B (REST and socket).
- Retrying `send_message` with the same `clientMsgId` produces one row.

### First deployment (end of Day 9)
Deploy DB, backend and frontend to the production hosts now (see Phase 5) to find cross-domain cookie, CORS and WebSocket problems early.

### Deliverable
End-to-end real-time text chat persisted in PostgreSQL, working on the deployed URLs.

---

## Phase 4 — WhatsApp UX Polish (Days 10–13)

### Presence
- Server map: `Map<userId, Set<socketId>>`.
  - On connect: add the socket; if the set was empty → user went online.
  - On disconnect: remove the socket; if the set is now empty → set `users.last_seen_at = now()` and the user went offline.
- Send `presence:update { userId, online, lastSeenAt }` **only to users who share a conversation** with them (look up conversation partners), not to everyone.
- `GET /api/conversations` includes each partner's current online flag / `last_seen_at`.

### Typing indicators
- Client: emit `typing:start` on the first keystroke, then at most once every 2 s while typing; emit `typing:stop` after 2 s of no keystrokes or on send.
- Server: `assertParticipant`, relay to the other participants' user rooms. Not stored.
- Client: auto-clear the indicator after 5 s if no `typing:stop` arrives (covers dropped connections).

### Delivered & read ticks
| Tick | Meaning | How it is derived |
|---|---|---|
| 🕓 | Pending | No ack yet |
| ✓ | Sent | Saved on the server (ack received) |
| ✓✓ grey | Delivered | `created_at <= recipient.last_delivered_at` |
| ✓✓ blue | Read | `created_at <= recipient.last_read_at` |

- **Delivered:** the client emits `message:delivered { conversationId, upTo }` when it receives `message:new`, and after fetching conversations on connect/reconnect (covers offline users). Server sets `last_delivered_at = GREATEST(last_delivered_at, upTo)` and notifies the sender's user room.
- **Read:** the client emits `conversation:read { conversationId, upTo }` when the thread is open, the tab is visible, and new messages are shown. Server updates `last_read_at` (and `last_delivered_at`) with `GREATEST`, then notifies the sender → ticks turn blue; the reader's unread badge clears.
- Each is a single-row UPDATE on `participants`; messages are never updated.

### Image sharing
- `POST /api/uploads { conversationId, contentType, size }` → `assertParticipant`; allow only `image/jpeg|png|webp|gif`, ≤ 10 MB; return a presigned PUT URL plus `key = conv/{conversationId}/{uuid}`.
- Client uploads directly to S3/R2, then sends `send_message { type: 'image', mediaKey, body? }`.
- The server checks `mediaKey` belongs to that conversation's prefix **and** HEADs the object (exists, ≤ 10 MB, real image content type) before saving. Storage doesn't enforce the signed content type, so this check is the real guard.
- Serving (as built): `<img src="/api/media/conv/{id}/{file}">` — the server checks membership on every request and 302-redirects to a 1-hour signed GET URL. No expiry handling needed in the client.
- Dev storage: RustFS (S3-compatible) in docker-compose, since MinIO no longer publishes Docker images. Bucket CORS is set by `npm run storage:setup -w server`.
- Client: resize/compress on the client before upload (canvas → WebP, max 1600 px), show upload progress, open full-size on tap.

### Stretch: voice notes (not built)
Deferred: schema supports `type = 'audio'`. Only if time allows: MediaRecorder → `audio/webm` → same upload flow, `type = 'audio'`, `<audio>` player.

### Deliverable
Presence, last seen, typing indicators, 4-state ticks, unread badges and image sharing all working across two browsers.

---

## Phase 5 — Hardening, Testing & Deployment (Days 14–16)

### Security
- `helmet` on Express; HTTPS only in production (hosts provide TLS).
- **XSS:** store message text raw and render as text in React (escaped by default). **Never** use `dangerouslySetInnerHTML` for user content. Auto-link URLs with a safe component that only allows `http(s):` links.
- **Socket rate limiting:** per-socket token bucket (e.g. 20 messages / 10 s; typing events throttled) → excess events are dropped with an error ack; repeat offenders are disconnected.
- `express.json({ limit: '16kb' })`; Socket.io `maxHttpBufferSize` set low (media never goes through the socket).
- Re-check: every handler validates with zod and calls `assertParticipant`.
- Secrets only in host environment variables; a strong random `JWT_SECRET`.

### Reconnection & multi-tab
- Socket.io client reconnects automatically; on the `connect` event (initial and re-connect):
  1. Refetch `GET /api/conversations` (sidebar, unread counts, presence).
  2. For the open thread, fetch messages **newer** than the newest message held locally (`?after=<created_at>,<id>`).
  3. Emit `message:delivered` for anything new.
  4. Re-send any messages still pending (same `clientMsgId`, so the server dedupes).
- No room re-join is needed: the server joins `user:{id}` on every connection.

### Test checklist
**Automated:** auth, participant authorization, idempotent send, pagination boundaries, read/delivered watermark math.

**Manual (two browsers + a phone-width window):**
- [ ] Turn off Wi-Fi mid-conversation, send from the other side, reconnect → messages appear, no duplicates
- [ ] Send while offline → clock icon → delivered after reconnect
- [ ] Same user in two tabs → both update; closing one tab keeps "online"
- [ ] Read in one tab clears the badge in the other
- [ ] Server restart → clients reconnect and resync
- [ ] Paste `<script>alert(1)</script>` → shown as plain text

### Deployment
| Part | Host | Notes |
|---|---|---|
| Database | Neon / Supabase / Railway Postgres | Use the pooled connection string; run migrations in the deploy step |
| Backend | Railway / Render / Fly.io (persistent process) | **Not** serverless. Render's free tier sleeps and drops sockets — use a paid/always-on instance for demos. Single instance (in-memory presence). |
| Frontend | Vercel / Cloudflare Pages | `VITE_API_URL` points at the backend; SPA fallback to `index.html` |
| Media | Cloudflare R2 / S3 | Private bucket; CORS allows `PUT` from the frontend origin |

Cookies are cross-site (frontend and backend on different domains): `SameSite=None; Secure`. Safari may still block third-party cookies — if that is a problem, put both on one domain via subdomains (`app.example.com` / `api.example.com`).

### Deliverable
Production deployment that passes the test checklist above.

---

## Timeline summary

| Days | Phase | Exit criterion |
|---|---|---|
| 1–2 | Foundation & DB | Migrations run on a fresh DB |
| 3–5 | Auth & discovery | Register → search → open empty chat |
| 6–9 | Real-time messaging | Live chat works **on deployed URLs** |
| 10–13 | UX polish | Presence, typing, ticks, images |
| 14–16 | Hardening & launch | Test checklist passes in production |

**Buffer:** none built in. If behind schedule, cut in this order: voice notes → image compression → typing indicators.

## Known limitations / future work
- One backend instance; scaling out needs `@socket.io/redis-adapter` and presence moved to Redis.
- No push notifications (offline users see messages on next open).
- No E2E encryption; messages are readable by the server/DB operator.
- Groups, message edit/delete, profile photos, search inside messages.
