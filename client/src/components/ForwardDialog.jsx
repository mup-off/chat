import { useEffect, useMemo, useState } from 'react';
import { useChat } from '../store/chat.js';
import { quoteText } from '../lib/format.js';
import Avatar from './Avatar.jsx';
import { CloseIcon } from './Icons.jsx';

const MAX_TARGETS = 5; // must match the server

/** Pick up to 5 of my chats to forward a message to. */
export default function ForwardDialog({ quote, onForward, onClose }) {
  const conversations = useChat((s) => s.conversations);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const chats = useMemo(() => {
    const term = q.trim().toLowerCase();
    return Object.values(conversations)
      .filter((c) => c.otherUser)
      .filter(
        (c) =>
          !term ||
          c.otherUser.displayName.toLowerCase().includes(term) ||
          c.otherUser.username.includes(term),
      )
      .sort((a, b) => (b.lastMessage?.createdAt ?? b.createdAt).localeCompare(a.lastMessage?.createdAt ?? a.createdAt));
  }, [conversations, q]);

  function toggle(id) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < MAX_TARGETS ? [...s, id] : s));
  }

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await onForward(selected);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Forward message"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
      >
        <div className="flex items-center gap-3 bg-emerald-700 px-4 py-3 text-white">
          <h2 className="flex-1 text-lg font-medium">Forward message to</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1 hover:bg-white/10">
            <CloseIcon />
          </button>
        </div>
        <div className="border-b border-slate-100 p-3">
          <p className="mb-2 truncate rounded-md border-l-4 border-emerald-500 bg-slate-50 px-3 py-1.5 text-sm text-slate-600">
            {quoteText(quote)}
          </p>
          <input
            autoFocus
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search chats"
            className="w-full rounded-lg bg-slate-100 px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-600/30"
          />
        </div>
        <ul className="min-h-24 flex-1 overflow-y-auto py-1">
          {chats.length === 0 && <li className="px-4 py-3 text-sm text-slate-500">No chats found.</li>}
          {chats.map((c) => {
            const checked = selected.includes(c.id);
            const disabled = !checked && selected.length >= MAX_TARGETS;
            return (
              <li key={c.id}>
                <label className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-slate-50 ${disabled ? 'opacity-50' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggle(c.id)}
                    className="h-4 w-4 accent-emerald-600"
                    aria-label={c.otherUser.displayName}
                  />
                  <Avatar user={c.otherUser} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-800">{c.otherUser.displayName}</span>
                    <span className="block truncate text-xs text-slate-500">@{c.otherUser.username}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {error && <p role="alert" className="px-4 pb-2 text-sm text-red-600">{error}</p>}
        <div className="flex items-center gap-3 border-t border-slate-100 px-4 py-3">
          <span className="flex-1 text-sm text-slate-500">
            {selected.length ? `${selected.length} selected` : `Choose up to ${MAX_TARGETS} chats`}
          </span>
          <button
            onClick={submit}
            disabled={!selected.length || busy}
            className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:bg-slate-300"
          >
            {busy ? 'Forwarding…' : 'Forward'}
          </button>
        </div>
      </div>
    </div>
  );
}
