import { useMemo, useState } from 'react';
import { NavLink, Outlet, useMatch, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { tickFor, useChat } from '../store/chat.js';
import { useChatConnection } from '../lib/useChatConnection.js';
import { formatListTime, previewText } from '../lib/format.js';
import Avatar from '../components/Avatar.jsx';
import NewChatPanel from '../components/NewChatPanel.jsx';
import SettingsPanel from '../components/SettingsPanel.jsx';

/** Chat bubble with a plus: the floating "new chat" button. */
function NewChatIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M20 11.5a8 8 0 01-11.8 7l-4.2 1.3 1.3-4A8 8 0 1120 11.5z" strokeLinejoin="round" />
      <path d="M12 8v7M8.5 11.5h7" strokeLinecap="round" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </svg>
  );
}
import { MessageStatus } from '../components/Icons.jsx';

function ConversationItem({ conversation: c, meId, typing }) {
  const last = c.lastMessage;
  const mine = last?.senderId === meId && !typing;
  return (
    <NavLink
      to={`/c/${c.id}`}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 hover:bg-slate-50 ${isActive ? 'bg-slate-100' : ''}`
      }
    >
      <Avatar user={c.otherUser} size="lg" online={c.otherUser?.online} />
      <div className="min-w-0 flex-1 border-b border-slate-100 py-3">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{c.otherUser?.displayName}</span>
          {last && (
            <span className={`shrink-0 text-xs ${c.unreadCount ? 'font-medium text-emerald-600' : 'text-slate-500'}`}>
              {formatListTime(last.createdAt)}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1">
          {mine && <MessageStatus status={tickFor(last, c.receipts)} className="shrink-0" />}
          {typing ? (
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-emerald-600">typing…</span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-sm text-slate-500">
              {last ? previewText(last) : <i>No messages yet</i>}
            </span>
          )}
          {c.unreadCount > 0 && (
            <span
              aria-label={`${c.unreadCount} unread`}
              className="ml-1 grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-emerald-500 px-1.5 text-xs font-semibold text-white"
            >
              {c.unreadCount > 99 ? '99+' : c.unreadCount}
            </span>
          )}
        </div>
      </div>
    </NavLink>
  );
}

export default function ChatLayout() {
  const { user, applyRemoteProfile } = useAuth();
  useChatConnection(user, applyRemoteProfile);

  const navigate = useNavigate();
  const inThread = useMatch('/c/:conversationId');
  const [panel, setPanel] = useState(null); // null | 'new' | 'settings'

  const conversations = useChat((s) => s.conversations);
  const activeId = useChat((s) => s.activeId);
  const connected = useChat((s) => s.connected);
  const typing = useChat((s) => s.typing);
  const upsertConversation = useChat((s) => s.upsertConversation);

  // Newest activity first; empty chats only show while open.
  const list = useMemo(
    () =>
      Object.values(conversations)
        .filter((c) => c.lastMessage || c.id === activeId)
        .sort((a, b) =>
          (b.lastMessage?.createdAt ?? b.createdAt).localeCompare(a.lastMessage?.createdAt ?? a.createdAt),
        ),
    [conversations, activeId],
  );

  function openConversation(conversation) {
    upsertConversation(conversation);
    setPanel(null);
    navigate(`/c/${conversation.id}`);
  }

  return (
    <div className="h-dvh bg-app md:p-4">
      <div className="mx-auto flex h-full max-w-6xl overflow-hidden bg-panel shadow md:rounded-lg">
        <aside
          className={`${inThread ? 'hidden md:flex' : 'flex'} w-full flex-col border-r border-slate-200 md:w-[380px] md:shrink-0`}
        >
          {panel === 'new' ? (
            <NewChatPanel onClose={() => setPanel(null)} onOpen={openConversation} />
          ) : panel === 'settings' ? (
            <SettingsPanel onClose={() => setPanel(null)} />
          ) : (
            <>
              <header className="flex items-center gap-3 bg-panel-2 px-4 py-3">
                <button onClick={() => setPanel('settings')} aria-label="Profile and settings" className="rounded-full">
                  <Avatar user={user} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-slate-800">{user.displayName}</div>
                  <div className="truncate text-xs text-slate-500">
                    {connected ? `@${user.username}` : 'Connecting…'}
                  </div>
                </div>
                <button
                  onClick={() => setPanel('settings')}
                  aria-label="Settings"
                  title="Settings"
                  className="grid h-9 w-9 place-items-center rounded-full text-slate-600 hover:bg-slate-200"
                >
                  <GearIcon />
                </button>
              </header>

              {!connected && (
                <div className="bg-amber-50 px-4 py-2 text-xs text-amber-800">
                  Offline. Messages you send will go out when you reconnect.
                </div>
              )}

              <div className="relative min-h-0 flex-1">
                {/* pb-24 keeps the last chat clear of the floating button */}
                <nav className="h-full overflow-y-auto pb-24">
                  {list.length === 0 ? (
                    <div className="px-6 py-10 text-center text-sm text-slate-500">
                      No chats yet. Tap the <b>new chat</b> button below to find someone.
                    </div>
                  ) : (
                    list.map((c) => <ConversationItem key={c.id} conversation={c} meId={user.id} typing={!!typing[c.id]} />)
                  )}
                </nav>

                <button
                  onClick={() => setPanel('new')}
                  aria-label="New chat"
                  title="New chat"
                  className="absolute bottom-5 right-5 grid h-14 w-14 place-items-center rounded-2xl bg-emerald-600 text-white shadow-lg shadow-black/20 transition hover:bg-emerald-700 hover:shadow-xl focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-600/40 active:scale-95"
                >
                  <NewChatIcon />
                </button>
              </div>
            </>
          )}
        </aside>

        <section className={`${inThread ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
          <Outlet />
        </section>
      </div>
    </div>
  );
}
