import { HttpError } from '../errors.js';
import { parse } from '../validate.js';

export const userRoom = (userId) => `user:${userId}`;

/**
 * Registers a socket event handler with validation and a uniform ack:
 * success -> { ok: true, ...result }, failure -> { ok: false, error }.
 * Errors never disconnect the socket. The ack is optional for fire-and-forget events.
 */
export function handle(socket, event, schema, fn) {
  socket.on(event, async (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      const data = parse(schema, payload ?? {});
      reply({ ok: true, ...(await fn(data)) });
    } catch (err) {
      if (err instanceof HttpError) return reply({ ok: false, error: err.message });
      console.error(`socket ${event} failed`, err);
      reply({ ok: false, error: 'Internal server error' });
    }
  });
}

/** Emit to every participant except `exceptUserId`. */
export function emitToOthers(io, memberIds, exceptUserId, event, payload) {
  const rooms = memberIds.filter((id) => id !== exceptUserId).map(userRoom);
  if (rooms.length) io.to(rooms).emit(event, payload);
}
