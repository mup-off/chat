import { parseCookie } from 'cookie';
import { COOKIE_NAME, verifyToken } from '../auth/tokens.js';
import { query } from '../db/pool.js';
import { contactIds } from '../db/conversations.js';
import { addSocket, removeSocket } from '../presence.js';
import { userRoom } from './handle.js';
import { registerMessaging } from './messaging.js';
import { markAllDelivered, registerReceipts } from './receipts.js';
import { registerTyping } from './typing.js';
import { registerMessageActions } from './messageActions.js';

export { userRoom };

/** Tell everyone who shares a chat with userId that they came online / went offline. */
async function broadcastPresence(io, userId, online, lastSeenAt = null) {
  const contacts = await contactIds(userId);
  if (contacts.length) {
    io.to(contacts.map(userRoom)).emit('presence:update', { userId, online, lastSeenAt });
  }
}

const logError = (what) => (err) => console.error(what, err);

export function registerSockets(io) {
  // Authenticate the handshake with the same httpOnly cookie the REST API uses.
  io.use((socket, next) => {
    const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
    const userId = verifyToken(cookies[COOKIE_NAME]);
    if (!userId) return next(new Error('unauthorized'));
    socket.data.userId = userId;
    next();
  });

  io.on('connection', (socket) => {
    const me = socket.data.userId;
    // Every socket joins its user's personal room; all events are delivered via these rooms.
    socket.join(userRoom(me));

    // Register handlers synchronously so no early event is missed.
    registerMessaging(io, socket);
    registerReceipts(io, socket);
    registerTyping(io, socket);
    registerMessageActions(io, socket);

    if (addSocket(me, socket.id)) {
      broadcastPresence(io, me, true).catch(logError('presence online'));
    }
    socket.on('disconnect', () => {
      removeSocket(me, socket.id, async (lastSeenAt) => {
        try {
          await query('UPDATE users SET last_seen_at = $2 WHERE id = $1', [me, lastSeenAt]);
          await broadcastPresence(io, me, false, lastSeenAt);
        } catch (err) {
          logError('presence offline')(err);
        }
      });
    });

    markAllDelivered(io, me).catch(logError('mark delivered'));
  });
}
