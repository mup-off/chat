import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, resetDb, client, pool, connectSocket, emitAck, collect, sleep } from './helpers.js';
import { ensureBucket, headObject } from '../src/storage.js';

let srv;
const sockets = [];
before(async () => {
  srv = await startServer();
  await ensureBucket();
});
after(async () => {
  await srv.close();
  await pool.end();
});
beforeEach(async () => {
  sockets.splice(0).forEach((s) => s.close());
  await resetDb();
});

async function setup() {
  const p = {};
  for (const name of ['alice', 'bob', 'carol']) {
    const c = client(srv.url);
    const { body } = await c.register(name);
    p[name] = { c, user: body.user };
    p[name].socket = await connectSocket(srv.url, c.cookie);
    sockets.push(p[name].socket);
  }
  const ab = (await p.alice.c.req('POST', '/api/conversations', { userId: p.bob.user.id })).body.conversation.id;
  const ac = (await p.alice.c.req('POST', '/api/conversations', { userId: p.carol.user.id })).body.conversation.id;
  return { ...p, ab, ac };
}

const send = async (socket, conversationId, extra) => {
  const ack = await emitAck(socket, 'send_message', { conversationId, clientMsgId: crypto.randomUUID(), ...extra });
  assert.equal(ack.ok, true, ack.error);
  return ack.message;
};
const history = async (person, convId) =>
  (await person.c.req('GET', `/api/conversations/${convId}/messages`)).body.messages;

// ---------------------------------------------------------------- reply

test('reply: quotes the original; only within the same chat; quote updates if original is deleted', async () => {
  const { alice, bob, ab, ac } = await setup();
  const original = await send(alice.socket, ab, { body: 'Lunch at 1?' });
  const reply = await send(bob.socket, ab, { body: 'Yes!', replyToId: original.id });

  assert.deepEqual(reply.replyTo, {
    id: original.id, senderId: alice.user.id, type: 'text', deleted: false,
    body: 'Lunch at 1?', mediaName: null, mediaKey: null, contactName: null,
  });
  assert.equal((await history(alice, ab))[1].replyTo.body, 'Lunch at 1?');

  // Can't reply to a message from another chat, or a non-existent one.
  const other = await send(alice.socket, ac, { body: 'secret' });
  for (const replyToId of [other.id, crypto.randomUUID()]) {
    const ack = await emitAck(bob.socket, 'send_message', { conversationId: ab, clientMsgId: crypto.randomUUID(), body: 'x', replyToId });
    assert.equal(ack.ok, false);
  }

  // Original deleted for everyone: the quote shows as deleted, with no content leaked.
  await emitAck(alice.socket, 'message:delete', { messageId: original.id, scope: 'everyone' });
  const quote = (await history(bob, ab))[1].replyTo;
  assert.equal(quote.deleted, true);
  assert.equal(quote.body, null);

  // And you can't reply to a deleted message.
  const late = await emitAck(bob.socket, 'send_message', { conversationId: ab, clientMsgId: crypto.randomUUID(), body: 'x', replyToId: original.id });
  assert.equal(late.ok, false);
});

// ---------------------------------------------------------------- delete for everyone

test('delete for everyone: sender only, leaves a tombstone, notifies both sides, removes the file', async () => {
  const { alice, bob, carol, ab } = await setup();
  const bobEvents = collect(bob.socket, 'message:deleted');
  const msg = await send(alice.socket, ab, { body: 'oops, wrong chat' });

  // Bob can't delete Alice's message for everyone; Carol can't touch it at all.
  const notMine = await emitAck(bob.socket, 'message:delete', { messageId: msg.id, scope: 'everyone' });
  assert.deepEqual(notMine, { ok: false, error: 'You can only delete your own messages for everyone' });
  const outsider = await emitAck(carol.socket, 'message:delete', { messageId: msg.id, scope: 'me' });
  assert.equal(outsider.ok, false);

  const ack = await emitAck(alice.socket, 'message:delete', { messageId: msg.id, scope: 'everyone' });
  assert.equal(ack.ok, true, ack.error);
  assert.equal(ack.message.deleted, true);
  assert.equal(ack.message.body, null);
  await sleep(100);
  assert.deepEqual(bobEvents, [{ conversationId: ab, messageId: msg.id }]);

  const [seen] = await history(bob, ab);
  assert.equal(seen.deleted, true);
  assert.equal(seen.body, null);
  const { rows } = await pool.query('SELECT body FROM messages WHERE id = $1', [msg.id]);
  assert.equal(rows[0].body, null, 'content is really gone from the database');

  const list = (await bob.c.req('GET', '/api/conversations')).body.conversations;
  assert.equal(list[0].lastMessage.deleted, true);
  assert.equal(list[0].unreadCount, 0, 'deleted messages are not counted as unread');

  // Files are deleted from storage too.
  const up = await alice.c.req('POST', '/api/uploads', { conversationId: ab, kind: 'document', contentType: 'text/plain', size: 5 });
  await fetch(up.body.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'hello' });
  const doc = await send(alice.socket, ab, { type: 'document', mediaKey: up.body.key, fileName: 'a.txt' });
  assert.ok(await headObject(up.body.key));
  await emitAck(alice.socket, 'message:delete', { messageId: doc.id, scope: 'everyone' });
  assert.equal(await headObject(up.body.key), null);
  const media = await fetch(`${srv.url}/api/media/${up.body.key}`, { headers: { cookie: bob.c.cookie }, redirect: 'manual' });
  assert.equal(media.status, 404);
});

test('delete for everyone: refused after 48 hours', async () => {
  const { alice, ab } = await setup();
  const msg = await send(alice.socket, ab, { body: 'old news' });
  await pool.query("UPDATE messages SET created_at = now() - interval '49 hours' WHERE id = $1", [msg.id]);
  const ack = await emitAck(alice.socket, 'message:delete', { messageId: msg.id, scope: 'everyone' });
  assert.deepEqual(ack, { ok: false, error: 'This message is too old to delete for everyone' });
  // Deleting for yourself still works.
  assert.equal((await emitAck(alice.socket, 'message:delete', { messageId: msg.id, scope: 'me' })).ok, true);
});

// ---------------------------------------------------------------- delete for me

test('delete for me: hidden only for me (all my tabs), still visible to the other person', async () => {
  const { alice, bob, ab } = await setup();
  const aliceTab2 = await connectSocket(srv.url, alice.c.cookie);
  sockets.push(aliceTab2);
  const tab2Events = collect(aliceTab2, 'message:hidden');
  const bobHidden = collect(bob.socket, 'message:hidden');

  const first = await send(bob.socket, ab, { body: 'keep me' });
  const second = await send(bob.socket, ab, { body: 'hide me' });

  const ack = await emitAck(alice.socket, 'message:delete', { messageId: second.id, scope: 'me' });
  assert.equal(ack.ok, true, ack.error);
  await sleep(100);
  assert.deepEqual(tab2Events, [{ conversationId: ab, messageId: second.id }]);
  assert.equal(bobHidden.length, 0);

  assert.deepEqual((await history(alice, ab)).map((m) => m.body), ['keep me']);
  assert.deepEqual((await history(bob, ab)).map((m) => m.body), ['keep me', 'hide me']);

  // Alice's chat list now previews the last message she can still see, and doesn't count the hidden one.
  const list = (await alice.c.req('GET', '/api/conversations')).body.conversations;
  assert.equal(list[0].lastMessage.id, first.id);
  assert.equal(list[0].unreadCount, 1);
});

// ---------------------------------------------------------------- forward

test('forward: copies text and files into other chats, marked as forwarded', async () => {
  const { alice, bob, carol, ab, ac } = await setup();
  const carolGot = collect(carol.socket, 'message:new');
  const bc = (await bob.c.req('POST', '/api/conversations', { userId: carol.user.id })).body.conversation.id;

  const text = await send(bob.socket, ab, { body: 'Meeting moved to 3pm' });
  const ack = await emitAck(alice.socket, 'message:forward', {
    messageId: text.id,
    targets: [{ conversationId: ac, clientMsgId: crypto.randomUUID() }],
  });
  assert.equal(ack.ok, true, ack.error);
  const fwd = ack.messages[0];
  assert.equal(fwd.body, 'Meeting moved to 3pm');
  assert.equal(fwd.forwarded, true);
  assert.equal(fwd.senderId, alice.user.id, 'the forwarder is the sender');
  assert.equal(fwd.conversationId, ac);
  await sleep(100);
  assert.equal(carolGot.at(-1)?.id, fwd.id);

  // A document gets its own copy in the target chat; Carol can download it, and
  // deleting the original for everyone doesn't affect the forwarded copy.
  const up = await bob.c.req('POST', '/api/uploads', { conversationId: ab, kind: 'document', contentType: 'text/plain', size: 5 });
  await fetch(up.body.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: 'notes' });
  const doc = await send(bob.socket, ab, { type: 'document', mediaKey: up.body.key, fileName: 'notes.txt' });
  const docFwd = (await emitAck(alice.socket, 'message:forward', {
    messageId: doc.id, targets: [{ conversationId: ac, clientMsgId: crypto.randomUUID() }],
  })).messages[0];
  assert.notEqual(docFwd.mediaKey, doc.mediaKey);
  assert.match(docFwd.mediaKey, new RegExp(`^conv/${ac}/`));
  assert.equal(docFwd.mediaName, 'notes.txt');

  await emitAck(bob.socket, 'message:delete', { messageId: doc.id, scope: 'everyone' });
  const res = await fetch(`${srv.url}/api/media/${docFwd.mediaKey}`, { headers: { cookie: carol.c.cookie }, redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(await (await fetch(res.headers.get('location'))).text(), 'notes');

  // Several chats at once.
  const multi = await emitAck(bob.socket, 'message:forward', {
    messageId: text.id,
    targets: [
      { conversationId: ab, clientMsgId: crypto.randomUUID() },
      { conversationId: bc, clientMsgId: crypto.randomUUID() },
    ],
  });
  assert.deepEqual(multi.messages.map((m) => m.conversationId), [ab, bc]);
});

test('forward: refused into chats you are not in, for deleted messages, over 5 targets; retries are idempotent', async () => {
  const { alice, bob, carol, ab, ac } = await setup();
  const msg = await send(alice.socket, ab, { body: 'hi' });

  // Bob is not in alice–carol.
  const intruder = await emitAck(bob.socket, 'message:forward', {
    messageId: msg.id, targets: [{ conversationId: ac, clientMsgId: crypto.randomUUID() }],
  });
  assert.equal(intruder.ok, false);
  // Carol can't forward a message from a chat she isn't in.
  const outsider = await emitAck(carol.socket, 'message:forward', {
    messageId: msg.id, targets: [{ conversationId: ac, clientMsgId: crypto.randomUUID() }],
  });
  assert.equal(outsider.ok, false);

  const tooMany = await emitAck(alice.socket, 'message:forward', {
    messageId: msg.id,
    targets: Array.from({ length: 6 }, () => ({ conversationId: ac, clientMsgId: crypto.randomUUID() })),
  });
  assert.equal(tooMany.ok, false);

  // Same clientMsgId twice -> one message.
  const target = { conversationId: ac, clientMsgId: crypto.randomUUID() };
  const a = await emitAck(alice.socket, 'message:forward', { messageId: msg.id, targets: [target] });
  const b = await emitAck(alice.socket, 'message:forward', { messageId: msg.id, targets: [target] });
  assert.equal(a.messages[0].id, b.messages[0].id);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM messages WHERE conversation_id = $1', [ac]);
  assert.equal(rows[0].n, 1);

  await emitAck(alice.socket, 'message:delete', { messageId: msg.id, scope: 'everyone' });
  const deleted = await emitAck(alice.socket, 'message:forward', {
    messageId: msg.id, targets: [{ conversationId: ac, clientMsgId: crypto.randomUUID() }],
  });
  assert.deepEqual(deleted, { ok: false, error: 'This message was deleted' });
});
