import { query } from './pool.js';
import { notFound } from '../errors.js';
import { getMessagesByIds } from './messages.js';
import { isOnline } from '../presence.js';
import { avatarUrl } from './users.js';

/**
 * Throws 404 unless userId is a participant of conversationId.
 * 404 (not 403) so non-members can't probe which conversation ids exist.
 */
export async function assertParticipant(userId, conversationId, db = { query }) {
  const { rowCount } = await db.query(
    'SELECT 1 FROM participants WHERE conversation_id = $1 AND user_id = $2',
    [conversationId, userId],
  );
  if (rowCount === 0) throw notFound('Conversation not found');
}

/** Everyone who shares a conversation with userId (who should see their presence). */
export async function contactIds(userId) {
  const { rows } = await query(
    `SELECT DISTINCT op.user_id FROM participants me
     JOIN participants op ON op.conversation_id = me.conversation_id AND op.user_id <> me.user_id
     WHERE me.user_id = $1`,
    [userId],
  );
  return rows.map((r) => r.user_id);
}

/** User ids of everyone in a conversation. */
export async function participantIds(conversationId, db = { query }) {
  const { rows } = await db.query(
    'SELECT user_id FROM participants WHERE conversation_id = $1',
    [conversationId],
  );
  return rows.map((r) => r.user_id);
}

// One row per conversation, as seen by $1: the other participant, my last *visible*
// message (skipping ones I deleted for myself), and how many messages from others
// arrived after my last_read_at (not counting hidden or deleted ones).
const SUMMARY_SQL = `
  SELECT c.id, c.type, c.created_at, c.last_message_at,
         u.id AS other_id, u.username AS other_username,
         u.display_name AS other_display_name, u.last_seen_at AS other_last_seen_at,
         u.about AS other_about, u.avatar_key AS other_avatar_key,
         op.last_delivered_at AS other_last_delivered_at, op.last_read_at AS other_last_read_at,
         lm.id AS last_message_id,
         (SELECT count(*)::int FROM messages x
           WHERE x.conversation_id = c.id
             AND x.sender_id <> $1
             AND x.deleted_at IS NULL
             AND x.created_at > COALESCE(me.last_read_at, '-infinity')
             AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.user_id = $1 AND h.message_id = x.id)
         ) AS unread_count
  FROM participants me
  JOIN conversations c ON c.id = me.conversation_id
  LEFT JOIN participants op ON op.conversation_id = c.id AND op.user_id <> $1
  LEFT JOIN users u ON u.id = op.user_id
  LEFT JOIN LATERAL (
    SELECT x.id FROM messages x
    WHERE x.conversation_id = c.id
      AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.user_id = $1 AND h.message_id = x.id)
    ORDER BY x.created_at DESC, x.id DESC
    LIMIT 1
  ) lm ON true
  WHERE me.user_id = $1`;

async function toSummaries(rows) {
  const lastMessages = await getMessagesByIds(rows.map((r) => r.last_message_id).filter(Boolean));
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
    otherUser: row.other_id
      ? {
          id: row.other_id,
          username: row.other_username,
          displayName: row.other_display_name,
          about: row.other_about,
          avatarUrl: avatarUrl(row.other_avatar_key),
          lastSeenAt: row.other_last_seen_at,
          online: isOnline(row.other_id),
        }
      : null,
    // How far the other person has received / read (drives ✓✓ and blue ✓✓ on my messages).
    receipts: {
      lastDeliveredAt: row.other_last_delivered_at,
      lastReadAt: row.other_last_read_at,
    },
    lastMessage: lastMessages.get(row.last_message_id) ?? null,
    unreadCount: row.unread_count,
  }));
}

/** Chats that have had at least one message, newest activity first. */
export async function listConversationsForUser(userId) {
  const { rows } = await query(
    `${SUMMARY_SQL} AND c.last_message_id IS NOT NULL
     ORDER BY c.last_message_at DESC, c.id`,
    [userId],
  );
  return toSummaries(rows);
}

/** A single conversation summary; 404 unless userId is a participant. */
export async function getConversationForUser(userId, conversationId) {
  const { rows } = await query(`${SUMMARY_SQL} AND c.id = $2`, [userId, conversationId]);
  if (!rows.length) throw notFound('Conversation not found');
  return (await toSummaries(rows))[0];
}
