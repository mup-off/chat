import { z } from 'zod';
import { schemas } from '../validate.js';
import { badRequest, notFound } from '../errors.js';
import { query, withTransaction } from '../db/pool.js';
import { assertParticipant, participantIds } from '../db/conversations.js';
import { getRawMessage, insertMessage } from '../db/messages.js';
import { headObject, storageEnabled, UPLOAD_KINDS } from '../storage.js';
import { cleanFileName, MEDIA_KEY_RE } from '../routes/media.js';
import { handle, userRoom } from './handle.js';

const sendMessageSchema = z.object({
  conversationId: schemas.uuid,
  clientMsgId: schemas.uuid,
  type: z.enum(['text', 'image', 'document', 'contact']).default('text'),
  body: z.string().trim().max(4000, 'Message is too long (max 4000 characters)').optional(),
  mediaKey: z.string().max(200).optional(),
  fileName: z.string().max(500).optional(),
  contactUserId: schemas.uuid.optional(),
  replyToId: schemas.uuid.optional(),
});

/**
 * Checks an uploaded file before it's attached to a message: right conversation,
 * object exists, and its stored size and content type fit the kind's whitelist.
 * Storage doesn't enforce the signed content type, so this is the real guard.
 */
async function verifyUpload(kind, conversationId, mediaKey) {
  if (!storageEnabled()) throw badRequest('File sharing is not configured on this server');
  const match = mediaKey && MEDIA_KEY_RE.exec(mediaKey);
  if (!match || match[1] !== conversationId) throw badRequest('Invalid attachment');
  const rules = UPLOAD_KINDS[kind];
  const ext = mediaKey.split('.').pop();
  if (!Object.values(rules.types).includes(ext)) throw badRequest('Invalid attachment');
  const head = await headObject(mediaKey);
  if (!head || head.size > rules.maxBytes || !rules.types[head.contentType]) {
    throw badRequest('Upload not found or invalid');
  }
  return head;
}

/** Validates the type-specific parts of a message and returns the columns to store. */
async function buildMessage(me, { conversationId, type, body, mediaKey, fileName, contactUserId }) {
  body = body || null; // "" -> null (e.g. attachment without caption)
  switch (type) {
    case 'text':
      if (!body) throw badRequest('Message is empty');
      return { type, body };

    case 'image':
    case 'document': {
      await assertParticipant(me, conversationId);
      const head = await verifyUpload(type, conversationId, mediaKey);
      return {
        type,
        body,
        mediaKey,
        mediaSize: head.size,
        mediaType: head.contentType,
        mediaName: type === 'document' ? cleanFileName(fileName ?? mediaKey.split('/').pop()) : null,
      };
    }

    case 'contact': {
      if (!contactUserId) throw badRequest('Choose a contact to share');
      const { rowCount } = await query('SELECT 1 FROM users WHERE id = $1', [contactUserId]);
      if (rowCount === 0) throw notFound('That user no longer exists');
      return { type, body: null, contactUserId };
    }
  }
}

export function registerMessaging(io, socket) {
  const me = socket.data.userId;

  handle(socket, 'send_message', sendMessageSchema, async (input) => {
    const { conversationId, clientMsgId, replyToId } = input;
    const fields = await buildMessage(me, input);
    if (replyToId) {
      const original = await getRawMessage(replyToId);
      if (!original || original.conversation_id !== conversationId || original.deleted_at) {
        throw badRequest('You can’t reply to that message');
      }
      fields.replyToId = replyToId;
    }

    const { message, created, members } = await withTransaction(async (db) => {
      await assertParticipant(me, conversationId, db);
      const result = await insertMessage(db, { conversationId, senderId: me, clientMsgId, ...fields });
      return { ...result, members: await participantIds(conversationId, db) };
    });

    // A retry of an already-saved message only needs the ack; everyone already has it.
    // Rooms cover the recipient, the sender's other tabs, and sidebar previews.
    if (created) io.to(members.map(userRoom)).emit('message:new', message);
    return { message };
  });
}
