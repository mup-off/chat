import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, resetDb, client, pool, connectSocket, emitAck, collect, sleep,
} from './helpers.js';
import { ensureBucket } from '../src/storage.js';

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
  await sleep(120); // let presence grace timers from the previous test fire
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

const send = (socket, conversationId, body, extra = {}) =>
  emitAck(socket, 'send_message', { conversationId, clientMsgId: crypto.randomUUID(), body, ...extra });

// ---------------------------------------------------------------- presence

test('presence: contacts see online/offline; multiple tabs count as one; last seen is saved', async () => {
  const { alice, bob, carol } = await setup();
  const aliceTab = await socketFor(alice);
  const carolTab = await socketFor(carol);
  const aliceSees = collect(aliceTab, 'presence:update');
  const carolSees = collect(carolTab, 'presence:update');

  const bob1 = await socketFor(bob);
  await sleep(100);
  assert.deepEqual(aliceSees.map((p) => [p.userId, p.online]), [[bob.user.id, true]]);
  assert.equal(carolSees.length, 0, 'not a contact: no presence');

  // Chat summary reports bob online.
  const conv = (await alice.c.req('GET', '/api/conversations/' + (await alice.c.req('POST', '/api/conversations', { userId: bob.user.id })).body.conversation.id)).body.conversation;
  assert.equal(conv.otherUser.online, true);

  // Second tab: no new event. Closing one of two tabs: still online.
  const bob2 = await socketFor(bob);
  bob1.close();
  await sleep(150);
  assert.equal(aliceSees.length, 1);

  // Closing the last tab: offline after the grace period, with last seen.
  bob2.close();
  await sleep(200);
  assert.equal(aliceSees.length, 2);
  assert.equal(aliceSees[1].online, false);
  assert.ok(aliceSees[1].lastSeenAt);
  const { rows } = await pool.query('SELECT last_seen_at FROM users WHERE id = $1', [bob.user.id]);
  assert.ok(rows[0].last_seen_at);
});

test('presence: a quick reconnect (page reload) does not flash offline', async () => {
  const { alice, bob } = await setup();
  const aliceTab = await socketFor(alice);
  const aliceSees = collect(aliceTab, 'presence:update');
  const b1 = await socketFor(bob);
  await sleep(80);
  b1.close();
  await socketFor(bob); // reconnects within the 50 ms test grace period
  await sleep(150);
  assert.deepEqual(aliceSees.map((p) => p.online), [true]);
});

// ---------------------------------------------------------------- typing

test('typing: relayed to the other participant only', async () => {
  const { alice, bob, carol, convId } = await setup();
  const aliceTab = await socketFor(alice);
  const aliceTab2 = await socketFor(alice);
  const bobTab = await socketFor(bob);
  const carolTab = await socketFor(carol);
  const bobSees = collect(bobTab, 'typing');
  const aliceOwnTab = collect(aliceTab2, 'typing');
  const carolSees = collect(carolTab, 'typing');

  aliceTab.emit('typing:start', { conversationId: convId });
  aliceTab.emit('typing:stop', { conversationId: convId });
  carolTab.emit('typing:start', { conversationId: convId }); // not a member: ignored
  await sleep(150);

  assert.deepEqual(bobSees, [
    { conversationId: convId, userId: alice.user.id, typing: true },
    { conversationId: convId, userId: alice.user.id, typing: false },
  ]);
  assert.equal(aliceOwnTab.length, 0);
  assert.equal(carolSees.length, 0);
});

// ---------------------------------------------------------------- receipts

test('receipts: delivered then read are reported to the sender', async () => {
  const { alice, bob, convId } = await setup();
  const aliceTab = await socketFor(alice);
  const bobTab = await socketFor(bob);
  const receipts = collect(aliceTab, 'receipt:update');

  const { message } = await send(aliceTab, convId, 'hi');
  // Bob's client confirms delivery when message:new arrives.
  assert.equal((await emitAck(bobTab, 'message:delivered', { conversationId: convId, upTo: message.id })).ok, true);
  await sleep(100);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].userId, bob.user.id);
  assert.equal(new Date(receipts[0].lastDeliveredAt).getTime(), new Date(message.createdAt).getTime());
  assert.equal(receipts[0].lastReadAt, null);

  // Repeating the same delivery is a no-op (no extra event).
  await emitAck(bobTab, 'message:delivered', { conversationId: convId, upTo: message.id });
  await sleep(50);
  assert.equal(receipts.length, 1);

  await emitAck(bobTab, 'conversation:read', { conversationId: convId, upTo: message.id });
  await sleep(100);
  assert.equal(receipts.length, 2);
  assert.ok(receipts[1].lastReadAt);

  // The chat summary exposes the same watermarks for ticks after a refresh.
  const conv = (await alice.c.req('GET', `/api/conversations/${convId}`)).body.conversation;
  assert.ok(conv.receipts.lastReadAt);
  assert.ok(conv.receipts.lastDeliveredAt);
});

test('receipts: messages sent while offline are marked delivered when the recipient connects', async () => {
  const { alice, bob, convId } = await setup();
  const aliceTab = await socketFor(alice);
  const receipts = collect(aliceTab, 'receipt:update');
  await send(aliceTab, convId, 'one');
  const { message: last } = await send(aliceTab, convId, 'two');
  await sleep(50);
  assert.equal(receipts.length, 0, 'bob is offline: nothing delivered yet');

  await socketFor(bob);
  await sleep(150);
  assert.equal(receipts.length, 1);
  assert.equal(new Date(receipts[0].lastDeliveredAt).getTime(), new Date(last.createdAt).getTime());
});

// ---------------------------------------------------------------- images

async function uploadImage(person, convId, bytes, contentType = 'image/png', declaredType = contentType) {
  const res = await person.c.req('POST', '/api/uploads', { conversationId: convId, contentType: declaredType, size: bytes.length });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const put = await fetch(res.body.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: bytes });
  assert.equal(put.status, 200);
  return res.body.key;
}

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

test('images: upload, send with caption, and fetch through the access-checked media URL', async () => {
  const { alice, bob, carol, convId } = await setup();
  const aliceTab = await socketFor(alice);
  const bobTab = await socketFor(bob);
  const bobGot = collect(bobTab, 'message:new');

  const key = await uploadImage(alice, convId, PNG);
  assert.match(key, new RegExp(`^conv/${convId}/[0-9a-f-]{36}\\.png$`));

  const ack = await send(aliceTab, convId, '  look at this  ', { type: 'image', mediaKey: key });
  assert.equal(ack.ok, true, ack.error);
  assert.equal(ack.message.type, 'image');
  assert.equal(ack.message.mediaKey, key);
  assert.equal(ack.message.body, 'look at this');
  await sleep(100);
  assert.equal(bobGot[0]?.mediaKey, key);

  // No caption is fine too.
  const key2 = await uploadImage(alice, convId, PNG);
  const noCaption = await send(aliceTab, convId, '', { type: 'image', mediaKey: key2 });
  assert.equal(noCaption.ok, true, noCaption.error);
  assert.equal(noCaption.message.body, null);

  // Bob can load it (redirect to a signed URL); Carol and anonymous users can't.
  const mediaPath = `/api/media/${key}`;
  const bobRes = await fetch(srv.url + mediaPath, { headers: { cookie: bob.c.cookie }, redirect: 'manual' });
  assert.equal(bobRes.status, 302);
  const img = await fetch(bobRes.headers.get('location'));
  assert.equal(img.status, 200);
  assert.deepEqual(new Uint8Array(await img.arrayBuffer()), PNG);
  const carolRes = await fetch(srv.url + mediaPath, { headers: { cookie: carol.c.cookie }, redirect: 'manual' });
  assert.equal(carolRes.status, 404);
  const anon = await fetch(srv.url + mediaPath, { redirect: 'manual' });
  assert.equal(anon.status, 401);
});

test('images: upload requests and image messages are validated', async () => {
  const { alice, carol, convId } = await setup();
  const aliceTab = await socketFor(alice);
  const up = (body) => alice.c.req('POST', '/api/uploads', { conversationId: convId, ...body });

  assert.equal((await up({ contentType: 'text/html', size: 10 })).status, 400);
  assert.equal((await up({ contentType: 'image/svg+xml', size: 10 })).status, 400, 'SVG can carry scripts');
  assert.equal((await up({ contentType: 'image/png', size: 11 * 1024 * 1024 })).status, 400);
  const carolUp = await carol.c.req('POST', '/api/uploads', { conversationId: convId, contentType: 'image/png', size: 10 });
  assert.equal(carolUp.status, 404, 'non-participants cannot get upload URLs');

  // Sending a key that was never uploaded.
  const missing = `conv/${convId}/${crypto.randomUUID()}.png`;
  assert.equal((await send(aliceTab, convId, '', { type: 'image', mediaKey: missing })).ok, false);

  // A key from another conversation.
  const { body: other } = await alice.c.req('POST', '/api/conversations', { userId: carol.user.id });
  const otherKey = await uploadImage(alice, other.conversation.id, PNG);
  assert.equal((await send(aliceTab, convId, '', { type: 'image', mediaKey: otherKey })).ok, false);

  // Path tricks.
  assert.equal((await send(aliceTab, convId, '', { type: 'image', mediaKey: `conv/${convId}/../x.png` })).ok, false);

  // Uploaded with a non-image type despite asking for image/png.
  const sneaky = await uploadImage(alice, convId, new TextEncoder().encode('<script>x</script>'), 'text/html', 'image/png');
  assert.equal((await send(aliceTab, convId, '', { type: 'image', mediaKey: sneaky })).ok, false);

  const { rows } = await pool.query("SELECT count(*)::int AS n FROM messages WHERE type = 'image'");
  assert.equal(rows[0].n, 0);
});
