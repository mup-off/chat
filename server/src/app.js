import http from 'node:http';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { Server } from 'socket.io';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { conversationsRouter } from './routes/conversations.js';
import { mediaRouter } from './routes/media.js';
import { profileRouter } from './routes/profile.js';
import { requireAuth } from './middleware/requireAuth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { registerSockets } from './sockets/index.js';

/** Builds the HTTP server + Socket.io instance without listening (used by tests too). */
export function createServer() {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use(cors({ origin: config.clientOrigin, credentials: true }));
  app.use(express.json({ limit: '16kb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, db: 'up' });
    } catch {
      res.status(503).json({ ok: false, db: 'down' });
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api/users', requireAuth, usersRouter);
  app.use('/api/conversations', requireAuth, conversationsRouter);
  app.use(mediaRouter); // /api/uploads, /api/media/...
  app.use(profileRouter); // /api/me, /api/me/avatar-upload, /api/avatars/...

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: config.clientOrigin, credentials: true },
    maxHttpBufferSize: 64 * 1024,
  });
  registerSockets(io);
  app.set('io', io); // lets REST routes push socket events (e.g. profile updates)

  return { app, server, io };
}
