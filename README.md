# Chat

WhatsApp-style chat app. See [plan.md](plan.md) for the full implementation plan.

## Requirements
- Node.js 22+
- Docker Desktop (for the dev database), or any PostgreSQL 14+

## First-time setup
```sh
npm install
docker compose up -d --wait          # Postgres :5433, Adminer :8080, image storage :9000
cp server/.env.example server/.env   # then set JWT_SECRET to a random value
npm run migrate                      # create tables
npm run seed                         # test users: alice, bob, carol / password123
npm run storage:setup -w server      # create the image bucket + allow browser uploads
```

Image storage in dev is [RustFS](https://github.com/rustfs/rustfs), an S3-compatible server (console at http://localhost:9001, login `chatdev` / `chatdev-secret`). In production point the `S3_*` variables at Cloudflare R2 or AWS S3 and run `storage:setup` once with `CLIENT_ORIGIN` set to the real frontend URL. If `S3_BUCKET` is unset, everything works except image sharing.

To use your own PostgreSQL instead of Docker, create a `chat` database and set `DATABASE_URL` in `server/.env`.

## Development
```sh
npm run dev:server   # http://localhost:4000  (API + Socket.io)
npm run dev:client   # http://localhost:5173  (proxies /api and /socket.io to :4000)
```

Browse the database at http://localhost:8080 (Adminer): System **PostgreSQL**, Server **db**, user/password/database **chat**.

## Tests
Server tests run against a separate `chat_test` database (`TEST_DATABASE_URL`), never the dev DB.
```sh
npm run test:db -w server   # once (and after adding migrations): create + migrate chat_test
npm test -w server
```

## Database scripts (run from repo root)
| Command | What it does |
|---|---|
| `npm run migrate` | Apply pending migrations |
| `npm run migrate:down -w server` | Roll back the last migration |
| `npm run migrate:create -w server -- <name>` | New SQL migration in `server/migrations/` |
| `npm run seed` | Insert test users (safe to re-run) |
| `npm run db:check -w server` | List tables and indexes |

## Layout
```
client/           React + Vite + Tailwind v4
server/
  migrations/     SQL migrations (node-pg-migrate)
  scripts/        seed, db check, test DB + storage setup
  src/
    config.js     env vars
    db/           pool, queries (conversations, messages, users)
    routes/       REST: auth, users, conversations, media (uploads)
    sockets/      messaging, receipts (✓✓), typing; presence wiring in index.js
    presence.js   in-memory online tracking (single instance)
    storage.js    S3-compatible client, presigned URLs
  test/           node:test suites (npm test -w server)
```
