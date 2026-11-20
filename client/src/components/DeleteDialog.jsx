import { useEffect, useState } from 'react';

const DELETE_FOR_EVERYONE_MS = 48 * 60 * 60 * 1000; // must match the server

export default function DeleteDialog({ message, mine, onDelete, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canDeleteForEveryone =
    mine && !message.deleted && Date.now() - new Date(message.createdAt).getTime() < DELETE_FOR_EVERYONE_MS;

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function run(scope) {
    setBusy(true);
    setError('');
    try {
      await onDelete(scope);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const btn = 'w-full rounded-full px-4 py-2 text-sm font-medium disabled:opacity-60';
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Delete message"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-panel p-5 shadow-xl"
      >
        <h2 className="text-lg font-medium text-slate-800">Delete message?</h2>
        <p className="mt-1 text-sm text-slate-500">
          {canDeleteForEveryone
            ? '“Delete for everyone” removes it for both of you.'
            : '“Delete for me” removes it only from your chats.'}
        </p>
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="mt-5 space-y-2">
          {canDeleteForEveryone && (
            <button disabled={busy} onClick={() => run('everyone')} className={`${btn} bg-red-600 text-white hover:bg-red-700`}>
              Delete for everyone
            </button>
          )}
          <button
            disabled={busy}
            onClick={() => run('me')}
            className={`${btn} ${canDeleteForEveryone ? 'border border-red-200 text-red-600 hover:bg-red-50' : 'bg-red-600 text-white hover:bg-red-700'}`}
          >
            Delete for me
          </button>
          <button disabled={busy} onClick={onClose} className={`${btn} text-slate-600 hover:bg-slate-100`}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
