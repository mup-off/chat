import { create } from 'zustand';
import { api } from '../lib/api.js';
import { compressImage, uploadWithProgress } from '../lib/images.js';

const SEND_TIMEOUT_MS = 10_000;
const TYPING_RESEND_MS = 2_000; // re-send typing:start at most this often while typing
const TYPING_IDLE_MS = 2_000; // typing:stop after this long without a keystroke
const TYPING_EXPIRE_MS = 5_000; // hide someone's indicator if no update arrives

/**
 * Client-side chat state.
 * - conversations: id -> summary { id, otherUser{online,lastSeenAt}, receipts, lastMessage, unreadCount }
 * - threads: id -> { messages, hasMore, status: 'loading'|'ready'|'error', error, loadingOlder }
 * - typing: conversationId -> userId currently typing there
 * Messages carry a local `status`: 'pending' | 'failed' | 'sent'. clientMsgId is the stable
 * React key and how an optimistic message is matched to the saved one.
 */

let socket = null;
let me = null;
const uploads = new Map(); // clientMsgId -> { file, blob, contentType } kept for retries
const typingExpiry = new Map(); // conversationId -> timer (incoming indicators)
const myTyping = { conversationId: null, lastStart: 0, stopTimer: null }; // outgoing

const isVisible = () => document.visibilityState === 'visible';
const sent = (m) => ({ ...m, status: 'sent' });
const lastServerMessage = (messages) => [...messages].reverse().find((m) => m.id);

/** Insert or replace a message by id or (sender, clientMsgId); keeps list order. */
function mergeMessage(messages, msg) {
  if (msg.id && messages.some((m) => m.id === msg.id && m.status === 'sent')) return messages;
  const i = messages.findIndex((m) => m.clientMsgId === msg.clientMsgId && m.senderId === msg.senderId);
  if (i === -1) return [...messages, msg];
  const next = messages.slice();
  // Keep the local preview of an image so it doesn't flicker when the server copy arrives.
  next[i] = messages[i].localUrl ? { localUrl: messages[i].localUrl, ...msg } : msg;
  return next;
}

/** The quote snapshot stored on a reply (same shape the server returns as replyTo). */
export function quoteOf(m) {
  return {
    id: m.id,
    senderId: m.senderId,
    type: m.type,
    deleted: !!m.deleted,
    body: m.deleted ? null : (m.body ?? '').slice(0, 200) || null,
    mediaName: m.mediaName ?? null,
    mediaKey: m.type === 'image' ? m.mediaKey ?? null : null,
    contactName: m.contact?.displayName ?? null,
  };
}

/** A message after "delete for everyone": content gone, tombstone kept. */
const tombstone = (m) => ({
  ...m,
  deleted: true,
  body: null,
  mediaKey: null,
  mediaName: null,
  mediaSize: null,
  contact: null,
  localUrl: undefined,
});

/** ✓ / ✓✓ / blue ✓✓ for one of my messages, from the other person's watermarks. */
export function tickFor(message, receipts) {
  if (message.status !== 'sent') return message.status;
  const t = new Date(message.createdAt).getTime();
  if (receipts?.lastReadAt && t <= new Date(receipts.lastReadAt).getTime()) return 'read';
  if (receipts?.lastDeliveredAt && t <= new Date(receipts.lastDeliveredAt).getTime()) return 'delivered';
  return 'sent';
}

export const useChat = create((set, get) => {
  const patchConversation = (id, patch) =>
    set((s) => {
      const c = s.conversations[id];
      return c ? { conversations: { ...s.conversations, [id]: { ...c, ...patch(c) } } } : {};
    });

  const clearTyping = (conversationId) => {
    clearTimeout(typingExpiry.get(conversationId));
    typingExpiry.delete(conversationId);
    set((s) => {
      if (!s.typing[conversationId]) return {};
      const typing = { ...s.typing };
      delete typing[conversationId];
      return { typing };
    });
  };

  return {
    conversations: {},
    threads: {},
    typing: {},
    activeId: null,
    connected: false,

    /** Wire the store to a connected socket for the logged-in user. */
    attach(user, s) {
      me = user;
      socket = s;
    },

    reset() {
      socket = null;
      me = null;
      uploads.clear();
      typingExpiry.forEach(clearTimeout);
      typingExpiry.clear();
      clearTimeout(myTyping.stopTimer);
      Object.assign(myTyping, { conversationId: null, lastStart: 0, stopTimer: null });
      set({ conversations: {}, threads: {}, typing: {}, activeId: null, connected: false });
    },

    setConnected: (connected) => set({ connected }),

    setActive(id) {
      set({ activeId: id });
      if (id) get().markRead(id);
    },

    /** Called when the tab becomes visible again. */
    onVisible() {
      const id = get().activeId;
      if (id) get().markRead(id);
    },

    upsertConversation(summary) {
      set((s) => ({ conversations: { ...s.conversations, [summary.id]: summary } }));
    },

    async loadConversations() {
      const { conversations } = await api.get('/api/conversations');
      set((s) => {
        // Keep chats opened locally that have no messages yet (the server list omits them).
        const map = Object.fromEntries(
          Object.values(s.conversations).filter((c) => !c.lastMessage).map((c) => [c.id, c]),
        );
        for (const c of conversations) map[c.id] = c;
        return { conversations: map };
      });
      get().onVisible(); // the open chat may have had unread messages
    },

    async ensureConversation(id) {
      if (get().conversations[id]) return;
      const { conversation } = await api.get(`/api/conversations/${id}`);
      get().upsertConversation(conversation);
      if (get().activeId === id) get().markRead(id);
    },

    async loadThread(id) {
      const existing = get().threads[id];
      if (existing && existing.status !== 'error') return;
      set((s) => ({ threads: { ...s.threads, [id]: { messages: [], hasMore: false, status: 'loading' } } }));
      try {
        const d = await api.get(`/api/conversations/${id}/messages`);
        set((s) => {
          // Live messages may have arrived while loading; keep any not in the page.
          const live = s.threads[id]?.messages ?? [];
          let messages = d.messages.map(sent);
          for (const m of live) messages = mergeMessage(messages, m);
          return { threads: { ...s.threads, [id]: { messages, hasMore: d.hasMore, status: 'ready' } } };
        });
        if (get().activeId === id) get().markRead(id);
      } catch (err) {
        set((s) => ({
          threads: { ...s.threads, [id]: { messages: [], hasMore: false, status: 'error', error: err.message } },
        }));
      }
    },

    async loadOlder(id) {
      const t = get().threads[id];
      if (!t || t.status !== 'ready' || !t.hasMore || t.loadingOlder) return;
      const first = t.messages.find((m) => m.id);
      if (!first) return;
      set((s) => ({ threads: { ...s.threads, [id]: { ...s.threads[id], loadingOlder: true } } }));
      try {
        const d = await api.get(`/api/conversations/${id}/messages?before=${first.id}`);
        set((s) => {
          const cur = s.threads[id];
          return {
            threads: {
              ...s.threads,
              [id]: { ...cur, messages: [...d.messages.map(sent), ...cur.messages], hasMore: d.hasMore, loadingOlder: false },
            },
          };
        });
      } catch {
        set((s) => ({ threads: { ...s.threads, [id]: { ...s.threads[id], loadingOlder: false } } }));
      }
    },

    // ------------------------------------------------------------- sending

    _newMessage(conversationId, fields) {
      return {
        id: null,
        clientMsgId: crypto.randomUUID(),
        conversationId,
        senderId: me.id,
        type: 'text',
        body: null,
        mediaKey: null,
        createdAt: new Date().toISOString(),
        status: 'pending',
        ...fields,
      };
    },

    /** Optimistically show the message, then confirm it via the socket ack. */
    send(conversationId, body, replyTo) {
      get().stopTyping(conversationId);
      const msg = get()._newMessage(conversationId, { body, replyTo: replyTo ? quoteOf(replyTo) : null });
      get()._applyMessage(msg);
      get()._emitSend(msg);
    },

    /**
     * Send an image or document: show it at once, upload straight to storage in the
     * background (images are compressed first), then send the message.
     * kind: 'image' | 'document'; contentType is required for documents.
     */
    sendFile(conversationId, file, { kind, caption, contentType, replyTo }) {
      get().stopTyping(conversationId);
      const msg = get()._newMessage(conversationId, {
        replyTo: replyTo ? quoteOf(replyTo) : null,
        type: kind,
        body: caption || null,
        localUrl: kind === 'image' ? URL.createObjectURL(file) : undefined,
        mediaName: kind === 'document' ? file.name : null,
        mediaSize: file.size,
        progress: 0,
      });
      uploads.set(msg.clientMsgId, { file, contentType });
      get()._applyMessage(msg);
      get()._uploadAndSend(msg);
    },

    /** Share another user's contact card. */
    sendContact(conversationId, user, replyTo) {
      const msg = get()._newMessage(conversationId, {
        replyTo: replyTo ? quoteOf(replyTo) : null,
        type: 'contact',
        contact: { id: user.id, username: user.username, displayName: user.displayName },
      });
      get()._applyMessage(msg);
      get()._emitSend(msg);
    },

    async _uploadAndSend(msg) {
      try {
        let { mediaKey } = msg;
        if (!mediaKey) {
          const entry = uploads.get(msg.clientMsgId);
          if (!entry) throw new Error('File no longer available');
          if (msg.type === 'image') {
            entry.blob ??= await compressImage(entry.file);
            entry.contentType = entry.blob.type;
          } else {
            entry.blob = entry.file;
          }
          const { uploadUrl, key } = await api.post('/api/uploads', {
            conversationId: msg.conversationId,
            kind: msg.type,
            contentType: entry.contentType,
            size: entry.blob.size,
          });
          await uploadWithProgress(
            uploadUrl,
            entry.blob,
            (progress) => get()._applyMessage({ ...msg, progress }),
            entry.contentType,
          );
          mediaKey = key;
        }
        get()._emitSend({ ...msg, mediaKey, progress: 1 });
      } catch (err) {
        get()._applyMessage({ ...msg, status: 'failed', error: err.message });
      }
    },

    _emitSend(msg) {
      get()._applyMessage(msg);
      const payload = {
        conversationId: msg.conversationId,
        clientMsgId: msg.clientMsgId,
        type: msg.type,
        body: msg.body ?? '',
        ...(msg.mediaKey && { mediaKey: msg.mediaKey }),
        ...(msg.type === 'document' && { fileName: msg.mediaName }),
        ...(msg.type === 'contact' && { contactUserId: msg.contact?.id }),
        ...(msg.replyTo?.id && { replyToId: msg.replyTo.id }),
      };
      socket.timeout(SEND_TIMEOUT_MS).emit('send_message', payload, (err, res) => {
        if (!err && res?.ok) {
          uploads.delete(msg.clientMsgId);
          return get().receiveMessage(res.message);
        }
        get()._applyMessage({ ...msg, status: 'failed', error: err ? 'Not sent' : res?.error });
      });
    },

    /** (Re)send a pending or failed message; images re-upload only if needed. */
    _resend(msg) {
      const pending = { ...msg, status: 'pending', error: undefined };
      if ((pending.type === 'image' || pending.type === 'document') && !pending.mediaKey) {
        get()._uploadAndSend(pending);
      }
      else get()._emitSend(pending);
    },

    retry(conversationId, clientMsgId) {
      const msg = get().threads[conversationId]?.messages.find((m) => m.clientMsgId === clientMsgId);
      if (msg?.status === 'failed') get()._resend(msg);
    },

    // ------------------------------------------------------------- receiving

    /** A saved message from the server (send ack or `message:new`). */
    receiveMessage(message) {
      const msg = sent(message);
      const { conversations, activeId } = get();
      const conv = conversations[msg.conversationId];
      const alreadyKnown =
        conv?.lastMessage?.id === msg.id ||
        get().threads[msg.conversationId]?.messages.some((m) => m.id === msg.id);

      get()._applyMessage(msg);
      if (msg.senderId === me.id || alreadyKnown) {
        if (!conv) get().ensureConversation(msg.conversationId).catch(() => {});
        return;
      }

      // Their message arrived, so they've stopped typing.
      if (get().typing[msg.conversationId] === msg.senderId) clearTyping(msg.conversationId);

      if (!conv) {
        // First message of a chat this tab hasn't seen yet: fetch its summary (incl. unread count).
        socket?.emit('message:delivered', { conversationId: msg.conversationId, upTo: msg.id });
        get().ensureConversation(msg.conversationId).catch(() => {});
        return;
      }

      if (activeId === msg.conversationId && isVisible()) {
        get().markRead(msg.conversationId, msg.id, true);
      } else {
        socket?.emit('message:delivered', { conversationId: msg.conversationId, upTo: msg.id });
        patchConversation(msg.conversationId, (c) => ({ unreadCount: c.unreadCount + 1 }));
      }
    },

    /** Put a message into its thread (if loaded) and the sidebar preview. */
    _applyMessage(msg) {
      set((s) => {
        const next = {};
        const t = s.threads[msg.conversationId];
        if (t) next.threads = { ...s.threads, [msg.conversationId]: { ...t, messages: mergeMessage(t.messages, msg) } };

        const c = s.conversations[msg.conversationId];
        if (c) {
          const last = c.lastMessage;
          const isNewer = !last || last.clientMsgId === msg.clientMsgId || msg.createdAt >= last.createdAt;
          if (isNewer) {
            next.conversations = {
              ...s.conversations,
              [c.id]: { ...c, lastMessage: msg, lastMessageAt: msg.createdAt },
            };
          }
        }
        return next;
      });
    },

    /** Tell the server I've read up to the newest message; clears the badge. */
    markRead(id, upTo, force = false) {
      const c = get().conversations[id];
      if (!c || (!c.unreadCount && !force) || !isVisible()) return;
      const target = upTo ?? c.lastMessage?.id ?? lastServerMessage(get().threads[id]?.messages ?? [])?.id;
      if (!target) return;
      patchConversation(id, () => ({ unreadCount: 0 }));
      socket?.emit('conversation:read', { conversationId: id, upTo: target });
    },

    /** Another tab of mine read this chat. */
    onReadElsewhere({ conversationId }) {
      patchConversation(conversationId, () => ({ unreadCount: 0 }));
    },

    // ------------------------------------------------------------- receipts, presence, typing

    /** The other person received / read up to a point: updates ticks on my messages. */
    onReceipt({ conversationId, lastDeliveredAt, lastReadAt }) {
      patchConversation(conversationId, () => ({ receipts: { lastDeliveredAt, lastReadAt } }));
    },

    onPresence({ userId, online, lastSeenAt }) {
      set((s) => {
        let changed = false;
        const conversations = { ...s.conversations };
        for (const c of Object.values(conversations)) {
          if (c.otherUser?.id === userId) {
            conversations[c.id] = {
              ...c,
              otherUser: { ...c.otherUser, online, lastSeenAt: lastSeenAt ?? c.otherUser.lastSeenAt },
            };
            changed = true;
          }
        }
        return changed ? { conversations } : {};
      });
      if (!online) {
        for (const [convId, typer] of Object.entries(get().typing)) if (typer === userId) clearTyping(convId);
      }
    },

    onTyping({ conversationId, userId, typing }) {
      if (!typing) return clearTyping(conversationId);
      clearTimeout(typingExpiry.get(conversationId));
      typingExpiry.set(conversationId, setTimeout(() => clearTyping(conversationId), TYPING_EXPIRE_MS));
      set((s) => ({ typing: { ...s.typing, [conversationId]: userId } }));
    },

    /** Call on every keystroke in the composer. */
    userTyping(conversationId) {
      if (myTyping.conversationId && myTyping.conversationId !== conversationId) {
        get().stopTyping(myTyping.conversationId);
      }
      const now = Date.now();
      if (myTyping.conversationId !== conversationId || now - myTyping.lastStart > TYPING_RESEND_MS) {
        socket?.emit('typing:start', { conversationId });
        myTyping.lastStart = now;
      }
      myTyping.conversationId = conversationId;
      clearTimeout(myTyping.stopTimer);
      myTyping.stopTimer = setTimeout(() => get().stopTyping(conversationId), TYPING_IDLE_MS);
    },

    stopTyping(conversationId) {
      if (myTyping.conversationId !== conversationId) return;
      clearTimeout(myTyping.stopTimer);
      Object.assign(myTyping, { conversationId: null, lastStart: 0, stopTimer: null });
      socket?.emit('typing:stop', { conversationId });
    },

    // ------------------------------------------------------------- delete / forward

    /** scope: 'me' | 'everyone'. Resolves, or throws with the server's reason. */
    async deleteMessage(conversationId, messageId, scope) {
      const res = await socket.timeout(SEND_TIMEOUT_MS).emitWithAck('message:delete', { messageId, scope });
      if (!res?.ok) throw new Error(res?.error ?? 'Could not delete the message');
      if (scope === 'everyone') get().onDeleted({ conversationId, messageId });
      else get().onHidden({ conversationId, messageId });
    },

    /** Forward to up to 5 chats. The copies arrive through message:new like any message. */
    async forwardMessage(messageId, conversationIds) {
      const targets = conversationIds.map((conversationId) => ({ conversationId, clientMsgId: crypto.randomUUID() }));
      const res = await socket.timeout(SEND_TIMEOUT_MS).emitWithAck('message:forward', { messageId, targets });
      if (!res?.ok) throw new Error(res?.error ?? 'Could not forward the message');
      res.messages.forEach((m) => get().receiveMessage(m));
      return res.messages;
    },

    /** Someone deleted a message for everyone. */
    onDeleted({ conversationId, messageId }) {
      set((s) => {
        const next = {};
        const t = s.threads[conversationId];
        if (t) {
          const messages = t.messages.map((m) => {
            if (m.id === messageId) return tombstone(m);
            if (m.replyTo?.id === messageId) return { ...m, replyTo: { ...m.replyTo, deleted: true, body: null, mediaName: null, mediaKey: null, contactName: null } };
            return m;
          });
          next.threads = { ...s.threads, [conversationId]: { ...t, messages } };
        }
        const c = s.conversations[conversationId];
        if (c?.lastMessage?.id === messageId) {
          next.conversations = { ...s.conversations, [conversationId]: { ...c, lastMessage: tombstone(c.lastMessage) } };
        }
        return next;
      });
    },

    /** I deleted a message for myself (here or in another tab). */
    onHidden({ conversationId, messageId }) {
      set((s) => {
        const t = s.threads[conversationId];
        if (!t) return {};
        return { threads: { ...s.threads, [conversationId]: { ...t, messages: t.messages.filter((m) => m.id !== messageId) } } };
      });
      // The chat list preview / unread count may have changed: take the server's view.
      if (get().conversations[conversationId]?.lastMessage?.id === messageId) {
        api
          .get(`/api/conversations/${conversationId}`)
          .then(({ conversation }) => get().upsertConversation(conversation))
          .catch(() => {});
      }
    },

    // ------------------------------------------------------------- reconnect

    /** After a reconnect: refresh the list, fetch missed messages, resend unsent ones. */
    async resync() {
      await get().loadConversations().catch(() => {});
      for (const [id, t] of Object.entries(get().threads)) {
        if (t?.status !== 'ready') continue;
        const unsent = t.messages.filter((m) => m.status !== 'sent');
        const last = lastServerMessage(t.messages);
        try {
          const d = await api.get(`/api/conversations/${id}/messages${last ? `?after=${last.id}` : ''}`);
          if (d.hasMore) {
            // Missed a lot: reload the latest page instead of stitching.
            set((s) => ({ threads: { ...s.threads, [id]: undefined } }));
            await get().loadThread(id);
          } else {
            d.messages.forEach((m) => get()._applyMessage(sent(m)));
          }
        } catch {
          /* next reconnect will try again */
        }
        // Resend anything that never got confirmed (server dedupes by clientMsgId).
        unsent.forEach((m) => get()._resend(m));
      }
      const active = get().activeId;
      if (active) get().markRead(active);
    },
  };
});
