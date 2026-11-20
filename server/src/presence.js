import { config } from './config.js';

/**
 * In-memory presence for a single server instance: userId -> Set<socketId>.
 * A user is online while they have at least one socket, plus a short grace period
 * after the last one closes (so a page reload doesn't flash "offline").
 * Scaling to several instances needs this in Redis (see plan.md).
 */
const sockets = new Map();
const offlineTimers = new Map();

export const isOnline = (userId) => sockets.has(userId);

/** Returns true if the user just came online (was fully offline before). */
export function addSocket(userId, socketId) {
  const pendingOffline = offlineTimers.get(userId);
  if (pendingOffline) {
    clearTimeout(pendingOffline);
    offlineTimers.delete(userId);
  }
  const set = sockets.get(userId);
  if (set) {
    set.add(socketId);
    return false;
  }
  sockets.set(userId, new Set([socketId]));
  return true;
}

/**
 * Removes a socket. If it was the user's last one, calls onOffline(lastSeenAt)
 * after the grace period unless they reconnect first.
 */
export function removeSocket(userId, socketId, onOffline) {
  const set = sockets.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (set.size > 0) return;

  const lastSeenAt = new Date();
  offlineTimers.set(
    userId,
    setTimeout(() => {
      offlineTimers.delete(userId);
      if (sockets.get(userId)?.size === 0) {
        sockets.delete(userId);
        onOffline(lastSeenAt);
      }
    }, config.presenceGraceMs),
  );
}
