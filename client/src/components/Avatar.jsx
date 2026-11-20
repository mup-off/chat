import { useState } from 'react';
import { API_BASE } from '../lib/api.js';

const COLORS = [
  'bg-emerald-600', 'bg-sky-600', 'bg-violet-600', 'bg-rose-600',
  'bg-amber-600', 'bg-teal-600', 'bg-indigo-600', 'bg-fuchsia-600',
];

function colorFor(id = '') {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

function initials(name = '?') {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

const SIZES = {
  sm: 'h-9 w-9 text-sm',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-36 w-36 text-4xl',
};

/** Profile photo if the user has one, otherwise coloured initials. */
export default function Avatar({ user, size = 'md', online = false }) {
  const [failed, setFailed] = useState(null);
  const src = user?.avatarUrl && failed !== user.avatarUrl ? API_BASE + user.avatarUrl : null;

  return (
    <div className="relative shrink-0">
      {src ? (
        <img
          src={src}
          alt=""
          data-avatar
          onError={() => setFailed(user.avatarUrl)}
          className={`${SIZES[size]} rounded-full bg-slate-200 object-cover`}
        />
      ) : (
        <div
          className={`${SIZES[size]} ${colorFor(user?.id)} grid place-items-center rounded-full font-semibold text-white`}
          aria-hidden="true"
        >
          {initials(user?.displayName)}
        </div>
      )}
      {online && (
        <span
          className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-panel bg-emerald-500"
          aria-label="Online"
        />
      )}
    </div>
  );
}
