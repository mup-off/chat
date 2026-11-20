import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { assertParticipant } from '../db/conversations.js';
import { parse, schemas } from '../validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { badRequest, HttpError, notFound } from '../errors.js';
import { presignDownload, presignUpload, storageEnabled, UPLOAD_KINDS } from '../storage.js';

const uploadSchema = z.object({
  conversationId: schemas.uuid,
  kind: z.enum(['image', 'document']).default('image'),
  contentType: z.string().max(200),
  size: z.number().int().positive(),
});

// conv/<conversationId>/<uuid>.<ext>
const EXTENSIONS = [...new Set(Object.values(UPLOAD_KINDS).flatMap((k) => Object.values(k.types)))];
export const MEDIA_KEY_RE = new RegExp(`^conv/([0-9a-f-]{36})/[0-9a-f-]{36}\\.(${EXTENSIONS.join('|')})$`);

/** Strip paths and control characters from a user-supplied file name. */
export function cleanFileName(name) {
  const base = String(name).split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g, '').trim();
  return base.slice(-200) || 'file';
}

function requireStorage(_req, _res, next) {
  if (!storageEnabled()) return next(new HttpError(503, 'File sharing is not configured on this server'));
  next();
}

export const mediaRouter = Router();

// POST /api/uploads { conversationId, kind, contentType, size } -> { uploadUrl, key }
// The browser then PUTs the file straight to storage; the server checks it on send.
mediaRouter.post('/api/uploads', requireAuth, requireStorage, async (req, res) => {
  const { conversationId, kind, contentType, size } = parse(uploadSchema, req.body);
  const rules = UPLOAD_KINDS[kind];
  if (!rules.types[contentType]) {
    throw badRequest(kind === 'image' ? 'Only JPEG, PNG, WebP or GIF images' : 'This file type cannot be sent');
  }
  if (size > rules.maxBytes) {
    throw badRequest(`File is larger than ${rules.maxBytes / 1024 / 1024} MB`);
  }
  await assertParticipant(req.userId, conversationId);
  const key = `conv/${conversationId}/${crypto.randomUUID()}.${rules.types[contentType]}`;
  res.json({ key, uploadUrl: await presignUpload(key, contentType), maxBytes: rules.maxBytes });
});

// GET /api/media/conv/<conversationId>/<file> -> 302 to a short-lived signed URL.
// Stable URL for <img src> / download links; membership is checked on every request,
// and only files that belong to a sent message are served.
mediaRouter.get('/api/media/conv/:conversationId/:file', requireAuth, requireStorage, async (req, res) => {
  const key = `conv/${req.params.conversationId}/${req.params.file}`;
  if (!MEDIA_KEY_RE.test(key)) throw notFound();
  await assertParticipant(req.userId, req.params.conversationId);

  const { rows: [msg] } = await query(
    'SELECT type, media_name FROM messages WHERE media_key = $1 AND conversation_id = $2',
    [key, req.params.conversationId],
  );
  if (!msg) throw notFound();

  res.set('Cache-Control', 'private, max-age=300');
  const downloadAs = msg.type === 'document' ? msg.media_name ?? req.params.file : undefined;
  res.redirect(302, await presignDownload(key, { downloadAs }));
});
