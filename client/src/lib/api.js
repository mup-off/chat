const API_URL = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const API_BASE = API_URL;

let onUnauthorized = () => {};
/** AuthProvider registers this so any 401 logs the user out of the UI. */
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}
/** For non-fetch auth failures (e.g. the socket handshake is rejected). */
export const handleUnauthorized = () => onUnauthorized();

async function request(method, path, body, { signal } = {}) {
  let res;
  try {
    res = await fetch(API_URL + path, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'Cannot reach the server. Check your connection.');
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/')) onUnauthorized();
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  get: (path, opts) => request('GET', path, undefined, opts),
  post: (path, body, opts) => request('POST', path, body, opts),
  patch: (path, body, opts) => request('PATCH', path, body, opts),
};
