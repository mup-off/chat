import { query } from './pool.js';
import { badRequest } from '../errors.js';
import { avatarUrl } from './users.js';

// Messages joined with: the shared contact's public details (type = 'contact') and a
// short snapshot of the message being replied to (the quote shown above a reply).
const SELECT = `
  SELECT m.id, m.conversation_id, m.sender_id, m.client_msg_id, m.type, m.body,
         m.media_key, m.media_name, m.media_size, m.media_type, m.created_at,
         m.forwarded, m.deleted_at, m.reply_to_id,
         m.contact_user_id, cu.username AS contact_username, cu.display_name AS contact_display_name,
         cu.avatar_key AS contact_avatar_key,
         rm.sender_id AS reply_sender_id, rm.type AS reply_type, left(rm.body, 200) AS reply_body,
         rm.media_name AS reply_media_name, rm.media_key AS reply_media_key, rm.deleted_at AS reply_deleted_at,
         rcu.display_name AS reply_contact_display_name
  FROM messages m
  LEFT JOIN users cu ON cu.id = m.contact_user_id
  LEFT JOIN messages rm ON rm.id = m.reply_to_id
  LEFT JOIN users rcu ON rcu.id = rm.contact_user_id`;

/** Messages this user deleted for themself are excluded from their views. */
const NOT_HIDDEN_FOR = (param) =>
  `NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.user_id = ${param} AND h.message_id = m.id)`;

export function toMessage(row) {
  const deleted = row.deleted_at != null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    clientMsgId: row.client_msg_id,
    type: row.type,
    body: deleted ? null : row.body,
    mediaKey: deleted ? null : row.media_key ?? null,
    mediaName: deleted ? null : row.media_name ?? null,
    mediaSize: deleted || row.media_size == null ? null : Number(row.media_size),
    mediaType: deleted ? null : row.media_type ?? null,
    // null for a contact whose account was deleted
    contact:
      !deleted && row.contact_user_id && row.contact_username
        ? {
            id: row.contact_user_id,
            username: row.contact_username,
            displayName: row.contact_display_name,
            avatarUrl: avatarUrl(row.contact_avatar_key),
          }
        : null,
    forwarded: Boolean(row.forwarded),
    deleted,
    replyTo: row.reply_to_id
      ? {
          id: row.reply_to_id,
          senderId: row.reply_sender_id,
          type: row.reply_type,
          deleted: row.reply_deleted_at != null,
          body: row.reply_deleted_at ? null : row.reply_body,
          mediaName: row.reply_deleted_at ? null : row.reply_media_name,
          mediaKey: row.reply_deleted_at || row.reply_type !== 'image' ? null : row.reply_media_key,
          contactName: row.reply_deleted_at ? null : row.reply_contact_display_name,
        }
      : null,
    createdAt: row.created_at,
  };
}

export async function getMessageById(id, db = { query }) {
  const { rows: [row] } = await db.query(`${SELECT} WHERE m.id = $1`, [id]);
  return row ? toMessage(row) : null;
}

/** Map of id -> message for a batch of ids. */
export async function getMessagesByIds(ids) {
  if (!ids.length) return new Map();
  const { rows } = await query(`${SELECT} WHERE m.id = ANY($1::uuid[])`, [ids]);
  return new Map(rows.map((r) => [r.id, toMessage(r)]));
}

/** The raw row (with storage key etc.) for permission checks and copying. */
export async function getRawMessage(id, db = { query }) {
  const { rows: [row] } = await db.query('SELECT * FROM messages WHERE id = $1', [id]);
  return row ?? null;
}

/**
 * Saves a message idempotently: a retry with the same (sender, clientMsgId)
 * returns the original row with created=false instead of inserting a duplicate.
 * Must run inside a transaction (db = transaction client).
 */
export async function insertMessage(db, m) {
  const { rows: [inserted] } = await db.query(
    `INSERT INTO messages (conversation_id, sender_id, client_msg_id, type, body,
                           media_key, media_name, media_size, media_type, contact_user_id,
                           reply_to_id, forwarded)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (sender_id, client_msg_id) DO NOTHING
     RETURNING id, created_at`,
    [
      m.conversationId, m.senderId, m.clientMsgId, m.type, m.body ?? null,
      m.mediaKey ?? null, m.mediaName ?? null, m.mediaSize ?? null, m.mediaType ?? null,
      m.contactUserId ?? null, m.replyToId ?? null, m.forwarded ?? false,
    ],
  );

  if (inserted) {
    // Only move the pointer forward (two near-simultaneous sends can commit out of order).
    await db.query(
      `UPDATE conversations SET last_message_id = $2, last_message_at = $3
       WHERE id = $1 AND (last_message_at IS NULL OR last_message_at <= $3)`,
      [m.conversationId, inserted.id, inserted.created_at],
    );
    return { message: await getMessageById(inserted.id, db), created: true };
  }

  const { rows: [existing] } = await db.query(
    `${SELECT} WHERE m.sender_id = $1 AND m.client_msg_id = $2`,
    [m.senderId, m.clientMsgId],
  );
  if (existing.conversation_id !== m.conversationId) {
    throw badRequest('clientMsgId was already used for another conversation');
  }
  return { message: toMessage(existing), created: false };
}

/**
 * Keyset pagination on (created_at, id), as seen by `userId` (skips messages they
 * deleted for themself). Cursors are message ids so the exact microsecond timestamp
 * never round-trips through JavaScript.
 * - default: newest `limit` messages
 * - before: `limit` messages older than the cursor
 * - after:  `limit` messages newer than the cursor (catch-up after reconnect)
 * Always returns messages oldest → newest.
 */
export async function listMessages(conversationId, userId, { before, after, limit }) {
  const cursorId = before ?? after;
  if (cursorId) {
    const { rowCount } = await query(
      'SELECT 1 FROM messages WHERE id = $1 AND conversation_id = $2',
      [cursorId, conversationId],
    );
    if (rowCount === 0) throw badRequest('Unknown cursor');
  }

  const cursor = '(SELECT created_at, id FROM messages WHERE id = $4)';
  let sql;
  if (after) {
    sql = `${SELECT}
           WHERE m.conversation_id = $1 AND ${NOT_HIDDEN_FOR('$3')} AND (m.created_at, m.id) > ${cursor}
           ORDER BY m.created_at ASC, m.id ASC LIMIT $2`;
  } else {
    sql = `${SELECT}
           WHERE m.conversation_id = $1 AND ${NOT_HIDDEN_FOR('$3')}
             ${before ? `AND (m.created_at, m.id) < ${cursor}` : ''}
           ORDER BY m.created_at DESC, m.id DESC LIMIT $2`;
  }

  const params = [conversationId, limit + 1, userId, ...(cursorId ? [cursorId] : [])];
  const { rows } = await query(sql, params);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  if (!after) page.reverse();
  return { messages: page.map(toMessage), hasMore };
}
