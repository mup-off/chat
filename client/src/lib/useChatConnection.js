import { useEffect } from 'react';
import { io } from 'socket.io-client';
import { API_BASE, handleUnauthorized } from './api.js';
import { useChat } from '../store/chat.js';

/**
 * Opens the Socket.io connection for the logged-in user and feeds events into the store.
 * The auth cookie is sent with the handshake (withCredentials).
 */
export function useChatConnection(user) {
  useEffect(() => {
    const store = useChat.getState;
    const socket = io(API_BASE || undefined, { withCredentials: true, autoConnect: false });
    store().attach(user, socket);

    let firstConnect = true;
    socket.on('connect', () => {
      store().setConnected(true);
      if (firstConnect) {
        firstConnect = false;
        store().loadConversations().catch(() => {});
      } else {
        // Reconnected (Wi-Fi drop, server restart): catch up on anything missed.
        store().resync();
      }
    });
    socket.on('disconnect', () => store().setConnected(false));
    socket.on('connect_error', (err) => {
      if (err.message === 'unauthorized') handleUnauthorized();
    });
    socket.on('message:new', (m) => store().receiveMessage(m));
    socket.on('conversation:read', (p) => store().onReadElsewhere(p));
    socket.on('receipt:update', (p) => store().onReceipt(p));
    socket.on('presence:update', (p) => store().onPresence(p));
    socket.on('typing', (p) => store().onTyping(p));
    socket.on('message:deleted', (p) => store().onDeleted(p));
    socket.on('message:hidden', (p) => store().onHidden(p));

    const onVisibility = () => document.visibilityState === 'visible' && store().onVisible();
    document.addEventListener('visibilitychange', onVisibility);

    socket.connect();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      socket.disconnect();
      store().reset();
    };
  }, [user]);
}
