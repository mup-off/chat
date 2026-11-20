import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, resetDb, client, pool, connectSocket, emitAck, collect, sleep } from './helpers.js';
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
  const socket = await connectSocket(srv.url, people.alice.c.cookie);
  sockets.push(socket);
  return { ...people, convId: body.conversation.id, socket };
}

const send = (socket, conversationId, extra) =>
  emitAck(socket, 'send_message', { conversationId, clientMsgId: crypto.randomUUID(), ...extra });

async function upload(person, convId, { kind, contentType, bytes, putType = contentType }) {
  const res = await person.c.req('POST', '/api/uploads', { conversationId: convId, kind, contentType, size: bytes.length });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const put = await fetch(res.body.uploadUrl, { method: 'PUT', headers: { 'Content-Type': putType }, body: bytes });
  assert.equal(put.status, 200);
  return res.body.key;
}

const PDF = new TextEncoder().encode('%PDF-1.4\n% test document\n%%EOF\n');

test('documents: upload, send with original name, download is forced as attachment', async () => {
  const { alice, bob, carol, convId, socket } = await setup();
  const bobTab = await connectSocket(srv.url, bob.c.cookie);
  sockets.push(bobTab);
  const bobGot = collect(bobTab, 'message:new');

  const key = await upload(alice, convId, { kind: 'document', contentType: 'application/pdf', bytes: PDF });
  assert.match(key, /\.pdf$/);

  const ack = await send(socket, convId, {
    type: 'document',
    mediaKey: key,
    fileName: 'C:\\Users\\alice\\Q3 Report – final "v2".pdf',
    body: 'Here is the report',
  });
  assert.equal(ack.ok, true, ack.error);
  const m = ack.message;
  assert.equal(m.type, 'document');
  assert.equal(m.mediaName, 'Q3 Report – final "v2".pdf', 'path stripped, name kept');
  assert.equal(m.mediaSize, PDF.length);
  assert.equal(m.mediaType, 'application/pdf');
  assert.equal(m.body, 'Here is the report');
  await sleep(100);
  assert.equal(bobGot[0]?.mediaName, m.mediaName);

  // Chat list preview carries the file name.
  const list = (await bob.c.req('GET', '/api/conversations')).body.conversations;
  assert.equal(list[0].lastMessage.mediaName, m.mediaName);

  // Download: redirect to a signed URL that forces "attachment" with the original name.
  const res = await fetch(`${srv.url}/api/media/${key}`, { headers: { cookie: bob.c.cookie }, redirect: 'manual' });
  assert.equal(res.status, 302);
  const file = await fetch(res.headers.get('location'));
  assert.equal(file.status, 200);
  const disposition = file.headers.get('content-disposition');
  assert.match(disposition, /^attachment;/);
  assert.match(disposition, /filename\*=UTF-8''Q3%20Report%20%E2%80%93%20final%20%22v2%22\.pdf/);
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), PDF);

  // Non-participants can't download.
  const carolRes = await fetch(`${srv.url}/api/media/${key}`, { headers: { cookie: carol.c.cookie }, redirect: 'manual' });
  assert.equal(carolRes.status, 404);
});

test('documents: only whitelisted types and sizes; uploads not attached to a message are not served', async () => {
  const { alice, convId, socket } = await setup();
  const up = (contentType, size = 100) =>
    alice.c.req('POST', '/api/uploads', { conversationId: convId, kind: 'document', contentType, size });

  for (const t of ['text/html', 'image/svg+xml', 'application/x-msdownload', 'application/javascript']) {
    assert.equal((await up(t)).status, 400, t);
  }
  assert.equal((await up('application/pdf', 26 * 1024 * 1024)).status, 400, 'over 25 MB');
  for (const t of ['application/pdf', 'text/csv', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip']) {
    assert.equal((await up(t)).status, 200, t);
  }

  // Uploaded as HTML despite asking for PDF: refused on send.
  const sneaky = await upload(alice, convId, {
    kind: 'document', contentType: 'application/pdf', bytes: new TextEncoder().encode('<script>x</script>'), putType: 'text/html',
  });
  assert.equal((await send(socket, convId, { type: 'document', mediaKey: sneaky, fileName: 'x.pdf' })).ok, false);

  // A document key can't be sent as an image, nor an image key as a document.
  const pdfKey = await upload(alice, convId, { kind: 'document', contentType: 'application/pdf', bytes: PDF });
  assert.equal((await send(socket, convId, { type: 'image', mediaKey: pdfKey })).ok, false);

  // Uploaded but never sent: not downloadable.
  const res = await fetch(`${srv.url}/api/media/${pdfKey}`, { headers: { cookie: alice.c.cookie }, redirect: 'manual' });
  assert.equal(res.status, 404);
});

test('contacts: share a user card; no phone number exposed; unknown users refused', async () => {
  const { bob, carol, convId, socket } = await setup();

  const ack = await send(socket, convId, { type: 'contact', contactUserId: carol.user.id });
  assert.equal(ack.ok, true, ack.error);
  assert.equal(ack.message.type, 'contact');
  assert.deepEqual(ack.message.contact, { id: carol.user.id, username: 'carol', displayName: 'carol' });

  const history = (await bob.c.req('GET', `/api/conversations/${convId}/messages`)).body.messages;
  assert.deepEqual(history[0].contact, ack.message.contact);
  assert.equal(JSON.stringify(history).includes('phone'), false);

  const list = (await bob.c.req('GET', '/api/conversations')).body.conversations;
  assert.equal(list[0].lastMessage.contact.username, 'carol');

  assert.equal((await send(socket, convId, { type: 'contact' })).ok, false);
  assert.equal((await send(socket, convId, { type: 'contact', contactUserId: crypto.randomUUID() })).ok, false);

  // If the shared user deletes their account, the message stays but the card is empty.
  await pool.query('DELETE FROM users WHERE id = $1', [carol.user.id]);
  const after = (await bob.c.req('GET', `/api/conversations/${convId}/messages`)).body.messages;
  assert.equal(after[0].type, 'contact');
  assert.equal(after[0].contact, null);
});
