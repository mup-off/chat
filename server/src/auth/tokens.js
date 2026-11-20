import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export const COOKIE_NAME = 'token';
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function signToken(userId) {
  return jwt.sign({}, config.jwtSecret, {
    subject: userId,
    expiresIn: MAX_AGE_SECONDS,
    algorithm: 'HS256',
  });
}

/** Returns the user id, or null if the token is missing/invalid/expired. */
export function verifyToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

// Frontend and API live on different domains in production → SameSite=None; Secure.
export const cookieOptions = {
  httpOnly: true,
  secure: config.isProd,
  sameSite: config.isProd ? 'none' : 'lax',
  path: '/',
  maxAge: MAX_AGE_SECONDS * 1000,
};

export const clearCookieOptions = { ...cookieOptions, maxAge: undefined };
