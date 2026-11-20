import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, resetDb, client, pool, connectSocket } from './helpers.js';

let srv;
before(async () => {
  srv = await startServer();
});
after(async () => {
  await srv.close();
  await pool.end();
});
beforeEach(resetDb);

async function users(...names) {
  const out = {};
  for (const name of names) {
    const c = client(srv.url);
    const res = await c.register(name, { phone: `+2507800000${names.indexOf(name)}0` });
    out[name] = { c, user: res.body.user };
  }
  return out;
}

test('user search: as-you-type by name or number, excludes self, never exposes phones', async () => {
  // phones: alice +250780000000, alicia +250780000010, bob +250780000020
  const { alice } = await users('alice', 'alicia', 'bob');
  const search = async (q) => {
    const res = await alice.c.req('GET', `/api/users?search=${encodeURIComponent(q)}`);
    assert.equal(res.status, 200, q);
    return res.body.users.map((u) => u.username);
  };

  assert.deepEqual(await search('ALI'), ['alicia'], 'case-insensitive, excludes self');
  assert.deepEqual(await search('ob'), ['bob'], 'matches anywhere in the name');

  // Number search as you type: partial, international and local formats.
  assert.deepEqual(await search('+250780000020'), ['bob']);
  assert.deepEqual(await search('00002'), ['bob'], 'partial number');
  assert.deepEqual(await search('0780000020'), ['bob'], 'local format with leading 0');
  assert.deepEqual(await search('+250 780 000 020'), ['bob'], 'spaces ignored');
  assert.deepEqual(await search('25078'), ['alicia', 'bob'], 'short prefix matches several');

  const res = await alice.c.req('GET', '/api/users?search=bob');
  assert.equal(res.body.users[0].phone, undefined, 'phone never returned');

  assert.deepEqual(await search('%%'), [], 'LIKE wildcards are matched literally');
  assert.equal((await alice.c.req('GET', '/api/users?search=a')).status, 400);
});

test('find-or-create: concurrent calls from both sides return one conversation', async () => {
  const { alice, bob } = await users('alice', 'bob');

  const results = await Promise.all([
    alice.c.req('POST', '/api/conversations', { userId: bob.user.id }),
    bob.c.req('POST', '/api/conversations', { userId: alice.user.id }),
    alice.c.req('POST', '/api/conversations', { userId: bob.user.id }),
    bob.c.req('POST', '/api/conversations', { userId: alice.user.id }),
  ]);

  for (const r of results) assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
  const ids = new Set(results.map((r) => r.body.conversation.id));
  assert.equal(ids.size, 1);
  assert.equal(results.filter((r) => r.status === 201).length, 1, 'exactly one creation');

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM conversations');
  assert.equal(rows[0].n, 1);
  const { rows: parts } = await pool.query('SELECT count(*)::int AS n FROM participants');
  assert.equal(parts[0].n, 2);

  assert.equal(results[0].body.conversation.otherUser.username, 'bob');
  assert.equal(results[1].body.conversation.otherUser.username, 'alice');
});

test('find-or-create rejects self, unknown users and bad ids', async () => {
  const { alice } = await users('alice');
  const self = await alice.c.req('POST', '/api/conversations', { userId: alice.user.id });
  assert.equal(self.status, 400);
  const unknown = await alice.c.req('POST', '/api/conversations', { userId: crypto.randomUUID() });
  assert.equal(unknown.status, 404);
  const bad = await alice.c.req('POST', '/api/conversations', { userId: 'not-a-uuid' });
  assert.equal(bad.status, 400);
});

test('only participants can open a conversation', async () => {
  const { alice, bob, carol } = await users('alice', 'bob', 'carol');
  const { body } = await alice.c.req('POST', '/api/conversations', { userId: bob.user.id });
  const path = `/api/conversations/${body.conversation.id}`;

  assert.equal((await alice.c.req('GET', path)).status, 200);
  assert.equal((await bob.c.req('GET', path)).status, 200);
  assert.equal((await carol.c.req('GET', path)).status, 404);
});

const connect = (cookie) => connectSocket(srv.url, cookie);

test('socket handshake requires a valid auth cookie', async () => {
  await assert.rejects(connect(''), /unauthorized/);
  await assert.rejects(connect('token=garbage'), /unauthorized/);

  const { alice } = await users('alice');
  const socket = await connect(alice.c.cookie);
  assert.ok(socket.connected);
  socket.close();
});
