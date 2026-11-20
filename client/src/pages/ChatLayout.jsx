import { useMemo, useState } from 'react';
import { NavLink, Outlet, useMatch, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { tickFor, useChat } from '../store/chat.js';
import { useChatConnection } from '../lib/useChatConnection.js';
import { formatListTime, previewText } from '../lib/format.js';
import Avatar from '../components/Avatar.jsx';
import NewChatPanel from '../components/NewChatPanel.jsx';
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
  const { user, logout } = useAuth();
  useChatConnection(user);

  const navigate = useNavigate();
  const inThread = useMatch('/c/:conversationId');
  const [showNewChat, setShowNewChat] = useState(false);

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
    setShowNewChat(false);
    navigate(`/c/${conversation.id}`);
  }

  return (
    <div className="h-dvh bg-[#eae6df] md:p-4">
      <div className="mx-auto flex h-full max-w-6xl overflow-hidden bg-white shadow md:rounded-lg">
        <aside
          className={`${inThread ? 'hidden md:flex' : 'flex'} w-full flex-col border-r border-slate-200 md:w-[380px] md:shrink-0`}
        >
          {showNewChat ? (
            <NewChatPanel onClose={() => setShowNewChat(false)} onOpen={openConversation} />
          ) : (
            <>
              <header className="flex items-center gap-3 bg-[#f0f2f5] px-4 py-3">
                <Avatar user={user} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-slate-800">{user.displayName}</div>
                  <div className="truncate text-xs text-slate-500">
                    {connected ? `@${user.username}` : 'Connecting…'}
                  </div>
                </div>
                <button
                  onClick={() => setShowNewChat(true)}
                  className="rounded-full bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  New chat
                </button>
                <button onClick={logout} className="rounded-full px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200">
                  Log out
                </button>
              </header>

              {!connected && (
                <div className="bg-amber-50 px-4 py-2 text-xs text-amber-800">
                  Offline. Messages you send will go out when you reconnect.
                </div>
              )}

              <nav className="flex-1 overflow-y-auto">
                {list.length === 0 ? (
                  <div className="px-6 py-10 text-center text-sm text-slate-500">
                    No chats yet. Tap <b>New chat</b> to find someone.
                  </div>
                ) : (
                  list.map((c) => <ConversationItem key={c.id} conversation={c} meId={user.id} typing={!!typing[c.id]} />)
                )}
              </nav>
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
