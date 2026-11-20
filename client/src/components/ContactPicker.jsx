import { useEffect, useState } from 'react';
import { useUserSearch } from '../lib/useUserSearch.js';
import Avatar from './Avatar.jsx';
import { CloseIcon } from './Icons.jsx';

/** Modal to pick a user whose contact card to share. */
export default function ContactPicker({ onPick, onClose }) {
  const [q, setQ] = useState('');
  const { results, status, error } = useUserSearch(q);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Share contact"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[80dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-panel shadow-xl"
      >
        <div className="flex items-center gap-3 bg-emerald-700 px-4 py-3 text-white">
          <h2 className="flex-1 text-lg font-medium">Share contact</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1 hover:bg-white/10">
            <CloseIcon />
          </button>
        </div>
        <div className="p-3">
          <input
            autoFocus
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, username or phone number"
            className="w-full rounded-lg bg-slate-100 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-600/30"
          />
          <p className="mt-2 px-1 text-xs text-slate-500">
            They’ll see the person’s name and username, never their phone number.
          </p>
        </div>
        <div className="min-h-24 flex-1 overflow-y-auto pb-2">
          {status === 'loading' && <p className="px-4 py-2 text-sm text-slate-500">Searching…</p>}
          {status === 'error' && <p className="px-4 py-2 text-sm text-red-600">{error}</p>}
          {status === 'done' && results.length === 0 && (
            <p className="px-4 py-2 text-sm text-slate-500">No users found for “{q.trim()}”.</p>
          )}
          {results.map((u) => (
            <button
              key={u.id}
              onClick={() => onPick(u)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50"
            >
              <Avatar user={u} />
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-800">{u.displayName}</div>
                <div className="truncate text-sm text-slate-500">@{u.username}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
