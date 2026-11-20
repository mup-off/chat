import { useEffect, useRef } from 'react';

/** Small dropdown attached to a message bubble: Reply / Forward / Delete. */
export default function MessageMenu({ align, items, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const onKey = (e) => e.key === 'Escape' && onClose();
    const onDown = (e) => !ref.current?.contains(e.target) && onClose();
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Message options"
      className={`absolute top-7 z-30 w-44 overflow-hidden rounded-xl bg-panel py-1.5 shadow-xl ring-1 ring-black/5 ${
        align === 'right' ? 'right-1' : 'left-1'
      }`}
    >
      {items.map(({ label, onClick, danger }) => (
        <button
          key={label}
          role="menuitem"
          onClick={() => {
            onClose();
            onClick();
          }}
          className={`block w-full px-4 py-2 text-left text-sm hover:bg-slate-50 focus:bg-slate-50 focus:outline-none ${
            danger ? 'text-red-600' : 'text-slate-700'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
