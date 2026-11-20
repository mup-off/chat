import { COOKIE_NAME, verifyToken } from '../auth/tokens.js';
import { unauthorized } from '../errors.js';

export function requireAuth(req, _res, next) {
  const userId = verifyToken(req.cookies?.[COOKIE_NAME]);
  if (!userId) return next(unauthorized());
  req.userId = userId;
  next();
}
