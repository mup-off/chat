import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/pool.js';
import {
  assertParticipant,
  getConversationForUser,
  listConversationsForUser,
} from '../db/conversations.js';
import { listMessages } from '../db/messages.js';
import { parse, schemas } from '../validate.js';
import { badRequest, notFound } from '../errors.js';

const createSchema = z.object({ userId: schemas.uuid });
const idParams = z.object({ id: schemas.uuid });
const messagesQuery = z
  .object({
    before: schemas.uuid.optional(),
    after: schemas.uuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .refine((q) => !(q.before && q.after), 'Use either before or after, not both');

export const conversationsRouter = Router();

// GET /api/conversations - my chats that have messages, most recent first.
conversationsRouter.get('/', async (req, res) => {
  res.json({ conversations: await listConversationsForUser(req.userId) });
});

// POST /api/conversations { userId } - find or create the direct chat with userId.
// Atomic: the unique direct_key + ON CONFLICT means concurrent calls get the same row.
conversationsRouter.post('/', async (req, res) => {
  const { userId: otherId } = parse(createSchema, req.body);
  if (otherId === req.userId) throw badRequest('You cannot start a chat with yourself');

  const { rowCount } = await query('SELECT 1 FROM users WHERE id = $1', [otherId]);
  if (rowCount === 0) throw notFound('User not found');

  const directKey = [req.userId, otherId].sort().join(':');

  const { id, created } = await withTransaction(async (client) => {
    const { rows: [conv] } = await client.query(
      `INSERT INTO conversations (type, direct_key) VALUES ('direct', $1)
       ON CONFLICT (direct_key) DO UPDATE SET direct_key = EXCLUDED.direct_key
       RETURNING id, (xmax = 0) AS created`,
      [directKey],
    );
    await client.query(
      `INSERT INTO participants (conversation_id, user_id)
       VALUES ($1, $2), ($1, $3)
       ON CONFLICT DO NOTHING`,
      [conv.id, req.userId, otherId],
    );
    return conv;
  });

  const conversation = await getConversationForUser(req.userId, id);
  res.status(created ? 201 : 200).json({ conversation });
});

// GET /api/conversations/:id - 404 unless the caller is a participant.
conversationsRouter.get('/:id', async (req, res) => {
  const { id } = parse(idParams, req.params);
  res.json({ conversation: await getConversationForUser(req.userId, id) });
});

// GET /api/conversations/:id/messages?before=<msgId>|after=<msgId>&limit=30
conversationsRouter.get('/:id/messages', async (req, res) => {
  const { id } = parse(idParams, req.params);
  const opts = parse(messagesQuery, req.query);
  await assertParticipant(req.userId, id);
  res.json(await listMessages(id, req.userId, opts));
});
