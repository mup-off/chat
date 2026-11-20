import { useEffect, useRef } from 'react';

function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 7V3.5L18.5 9H13zM8 13h8v1.5H8V13zm0 3.5h8V18H8v-1.5z" />
    </svg>
  );
}
function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zM8.5 7a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM5 19l3.5-4.5 2.5 3 3.5-4.5L19 19H5z" />
    </svg>
  );
}
function ContactIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <path d="M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-3.3 0-8 1.7-8 5v1h16v-1c0-3.3-4.7-5-8-5z" />
    </svg>
  );
}

const OPTIONS = [
  { id: 'document', label: 'Document', Icon: DocumentIcon, color: 'bg-violet-500' },
  { id: 'image', label: 'Photos & images', Icon: ImageIcon, color: 'bg-sky-500' },
  { id: 'contact', label: 'Contact', Icon: ContactIcon, color: 'bg-orange-500' },
];

/** WhatsApp-style attachment menu that pops up above the 📎 button. */
export default function AttachMenu({ onSelect, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    const onClick = (e) => {
      if (!ref.current?.contains(e.target) && !e.target.closest('[data-attach-toggle]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Attach"
      className="absolute bottom-full left-0 z-20 mb-2 w-56 overflow-hidden rounded-2xl bg-white py-2 shadow-xl ring-1 ring-black/5"
    >
      {OPTIONS.map(({ id, label, Icon, color }) => (
        <button
          key={id}
          role="menuitem"
          onClick={() => onSelect(id)}
          className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] text-slate-700 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
        >
          <span className={`grid h-9 w-9 place-items-center rounded-full text-white ${color}`}>
            <Icon />
          </span>
          {label}
        </button>
      ))}
    </div>
  );
}
