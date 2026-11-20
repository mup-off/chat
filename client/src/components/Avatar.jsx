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

export default function Avatar({ user, size = 'md', online = false }) {
  const sizes = { sm: 'h-9 w-9 text-sm', md: 'h-10 w-10 text-sm', lg: 'h-12 w-12 text-base' };
  return (
    <div className="relative shrink-0">
      <div
        className={`${sizes[size]} ${colorFor(user?.id)} rounded-full grid place-items-center font-semibold text-white`}
        aria-hidden="true"
      >
        {initials(user?.displayName)}
      </div>
      {online && (
        <span
          className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500"
          aria-label="Online"
        />
      )}
    </div>
  );
}
