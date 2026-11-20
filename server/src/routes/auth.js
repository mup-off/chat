import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { toPublicUser, USER_COLUMNS } from '../db/users.js';
import { config } from '../config.js';
import { parse, schemas } from '../validate.js';
import { badRequest, conflict, unauthorized } from '../errors.js';
import { COOKIE_NAME, signToken, cookieOptions, clearCookieOptions } from '../auth/tokens.js';
import { requireAuth } from '../middleware/requireAuth.js';

const BCRYPT_COST = config.bcryptCost;
// Compared against when the username doesn't exist, so response time doesn't reveal it.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', BCRYPT_COST);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.authRateLimit,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' },
});

const registerSchema = z.object({
  username: schemas.username,
  displayName: schemas.displayName,
  password: schemas.password,
  phone: schemas.phone.optional(),
});

const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1).max(30),
  password: z.string().min(1).max(72),
});

export const authRouter = Router();

authRouter.post('/register', authLimiter, async (req, res) => {
  const body = parse(registerSchema, req.body);
  const passwordHash = await bcrypt.hash(body.password, BCRYPT_COST);

  let row;
  try {
    ({ rows: [row] } = await query(
      `INSERT INTO users (username, display_name, phone, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING ${USER_COLUMNS}`,
      [body.username, body.displayName, body.phone ?? null, passwordHash],
    ));
  } catch (err) {
    if (err.code === '23505') {
      throw conflict(
        err.constraint === 'users_phone_key'
          ? 'That phone number is already registered'
          : 'That username is taken',
      );
    }
    throw err;
  }

  res.cookie(COOKIE_NAME, signToken(row.id), cookieOptions);
  res.status(201).json({ user: toPublicUser(row, { includePrivate: true }) });
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const { username, password } = parse(loginSchema, req.body);
  const { rows: [row] } = await query(
    `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE username = $1`,
    [username],
  );

  const ok = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) throw unauthorized('Invalid username or password');

  res.cookie(COOKIE_NAME, signToken(row.id), cookieOptions);
  res.json({ user: toPublicUser(row, { includePrivate: true }) });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME, clearCookieOptions);
  res.status(204).end();
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password').max(72),
  newPassword: schemas.password,
});

// POST /api/auth/password { currentPassword, newPassword }
authRouter.post('/password', authLimiter, requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = parse(passwordSchema, req.body);
  const { rows: [row] } = await query('SELECT password_hash FROM users WHERE id = $1', [req.userId]);
  if (!row || !(await bcrypt.compare(currentPassword, row.password_hash))) {
    throw unauthorized('Current password is incorrect');
  }
  if (currentPassword === newPassword) throw badRequest('New password must be different');
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [
    req.userId,
    await bcrypt.hash(newPassword, BCRYPT_COST),
  ]);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const { rows: [row] } = await query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [req.userId]);
  if (!row) {
    // Token is valid but the user no longer exists.
    res.clearCookie(COOKIE_NAME, clearCookieOptions);
    throw unauthorized();
  }
  res.json({ user: toPublicUser(row, { includePrivate: true }) });
});
