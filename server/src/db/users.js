/** Shape returned to clients. Phone is only included for the user themself. */
export function toPublicUser(row, { includePhone = false } = {}) {
  const user = {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    lastSeenAt: row.last_seen_at,
  };
  if (includePhone) user.phone = row.phone;
  return user;
}

export const USER_COLUMNS = 'id, username, display_name, phone, last_seen_at';
