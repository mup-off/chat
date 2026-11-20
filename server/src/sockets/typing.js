import { z } from 'zod';
import { schemas } from '../validate.js';
import { participantIds } from '../db/conversations.js';
import { emitToOthers, handle } from './handle.js';

const typingSchema = z.object({ conversationId: schemas.uuid });

/**
 * typing:start / typing:stop are relayed to the other participants as
 * `typing { conversationId, userId, typing }`. Nothing is stored. Clients send
 * start at most every 2 s while typing and auto-expire the indicator after 5 s.
 *
 * Events from one socket are processed strictly in order: each needs an async
 * membership lookup, and a "stop" overtaking its "start" would leave the
 * indicator stuck on the other side.
 */
export function registerTyping(io, socket) {
  const me = socket.data.userId;
  let queue = Promise.resolve();

  for (const [event, typing] of [['typing:start', true], ['typing:stop', false]]) {
    handle(socket, event, typingSchema, ({ conversationId }) => {
      queue = queue.then(async () => {
        const members = await participantIds(conversationId);
        if (!members.includes(me)) return; // silently ignore non-members
        emitToOthers(io, members, me, 'typing', { conversationId, userId: me, typing });
      }).catch((err) => console.error('typing relay failed', err));
      return queue.then(() => ({}));
    });
  }
}
