import { z } from 'zod';
import { schemas } from '../validate.js';
import { query } from '../db/pool.js';
import { assertParticipant, participantIds } from '../db/conversations.js';
import { emitToOthers, handle } from './handle.js';

/**
 * Delivered / read state is a per-participant watermark (last_delivered_at, last_read_at),
 * never a per-message status. A message is delivered/read for someone when its
 * created_at <= their watermark. The other participants get `receipt:update`.
 */

const receiptSchema = z.object({
  conversationId: schemas.uuid,
  upTo: schemas.uuid, // id of the newest message received / seen
});

async function notifyReceipt(io, userId, row) {
  const members = await participantIds(row.conversation_id);
  emitToOthers(io, members, userId, 'receipt:update', {
    conversationId: row.conversation_id,
    userId,
    lastDeliveredAt: row.last_delivered_at,
    lastReadAt: row.last_read_at,
  });
}

/** On connect, everything already sent to this user counts as delivered. */
export async function markAllDelivered(io, userId) {
  const { rows } = await query(
    `UPDATE participants p SET last_delivered_at = c.last_message_at
     FROM conversations c
     WHERE p.user_id = $1 AND c.id = p.conversation_id
       AND c.last_message_at IS NOT NULL
       AND (p.last_delivered_at IS NULL OR p.last_delivered_at < c.last_message_at)
     RETURNING p.conversation_id, p.last_delivered_at, p.last_read_at`,
    [userId],
  );
  await Promise.all(rows.map((row) => notifyReceipt(io, userId, row)));
}

export function registerReceipts(io, socket) {
  const me = socket.data.userId;

  // The recipient's client confirms it received a live message.
  handle(socket, 'message:delivered', receiptSchema, async ({ conversationId, upTo }) => {
    const { rows: [row] } = await query(
      `UPDATE participants p SET last_delivered_at = m.created_at
       FROM messages m
       WHERE m.id = $3 AND m.conversation_id = $1
         AND p.conversation_id = $1 AND p.user_id = $2
         AND (p.last_delivered_at IS NULL OR p.last_delivered_at < m.created_at)
       RETURNING p.conversation_id, p.last_delivered_at, p.last_read_at`,
      [conversationId, me, upTo],
    );
    if (row) await notifyReceipt(io, me, row);
    return {};
  });

  // The user has seen everything up to `upTo` (also implies delivered).
  handle(socket, 'conversation:read', receiptSchema, async ({ conversationId, upTo }) => {
    await assertParticipant(me, conversationId);
    const { rows: [row] } = await query(
      `UPDATE participants p
       SET last_read_at = GREATEST(p.last_read_at, m.created_at),
           last_delivered_at = GREATEST(p.last_delivered_at, m.created_at)
       FROM messages m
       WHERE m.id = $3 AND m.conversation_id = $1
         AND p.conversation_id = $1 AND p.user_id = $2
         AND (p.last_read_at IS NULL OR p.last_read_at < m.created_at)
       RETURNING p.conversation_id, p.last_delivered_at, p.last_read_at`,
      [conversationId, me, upTo],
    );
    // Clear the unread badge in my other tabs.
    socket.to(`user:${me}`).emit('conversation:read', { conversationId, upTo });
    if (row) await notifyReceipt(io, me, row);
    return {};
  });
}
