import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { toPublicUser, USER_COLUMNS } from '../db/users.js';
import { parse } from '../validate.js';

const searchSchema = z.object({
  search: z.string().trim().min(2, 'At least 2 characters').max(50),
});

/** Escape LIKE wildcards so user input is matched literally. */
const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// Partial phone matching makes number-guessing possible, so cap searches per user.
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (req) => req.userId,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many searches. Slow down a little.' },
});

export const usersRouter = Router();

// GET /api/users?search=q  (search-as-you-type)
// Matches when q appears anywhere in the username or display name (case-insensitive),
// or, if q has 2+ digits, anywhere in the phone number. Local format works too:
// "0780..." also matches "+250780...". Phone numbers are never returned.
usersRouter.get('/', searchLimiter, async (req, res) => {
  const { search } = parse(searchSchema, req.query);

  const text = escapeLike(search.toLowerCase());
  const digits = search.replace(/\D/g, '');
  const phonePatterns = [];
  if (digits.length >= 2) {
    phonePatterns.push(`%${digits}%`);
    // Local numbers start with 0 (0780…); stored numbers are international (+250780…).
    if (digits.startsWith('0') && digits.length >= 3) phonePatterns.push(`%${digits.slice(1)}%`);
  }

  const { rows } = await query(
    `SELECT ${USER_COLUMNS} FROM users
     WHERE id <> $1
       AND (
         username LIKE $2
         OR lower(display_name) LIKE $2
         OR phone LIKE ANY ($3::text[])
       )
     ORDER BY
       (username LIKE $4 OR lower(display_name) LIKE $4) DESC,  -- starts with q
       display_name, username
     LIMIT 20`,
    [req.userId, `%${text}%`, phonePatterns, `${text}%`],
  );

  res.json({ users: rows.map((r) => toPublicUser(r)) });
});
