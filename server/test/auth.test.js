import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, resetDb, client, pool } from './helpers.js';

let srv;
before(async () => {
  srv = await startServer();
});
after(async () => {
  await srv.close();
  await pool.end();
});
beforeEach(resetDb);

test('register sets an httpOnly cookie and /me returns the user', async () => {
  const c = client(srv.url);
  const res = await c.register('Alice', { phone: '+250780000001' });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.username, 'alice', 'username is lowercased');
  assert.equal(res.body.user.phone, '+250780000001');
  assert.equal(res.body.user.password_hash, undefined);
  assert.match(res.headers.get('set-cookie'), /HttpOnly/i);

  const me = await c.req('GET', '/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, res.body.user.id);
});

test('duplicate username is rejected case-insensitively', async () => {
  await client(srv.url).register('bob');
  const res = await client(srv.url).register('BOB');
  assert.equal(res.status, 409);
  assert.match(res.body.error, /username/i);
});

test('duplicate phone is rejected', async () => {
  await client(srv.url).register('bob', { phone: '+250780000002' });
  const res = await client(srv.url).register('bob2', { phone: '+250780000002' });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /phone/i);
});

test('register validates input', async () => {
  const c = client(srv.url);
  const cases = [
    { username: 'a b', displayName: 'x', password: 'password123' },
    { username: 'ab', displayName: 'x', password: 'password123' },
    { username: 'valid', displayName: 'x', password: 'short' },
    { username: 'valid', displayName: '', password: 'password123' },
    { username: 'valid', displayName: 'x', password: 'password123', phone: '0780000000' },
  ];
  for (const body of cases) {
    const res = await c.req('POST', '/api/auth/register', body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok(res.body.error);
  }
});

test('login works, and wrong password / unknown user give the same 401', async () => {
  await client(srv.url).register('carol');

  const ok = await client(srv.url).login('Carol');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.username, 'carol');

  const wrong = await client(srv.url).login('carol', 'wrongpassword');
  const unknown = await client(srv.url).login('nobody', 'wrongpassword');
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.body.error, unknown.body.error);
});

test('logout clears the cookie', async () => {
  const c = client(srv.url);
  await c.register('dave');
  assert.ok(c.cookie);
  const res = await c.req('POST', '/api/auth/logout');
  assert.equal(res.status, 204);
  assert.equal(c.cookie, '');
  assert.equal((await c.req('GET', '/api/auth/me')).status, 401);
});

test('protected routes reject missing or forged tokens', async () => {
  const anon = client(srv.url);
  assert.equal((await anon.req('GET', '/api/auth/me')).status, 401);
  assert.equal((await anon.req('GET', '/api/users?search=al')).status, 401);
  assert.equal((await anon.req('POST', '/api/conversations', { userId: crypto.randomUUID() })).status, 401);

  const forged = await fetch(`${srv.url}/api/auth/me`, {
    headers: { cookie: 'token=eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.' },
  });
  assert.equal(forged.status, 401);
});

test('auth routes send rate-limit headers', async () => {
  const res = await client(srv.url).login('nobody', 'x');
  assert.ok(res.headers.get('ratelimit-policy') || res.headers.get('ratelimit'));
});
