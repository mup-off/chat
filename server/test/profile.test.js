import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, resetDb, client, pool, connectSocket, collect, sleep } from './helpers.js';
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
    const { body } = await c.register(name, { phone: `+25078800000${Object.keys(p).length}` });
    p[name] = { c, user: body.user };
  }
  const { body } = await p.alice.c.req('POST', '/api/conversations', { userId: p.bob.user.id });
  return { ...p, convId: body.conversation.id };
}

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 9, 9, 9]);

async function uploadAvatar(person, { bytes = PNG, contentType = 'image/png', putType = contentType } = {}) {
  const res = await person.c.req('POST', '/api/me/avatar-upload', { contentType, size: bytes.length });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const put = await fetch(res.body.uploadUrl, { method: 'PUT', headers: { 'Content-Type': putType }, body: bytes });
  assert.equal(put.status, 200);
  return res.body.key;
}

test('profile: name and about update; settings are private; contacts are notified live', async () => {
  const { alice, bob, carol, convId } = await setup();
  const bobSocket = await connectSocket(srv.url, bob.c.cookie);
  const carolSocket = await connectSocket(srv.url, carol.c.cookie);
  sockets.push(bobSocket, carolSocket);
  const bobSees = collect(bobSocket, 'user:updated');
  const carolSees = collect(carolSocket, 'user:updated');

  const res = await alice.c.req('PATCH', '/api/me', { displayName: '  Alice W.  ', about: 'Busy, text me' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.user.displayName, 'Alice W.');
  assert.equal(res.body.user.about, 'Busy, text me');
  assert.deepEqual(res.body.user.settings, { theme: 'system', wallpaper: 'default' });

  await sleep(100);
  assert.equal(bobSees.length, 1, 'contacts get the update');
  assert.equal(bobSees[0].user.displayName, 'Alice W.');
  assert.equal(bobSees[0].user.phone, undefined, 'never leaks phone');
  assert.equal(bobSees[0].user.settings, undefined, 'never leaks settings');
  assert.equal(carolSees.length, 0, 'non-contacts get nothing');

  // Chat list and search show the new details to others.
  const conv = (await bob.c.req('GET', `/api/conversations/${convId}`)).body.conversation;
  assert.equal(conv.otherUser.displayName, 'Alice W.');
  assert.equal(conv.otherUser.about, 'Busy, text me');
  const found = (await carol.c.req('GET', '/api/users?search=alice')).body.users[0];
  assert.equal(found.about, 'Busy, text me');
  assert.equal(found.settings, undefined);

  // Clearing "about".
  assert.equal((await alice.c.req('PATCH', '/api/me', { about: '' })).body.user.about, null);
});

test('settings: theme and wallpaper persist and are validated', async () => {
  const { alice } = await setup();
  const res = await alice.c.req('PATCH', '/api/me', { theme: 'dark', wallpaper: 'mint' });
  assert.equal(res.status, 200);
  assert.deepEqual((await alice.c.req('GET', '/api/auth/me')).body.user.settings, { theme: 'dark', wallpaper: 'mint' });

  for (const body of [
    { theme: 'purple' },
    { wallpaper: 'https://evil.example/x.png' },
    { displayName: '' },
    { about: 'x'.repeat(141) },
    { username: 'hacker' }, // not editable here
    { phone: '+250780000999' },
    {},
  ]) {
    assert.equal((await alice.c.req('PATCH', '/api/me', body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await client(srv.url).req('PATCH', '/api/me', { theme: 'dark' })).status, 401);
});

test('avatar: upload, set, serve, replace (old file deleted), remove', async () => {
  const { alice, bob, convId } = await setup();

  const key1 = await uploadAvatar(alice);
  assert.match(key1, new RegExp(`^avatars/${alice.user.id}/[0-9a-f-]{36}\\.png$`));
  const set1 = await alice.c.req('PATCH', '/api/me', { avatarKey: key1 });
  assert.equal(set1.status, 200, JSON.stringify(set1.body));
  const url1 = set1.body.user.avatarUrl;
  assert.equal(url1, `/api/${key1}`);

  // Any signed-in user can load it; anonymous users can't.
  const r = await fetch(srv.url + url1, { headers: { cookie: bob.c.cookie }, redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.deepEqual(new Uint8Array(await (await fetch(r.headers.get('location'))).arrayBuffer()), PNG);
  assert.equal((await fetch(srv.url + url1, { redirect: 'manual' })).status, 401);

  // Bob's chat list shows Alice's photo.
  const conv = (await bob.c.req('GET', `/api/conversations/${convId}`)).body.conversation;
  assert.equal(conv.otherUser.avatarUrl, url1);

  // Replace: the old file is deleted and no longer served.
  const key2 = await uploadAvatar(alice);
  await alice.c.req('PATCH', '/api/me', { avatarKey: key2 });
  assert.equal(await headObject(key1), null);
  assert.equal((await fetch(srv.url + url1, { headers: { cookie: bob.c.cookie }, redirect: 'manual' })).status, 404);

  // Remove.
  const removed = await alice.c.req('PATCH', '/api/me', { avatarKey: null });
  assert.equal(removed.body.user.avatarUrl, null);
  assert.equal(await headObject(key2), null);
});

test('avatar: only your own real image uploads can be set', async () => {
  const { alice, bob } = await setup();

  for (const [contentType, size] of [['image/gif', 10], ['image/svg+xml', 10], ['text/html', 10], ['image/png', 3 * 1024 * 1024]]) {
    const res = await alice.c.req('POST', '/api/me/avatar-upload', { contentType, size });
    assert.equal(res.status, 400, `${contentType} ${size}`);
  }

  // Bob's upload can't become Alice's photo.
  const bobsKey = await uploadAvatar(bob);
  assert.equal((await alice.c.req('PATCH', '/api/me', { avatarKey: bobsKey })).status, 400);
  // Never-uploaded key.
  const ghost = `avatars/${alice.user.id}/${crypto.randomUUID()}.png`;
  assert.equal((await alice.c.req('PATCH', '/api/me', { avatarKey: ghost })).status, 400);
  // Uploaded as HTML despite asking for PNG.
  const sneaky = await uploadAvatar(alice, { bytes: new TextEncoder().encode('<script>1</script>'), putType: 'text/html' });
  assert.equal((await alice.c.req('PATCH', '/api/me', { avatarKey: sneaky })).status, 400);
  // Message attachments can't be used as avatars.
  assert.equal((await alice.c.req('PATCH', '/api/me', { avatarKey: `conv/${crypto.randomUUID()}/${crypto.randomUUID()}.png` })).status, 400);
});

test('password: change requires the current password; new one works for login', async () => {
  const { alice } = await setup();
  const wrong = await alice.c.req('POST', '/api/auth/password', { currentPassword: 'nope', newPassword: 'new-password-1' });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error, 'Current password is incorrect');
  const short = await alice.c.req('POST', '/api/auth/password', { currentPassword: 'password123', newPassword: 'short' });
  assert.equal(short.status, 400);
  const same = await alice.c.req('POST', '/api/auth/password', { currentPassword: 'password123', newPassword: 'password123' });
  assert.equal(same.status, 400);

  const ok = await alice.c.req('POST', '/api/auth/password', { currentPassword: 'password123', newPassword: 'new-password-1' });
  assert.equal(ok.status, 204);
  assert.equal((await client(srv.url).login('alice', 'password123')).status, 401);
  assert.equal((await client(srv.url).login('alice', 'new-password-1')).status, 200);
  assert.equal((await client(srv.url).req('POST', '/api/auth/password', { currentPassword: 'x', newPassword: 'yyyyyyyy' })).status, 401);
});
