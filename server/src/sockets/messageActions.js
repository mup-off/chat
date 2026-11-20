import { z } from 'zod';
import { schemas } from '../validate.js';
import { badRequest, HttpError, notFound } from '../errors.js';
import { query, withTransaction } from '../db/pool.js';
import { assertParticipant, participantIds } from '../db/conversations.js';
import { getMessageById, getRawMessage, insertMessage } from '../db/messages.js';
import { copyObject, deleteObject } from '../storage.js';
import { handle, userRoom } from './handle.js';

/** How long after sending a message its sender can still delete it for everyone. */
export const DELETE_FOR_EVERYONE_MS = 48 * 60 * 60 * 1000;
const MAX_FORWARD_TARGETS = 5;

const deleteSchema = z.object({
  messageId: schemas.uuid,
  scope: z.enum(['me', 'everyone']),
});

const forwardSchema = z.object({
  messageId: schemas.uuid,
  targets: z
    .array(z.object({ conversationId: schemas.uuid, clientMsgId: schemas.uuid }))
    .min(1, 'Choose at least one chat')
    .max(MAX_FORWARD_TARGETS, `You can forward to up to ${MAX_FORWARD_TARGETS} chats at a time`),
});

/** Loads a message the user can see, or 404. */
async function loadVisible(me, messageId) {
  const msg = await getRawMessage(messageId);
  if (!msg) throw notFound('Message not found');
  await assertParticipant(me, msg.conversation_id).catch(() => {
    throw notFound('Message not found');
  });
  return msg;
}

export function registerMessageActions(io, socket) {
  const me = socket.data.userId;

  // ------------------------------------------------------------- delete
  handle(socket, 'message:delete', deleteSchema, async ({ messageId, scope }) => {
    const msg = await loadVisible(me, messageId);
    const conversationId = msg.conversation_id;

    if (scope === 'me') {
      // Hidden for me only; other participants are unaffected.
      await query(
        'INSERT INTO message_hidden (user_id, message_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [me, messageId],
      );
      io.to(userRoom(me)).emit('message:hidden', { conversationId, messageId });
      return {};
    }

    if (msg.sender_id !== me) throw new HttpError(403, 'You can only delete your own messages for everyone');
    if (msg.deleted_at) return { message: await getMessageById(messageId) }; // already deleted
    if (Date.now() - new Date(msg.created_at).getTime() > DELETE_FOR_EVERYONE_MS) {
      throw badRequest('This message is too old to delete for everyone');
    }

    // Keep the row as a tombstone (keeps ordering, replies and cursors intact), drop the content.
    await query(
      `UPDATE messages
       SET deleted_at = now(), body = NULL, media_key = NULL, media_name = NULL,
           media_size = NULL, media_type = NULL, contact_user_id = NULL
       WHERE id = $1 AND deleted_at IS NULL`,
      [messageId],
    );
    if (msg.media_key) await deleteObject(msg.media_key);

    const members = await participantIds(conversationId);
    io.to(members.map(userRoom)).emit('message:deleted', { conversationId, messageId });
    return { message: await getMessageById(messageId) };
  });

  // ------------------------------------------------------------- forward
  handle(socket, 'message:forward', forwardSchema, async ({ messageId, targets }) => {
    const source = await loadVisible(me, messageId);
    if (source.deleted_at) throw badRequest('This message was deleted');

    const results = [];
    for (const { conversationId, clientMsgId } of targets) {
      await assertParticipant(me, conversationId);

      // Retry of an earlier forward: return what was saved, don't copy the file again.
      const { rows: [already] } = await query(
        'SELECT id, conversation_id FROM messages WHERE sender_id = $1 AND client_msg_id = $2',
        [me, clientMsgId],
      );
      if (already) {
        if (already.conversation_id !== conversationId) throw badRequest('clientMsgId was already used');
        results.push(await getMessageById(already.id));
        continue;
      }

      // Files are copied into the target conversation's own folder, so access control
      // (and "delete for everyone" in either chat) stays independent.
      let mediaKey = null;
      if (source.media_key) {
        const ext = source.media_key.split('.').pop();
        mediaKey = `conv/${conversationId}/${crypto.randomUUID()}.${ext}`;
        await copyObject(source.media_key, mediaKey);
      }

      const { message, created, members } = await withTransaction(async (db) => {
        const result = await insertMessage(db, {
          conversationId,
          senderId: me,
          clientMsgId,
          type: source.type,
          body: source.body,
          mediaKey,
          mediaName: source.media_name,
          mediaSize: source.media_size,
          mediaType: source.media_type,
          contactUserId: source.contact_user_id,
          forwarded: true,
        });
        return { ...result, members: await participantIds(conversationId, db) };
      });
      if (created) io.to(members.map(userRoom)).emit('message:new', message);
      results.push(message);
    }
    return { messages: results };
  });
}
