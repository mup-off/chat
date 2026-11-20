/** avatars/<userId>/<file> -> /api/avatars/<userId>/<file> (access-checked redirect). */
export const avatarUrl = (key) => (key ? `/api/${key}` : null);

export const WALLPAPERS = ['default', 'mint', 'sky', 'lavender', 'sand', 'slate'];

/**
 * Shape returned to clients. Everyone sees name, photo and about; only the user
 * themself (includePrivate) gets their phone number and settings.
 */
export function toPublicUser(row, { includePrivate = false } = {}) {
  const user = {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    about: row.about ?? null,
    avatarUrl: avatarUrl(row.avatar_key),
    lastSeenAt: row.last_seen_at,
  };
  if (includePrivate) {
    user.phone = row.phone;
    user.settings = { theme: row.theme, wallpaper: row.wallpaper };
  }
  return user;
}

export const USER_COLUMNS = 'id, username, display_name, phone, last_seen_at, about, avatar_key, theme, wallpaper';
