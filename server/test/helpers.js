import { io as ioClient } from 'socket.io-client';
import { createServer } from '../src/app.js';

/** Connects a socket authenticated with the given cookie ("token=..."). */
export function connectSocket(url, cookie) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, {
      transports: ['websocket'],
      extraHeaders: cookie ? { cookie } : {},
      reconnection: false,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => {
      socket.close();
      reject(err);
    });
  });
}

/** Emits with an ack and resolves with the server's reply. */
export const emitAck = (socket, event, payload) => socket.timeout(5000).emitWithAck(event, payload);

/** Collects every payload of `event` on a socket. */
export function collect(socket, event) {
  const items = [];
  socket.on(event, (p) => items.push(p));
  return items;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls until check() is truthy (or fails after timeoutMs). Better than fixed sleeps on slow machines. */
export async function waitFor(check, timeoutMs = 3000) {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error('waitFor: condition not met in time');
    await sleep(20);
  }
}
import { pool } from '../src/db/pool.js';

export async function startServer() {
  const { server, io } = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    close: () => new Promise((resolve) => io.close(() => resolve())),
  };
}

export async function resetDb() {
  await pool.query('TRUNCATE messages, participants, conversations, users CASCADE');
}

export { pool };

/** Minimal HTTP client that keeps the auth cookie between requests, like a browser. */
export function client(baseUrl) {
  let cookie = '';

  async function req(method, path, body) {
    const res = await fetch(baseUrl + path, {
      method,
      headers: {
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...(cookie && { cookie }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const header of res.headers.getSetCookie()) {
      const pair = header.split(';')[0];
      if (pair.startsWith('token=')) cookie = pair === 'token=' ? '' : pair;
    }
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  }

  return {
    req,
    get cookie() {
      return cookie;
    },
    register: (username, extra = {}) =>
      req('POST', '/api/auth/register', {
        username,
        displayName: username,
        password: 'password123',
        ...extra,
      }),
    login: (username, password = 'password123') =>
      req('POST', '/api/auth/login', { username, password }),
  };
}
