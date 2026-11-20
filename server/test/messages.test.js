import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, resetDb, client, pool, connectSocket, emitAck, collect, sleep,
} from './helpers.js';

let srv;
const sockets = [];
before(async () => {
  srv = await startServer();
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
  const people = {};
  for (const name of ['alice', 'bob', 'carol']) {
    const c = client(srv.url);
    const { body } = await c.register(name);
    people[name] = { c, user: body.user };
  }
  const { body } = await people.alice.c.req('POST', '/api/conversations', { userId: people.bob.user.id });
  return { ...people, convId: body.conversation.id };
}

async function socketFor(person) {
  const s = await connectSocket(srv.url, person.c.cookie);
  sockets.push(s);
  return s;
}

const send = (socket, conversationId, body, clientMsgId = crypto.randomUUID()) =>
  emitAck(socket, 'send_message', { conversationId, clientMsgId, body });

test('a message is saved and delivered live to both participants and all their tabs', async () => {
  const { alice, bob, carol, convId } = await setup();
  const aliceTab1 = await socketFor(alice);
  const aliceTab2 = await socketFor(alice);
  const bobTab = await socketFor(bob);
  const carolTab = await socketFor(carol);
  const got = {
    a1: collect(aliceTab1, 'message:new'),
    a2: collect(aliceTab2, 'message:new'),
    b: collect(bobTab, 'message:new'),
    c: collect(carolTab, 'message:new'),
  };

  const ack = await send(aliceTab1, convId, '  Hello Bob!  ');
  assert.equal(ack.ok, true, ack.error);
  assert.equal(ack.message.body, 'Hello Bob!', 'trimmed');
  assert.equal(ack.message.senderId, alice.user.id);

  await sleep(150);
  assert.equal(got.b.length, 1);
  assert.equal(got.b[0].id, ack.message.id);
  assert.equal(got.a2.length, 1, "sender's other tab gets it");
  assert.equal(got.a1.length, 1, 'sending tab gets it too (client dedupes by id)');
  assert.equal(got.c.length, 0, 'non-participants get nothing');

  const { rows } = await pool.query('SELECT body FROM messages');
  assert.deepEqual(rows.map((r) => r.body), ['Hello Bob!']);
});

test('non-participants cannot send, and invalid payloads are rejected without disconnecting', async () => {
  const { alice, carol, convId } = await setup();
  const carolTab = await socketFor(carol);
  const aliceTab = await socketFor(alice);

  const intruder = await send(carolTab, convId, 'let me in');
  assert.deepEqual(intruder, { ok: false, error: 'Conversation not found' });

  for (const payload of [
    { conversationId: convId, clientMsgId: crypto.randomUUID(), body: '   ' },
    { conversationId: convId, clientMsgId: crypto.randomUUID(), body: 'x'.repeat(4001) },
    { conversationId: convId, body: 'no client id' },
    { conversationId: 'nope', clientMsgId: crypto.randomUUID(), body: 'hi' },
    null,
  ]) {
    const ack = await emitAck(aliceTab, 'send_message', payload);
    assert.equal(ack.ok, false, JSON.stringify(payload));
  }
  assert.ok(aliceTab.connected);

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM messages');
  assert.equal(rows[0].n, 0);
});

test('retrying with the same clientMsgId stores and broadcasts the message once', async () => {
  const { alice, bob, convId } = await setup();
  const aliceTab = await socketFor(alice);
  const bobTab = await socketFor(bob);
  const bobGot = collect(bobTab, 'message:new');

  const clientMsgId = crypto.randomUUID();
  const [a, b] = await Promise.all([
    send(aliceTab, convId, 'once', clientMsgId),
    send(aliceTab, convId, 'once', clientMsgId),
  ]);
  const c = await send(aliceTab, convId, 'once', clientMsgId);

  assert.ok(a.ok && b.ok && c.ok);
  assert.equal(new Set([a.message.id, b.message.id, c.message.id]).size, 1);
  await sleep(150);
  assert.equal(bobGot.length, 1);
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM messages');
  assert.equal(rows[0].n, 1);
});

test('history pages 30 at a time with no gaps or duplicates, even with identical timestamps', async () => {
  const { alice, bob, carol, convId } = await setup();
  // 65 messages sharing one timestamp: ordering must fall back to id.
  await pool.query(
    `INSERT INTO messages (conversation_id, sender_id, client_msg_id, body, created_at)
     SELECT $1, $2, gen_random_uuid(), 'm' || g, '2026-01-01T00:00:00Z'
     FROM generate_series(1, 65) g`,
    [convId, alice.user.id],
  );
  const { rows: expected } = await pool.query(
    'SELECT id FROM messages ORDER BY created_at, id',
  );

  const pages = [];
  let path = `/api/conversations/${convId}/messages`;
  for (;;) {
    const res = await bob.c.req('GET', path);
    assert.equal(res.status, 200);
    pages.unshift(res.body.messages);
    if (!res.body.hasMore) break;
    path = `/api/conversations/${convId}/messages?before=${res.body.messages[0].id}`;
  }
  assert.deepEqual(pages.map((p) => p.length), [5, 30, 30]);
  assert.deepEqual(pages.flat().map((m) => m.id), expected.map((r) => r.id));

  // after= returns newer messages (used to catch up after reconnecting).
  const after = await bob.c.req(
    'GET',
    `/api/conversations/${convId}/messages?after=${expected[59].id}`,
  );
  assert.deepEqual(after.body.messages.map((m) => m.id), expected.slice(60).map((r) => r.id));
  assert.equal(after.body.hasMore, false);

  // Access control and cursor validation.
  assert.equal((await carol.c.req('GET', `/api/conversations/${convId}/messages`)).status, 404);
  const badCursor = await bob.c.req('GET', `/api/conversations/${convId}/messages?before=${crypto.randomUUID()}`);
  assert.equal(badCursor.status, 400);
});

test('chat list: newest first, last message preview, unread counts cleared by reading', async () => {
  const { alice, bob, carol, convId } = await setup();
  const { body: ac } = await alice.c.req('POST', '/api/conversations', { userId: carol.user.id });
  const aliceTab = await socketFor(alice);
  const bobTab = await socketFor(bob);
  const carolTab = await socketFor(carol);

  // Empty conversations are hidden from the list.
  assert.deepEqual((await alice.c.req('GET', '/api/conversations')).body.conversations, []);

  await send(bobTab, convId, 'hi alice');
  await send(bobTab, convId, 'you there?');
  await send(carolTab, ac.conversation.id, 'hey from carol');

  let list = (await alice.c.req('GET', '/api/conversations')).body.conversations;
  assert.deepEqual(list.map((c) => c.otherUser.username), ['carol', 'bob']);
  assert.equal(list[1].lastMessage.body, 'you there?');
  assert.deepEqual(list.map((c) => c.unreadCount), [1, 2]);

  // Alice replies to bob → bob's chat moves to the top; her own messages aren't unread.
  const reply = await send(aliceTab, convId, 'yes!');
  list = (await alice.c.req('GET', '/api/conversations')).body.conversations;
  assert.equal(list[0].otherUser.username, 'bob');
  assert.equal(list[0].unreadCount, 2);

  // Reading up to the latest message clears the count and syncs other tabs.
  const aliceTab2 = await socketFor(alice);
  const readEvents = collect(aliceTab2, 'conversation:read');
  const ack = await emitAck(aliceTab, 'conversation:read', { conversationId: convId, upTo: reply.message.id });
  assert.equal(ack.ok, true);
  list = (await alice.c.req('GET', '/api/conversations')).body.conversations;
  assert.equal(list[0].unreadCount, 0);
  assert.equal(list[1].unreadCount, 1, 'other chats unaffected');
  await sleep(150);
  assert.deepEqual(readEvents, [{ conversationId: convId, upTo: reply.message.id }]);

  // Bob still sees alice's message as unread on his side.
  const bobList = (await bob.c.req('GET', '/api/conversations')).body.conversations;
  assert.equal(bobList[0].unreadCount, 1);

  // Carol can't mark alice-bob as read.
  const intruder = await emitAck(carolTab, 'conversation:read', { conversationId: convId, upTo: reply.message.id });
  assert.equal(intruder.ok, false);
});
