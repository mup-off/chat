import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { contactIds } from '../db/conversations.js';
import { toPublicUser, USER_COLUMNS, WALLPAPERS } from '../db/users.js';
import { parse, schemas } from '../validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { badRequest, HttpError, notFound } from '../errors.js';
import { deleteObject, headObject, presignDownload, presignUpload, storageEnabled } from '../storage.js';

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
// avatars/<userId>/<uuid>.<ext>
const AVATAR_KEY_RE = /^avatars\/([0-9a-f-]{36})\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

const updateSchema = z
  .object({
    displayName: schemas.displayName.optional(),
    // "" clears it
    about: z.string().trim().max(140, 'At most 140 characters').optional(),
    // null removes the photo
    avatarKey: z.string().max(200).nullable().optional(),
    theme: z.enum(['light', 'dark', 'system']).optional(),
    wallpaper: z.enum(WALLPAPERS).optional(),
  })
  .strict();

const uploadSchema = z.object({
  contentType: z.string().max(100),
  size: z.number().int().positive(),
});

function requireStorage(_req, _res, next) {
  if (!storageEnabled()) return next(new HttpError(503, 'Photo uploads are not configured on this server'));
  next();
}

/** Tell my contacts and my other tabs that my public profile changed. */
async function broadcastProfile(io, user) {
  if (!io) return;
  const rooms = [user.id, ...(await contactIds(user.id))].map((id) => `user:${id}`);
  const { phone, settings, ...publicUser } = user; // never send private fields to contacts
  io.to(rooms).emit('user:updated', { user: publicUser });
}

export const profileRouter = Router();

// PATCH /api/me — update profile and settings (any subset of fields).
profileRouter.patch('/api/me', requireAuth, async (req, res) => {
  const body = parse(updateSchema, req.body);
  const sets = [];
  const params = [req.userId];
  const set = (column, value) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  let oldAvatar = null;
  if (body.avatarKey !== undefined) {
    const { rows: [cur] } = await query('SELECT avatar_key FROM users WHERE id = $1', [req.userId]);
    oldAvatar = cur?.avatar_key ?? null;
    if (body.avatarKey !== null) {
      // Must be my own fresh upload, and really a small image.
      const m = AVATAR_KEY_RE.exec(body.avatarKey);
      if (!m || m[1] !== req.userId) throw badRequest('Invalid photo');
      const head = await headObject(body.avatarKey);
      if (!head || head.size > MAX_AVATAR_BYTES || !AVATAR_TYPES[head.contentType]) {
        throw badRequest('Photo upload not found or invalid');
      }
    }
    set('avatar_key', body.avatarKey);
  }
  if (body.displayName !== undefined) set('display_name', body.displayName);
  if (body.about !== undefined) set('about', body.about || null);
  if (body.theme !== undefined) set('theme', body.theme);
  if (body.wallpaper !== undefined) set('wallpaper', body.wallpaper);
  if (!sets.length) throw badRequest('Nothing to update');

  const { rows: [row] } = await query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $1 RETURNING ${USER_COLUMNS}`,
    params,
  );
  const user = toPublicUser(row, { includePrivate: true });

  if (oldAvatar && oldAvatar !== row.avatar_key) await deleteObject(oldAvatar);
  // Only profile changes matter to others; theme/wallpaper are private.
  if (body.displayName !== undefined || body.about !== undefined || body.avatarKey !== undefined) {
    await broadcastProfile(req.app.get('io'), user).catch((err) => console.error('profile broadcast', err));
  }
  res.json({ user });
});

// POST /api/me/avatar-upload { contentType, size } -> { uploadUrl, key }
profileRouter.post('/api/me/avatar-upload', requireAuth, requireStorage, async (req, res) => {
  const { contentType, size } = parse(uploadSchema, req.body);
  if (!AVATAR_TYPES[contentType]) throw badRequest('Use a JPEG, PNG or WebP image');
  if (size > MAX_AVATAR_BYTES) throw badRequest('Photo is larger than 2 MB');
  const key = `avatars/${req.userId}/${crypto.randomUUID()}.${AVATAR_TYPES[contentType]}`;
  res.json({ key, uploadUrl: await presignUpload(key, contentType) });
});

// GET /api/avatars/<userId>/<file> -> 302 to a signed URL. Any signed-in user can see
// profile photos (like WhatsApp's default), but only a user's *current* photo is served.
profileRouter.get('/api/avatars/:userId/:file', requireAuth, requireStorage, async (req, res) => {
  const key = `avatars/${req.params.userId}/${req.params.file}`;
  if (!AVATAR_KEY_RE.test(key)) throw notFound();
  const { rowCount } = await query('SELECT 1 FROM users WHERE id = $1 AND avatar_key = $2', [req.params.userId, key]);
  if (rowCount === 0) throw notFound();
  // The key changes whenever the photo changes, so the redirect can be cached (less than
  // the signed URL's 1 h lifetime).
  res.set('Cache-Control', 'private, max-age=3000');
  res.redirect(302, await presignDownload(key));
});

