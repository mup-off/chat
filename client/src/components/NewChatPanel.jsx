import { useState } from 'react';
import { api } from '../lib/api.js';
import { useUserSearch } from '../lib/useUserSearch.js';
import Avatar from './Avatar.jsx';

export default function NewChatPanel({ onClose, onOpen }) {
  const [q, setQ] = useState('');
  const { results, status, error: searchError } = useUserSearch(q);
  const [error, setError] = useState('');
  const [openingId, setOpeningId] = useState(null);

  async function open(user) {
    setOpeningId(user.id);
    setError('');
    try {
      const d = await api.post('/api/conversations', { userId: user.id });
      onOpen(d.conversation);
    } catch (err) {
      setError(err.message);
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex items-center gap-4 bg-emerald-700 px-4 pb-3 pt-4 text-white">
        <button onClick={onClose} aria-label="Back" className="rounded-full p-1 hover:bg-white/10">
          ←
        </button>
        <h2 className="text-lg font-medium">New chat</h2>
      </div>

      <div className="p-3">
        <input
          autoFocus
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
          placeholder="Search name, username or phone number"
          className="w-full rounded-lg bg-slate-100 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-600/30"
        />      </div>

      <div className="flex-1 overflow-y-auto">
        {status === 'loading' && <p className="px-4 py-3 text-sm text-slate-500">Searching…</p>}
        {(error || status === 'error') && <p className="px-4 py-3 text-sm text-red-600">{error || searchError}</p>}
        {status === 'done' && results.length === 0 && (
          <p className="px-4 py-3 text-sm text-slate-500">No users found for “{q.trim()}”.</p>
        )}
        <ul>
          {results.map((u) => (
            <li key={u.id}>
              <button
                onClick={() => open(u)}
                disabled={openingId !== null}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 disabled:opacity-60"
              >
                <Avatar user={u} />
                <div className="min-w-0 flex-1 border-b border-slate-100 pb-3">
                  <div className="truncate font-medium text-slate-800">{u.displayName}</div>
                  <div className="truncate text-sm text-slate-500">{u.about || `@${u.username}`}</div>
                </div>
                {openingId === u.id && <span className="text-xs text-slate-500">Opening…</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
