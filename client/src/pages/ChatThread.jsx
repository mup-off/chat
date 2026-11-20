import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { quoteOf, tickFor, useChat } from '../store/chat.js';
import { api } from '../lib/api.js';
import { dayKey, formatDayLabel, formatLastSeen, formatTime, quoteText } from '../lib/format.js';
import {
  checkDocument, checkImage, DOCUMENT_ACCEPT, fileExtension, formatBytes, IMAGE_TYPES, mediaUrl,
} from '../lib/images.js';
import Avatar from '../components/Avatar.jsx';
import AttachMenu from '../components/AttachMenu.jsx';
import ContactPicker from '../components/ContactPicker.jsx';
import MessageMenu from '../components/MessageMenu.jsx';
import DeleteDialog from '../components/DeleteDialog.jsx';
import ForwardDialog from '../components/ForwardDialog.jsx';
import { CloseIcon, MessageStatus, PaperclipIcon, SendIcon } from '../components/Icons.jsx';

const MAX_LENGTH = 4000;
const NEAR_BOTTOM_PX = 120;

function Lightbox({ src, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-label="Image" onClick={onClose} className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-4">
      <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 rounded-full p-2 text-white hover:bg-white/10">
        <CloseIcon />
      </button>
      <img src={src} alt="" className="max-h-full max-w-full rounded object-contain" />
    </div>
  );
}

/** Coloured file-type badge, e.g. PDF in red. */
function FileBadge({ name }) {
  const ext = fileExtension(name).slice(0, 4).toUpperCase() || 'FILE';
  const color =
    { PDF: 'bg-red-500', DOC: 'bg-blue-600', DOCX: 'bg-blue-600', XLS: 'bg-green-600', XLSX: 'bg-green-600', CSV: 'bg-green-600', PPT: 'bg-orange-500', PPTX: 'bg-orange-500', ZIP: 'bg-amber-600' }[ext] ??
    'bg-slate-500';
  return (
    <span className={`grid h-10 w-9 shrink-0 place-items-center rounded-md text-[10px] font-bold text-white ${color}`}>
      {ext}
    </span>
  );
}

function DocumentCard({ message, mine }) {
  const uploading = message.status === 'pending' && !message.mediaKey;
  const content = (
    <>
      <FileBadge name={message.mediaName} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] text-slate-800">{message.mediaName}</span>
        <span className="block text-xs text-slate-500">
          {uploading
            ? `Uploading… ${Math.round((message.progress ?? 0) * 100)}%`
            : `${formatBytes(message.mediaSize)} · ${fileExtension(message.mediaName).toUpperCase()}`}
        </span>
      </span>
    </>
  );
  const box = `flex w-64 max-w-full items-center gap-3 rounded-md p-2.5 ${mine ? 'bg-[#c8f0c0]' : 'bg-slate-100'}`;
  return message.mediaKey && message.status === 'sent' ? (
    <a href={mediaUrl(message.mediaKey)} className={`${box} hover:brightness-95`} aria-label={`Download ${message.mediaName}`}>
      {content}
    </a>
  ) : (
    <div className={box}>{content}</div>
  );
}

function ContactCard({ message, meId }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const contact = message.contact;
  if (!contact) return <p className="px-2 py-1 text-sm italic text-slate-500">Contact unavailable</p>;

  async function openChat() {
    setBusy(true);
    try {
      const { conversation } = await api.post('/api/conversations', { userId: contact.id });
      useChat.getState().upsertConversation(conversation);
      navigate(`/c/${conversation.id}`);
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="w-64 max-w-full">
      <div className="flex items-center gap-3 px-2 py-2">
        <Avatar user={contact} />
        <div className="min-w-0">
          <div className="truncate font-medium text-slate-800">{contact.displayName}</div>
          <div className="truncate text-xs text-slate-500">@{contact.username}</div>
        </div>
      </div>
      {contact.id !== meId && message.status === 'sent' && (
        <button
          onClick={openChat}
          disabled={busy}
          className="mt-1 w-full border-t border-black/10 pt-2 pb-1 text-sm font-medium text-emerald-700 hover:underline disabled:opacity-60"
        >
          Message
        </button>
      )}
    </div>
  );
}

function QuoteBlock({ quote, mine, meId, otherName, onJump }) {
  const who = quote.senderId === meId ? 'You' : otherName;
  return (
    <button
      type="button"
      onClick={onJump}
      className={`mb-1 flex w-full min-w-40 items-stretch overflow-hidden rounded-md text-left ${mine ? 'bg-[#c8f0c0]' : 'bg-slate-100'}`}
      aria-label={`Replying to ${who}`}
    >
      <span className={`w-1 shrink-0 ${quote.senderId === meId ? 'bg-emerald-500' : 'bg-violet-500'}`} />
      <span className="min-w-0 flex-1 px-2 py-1">
        <span className={`block text-xs font-medium ${quote.senderId === meId ? 'text-emerald-700' : 'text-violet-700'}`}>{who}</span>
        <span className={`line-clamp-2 text-[13px] text-slate-600 ${quote.deleted ? 'italic' : ''}`}>{quoteText(quote)}</span>
      </span>
      {quote.mediaKey && !quote.deleted && <img src={mediaUrl(quote.mediaKey)} alt="" className="h-12 w-12 shrink-0 object-cover" />}
    </button>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Bubble({ message, mine, meId, otherName, status, highlighted, onRetry, onOpenImage, onImageLoad, onAction, onJump }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { type, deleted } = message;
  const isImage = type === 'image' && !deleted;
  const src = isImage ? message.localUrl ?? (message.mediaKey && mediaUrl(message.mediaKey)) : null;
  const uploading = isImage && message.status === 'pending' && !message.mediaKey;
  const actionable = message.status === 'sent' && message.id;
  const timeEl = (
    <span className="flex items-center gap-1">
      {formatTime(message.createdAt)}
      {mine && !deleted && <MessageStatus status={status} />}
    </span>
  );
  const caption = deleted || type === 'contact' ? null : message.body;
  const padded = deleted || type === 'text';

  const menuItems = deleted
    ? [{ label: 'Delete', onClick: () => onAction('delete'), danger: true }]
    : [
        { label: 'Reply', onClick: () => onAction('reply') },
        { label: 'Forward', onClick: () => onAction('forward') },
        { label: 'Delete', onClick: () => onAction('delete'), danger: true },
      ];

  return (
    <div id={message.id ? `msg-${message.id}` : undefined} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        onContextMenu={(e) => {
          if (!actionable) return;
          e.preventDefault(); // right-click on desktop, long-press on phones
          setMenuOpen(true);
        }}
        className={`group relative max-w-[80%] rounded-lg shadow-sm transition-colors duration-700 md:max-w-[65%] ${
          highlighted ? 'bg-amber-100' : mine ? 'bg-[#d9fdd3]' : 'bg-white'
        } ${padded ? 'px-2.5 pb-1.5 pt-1.5' : 'p-1'}`}
      >
        {actionable && (
          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Message options"
            aria-haspopup="menu"
            className={`absolute right-1 top-1 z-10 rounded-full p-0.5 text-slate-500 opacity-0 hover:bg-black/5 focus:opacity-100 group-hover:opacity-100 ${
              mine ? 'bg-[#d9fdd3]' : 'bg-white'
            } ${menuOpen ? 'opacity-100' : ''}`}
          >
            <ChevronIcon />
          </button>
        )}
        {menuOpen && <MessageMenu align={mine ? 'right' : 'left'} items={menuItems} onClose={() => setMenuOpen(false)} />}

        {message.forwarded && !deleted && (
          <p className={`flex items-center gap-1 text-xs italic text-slate-500 ${padded ? '' : 'px-1.5 pt-0.5'}`}>↪ Forwarded</p>
        )}
        {message.replyTo && !deleted && (
          <QuoteBlock quote={message.replyTo} mine={mine} meId={meId} otherName={otherName} onJump={() => onJump(message.replyTo.id)} />
        )}

        {deleted && (
          <p className="pr-16 text-[15px] italic text-slate-500">🚫 {mine ? 'You deleted this message' : 'This message was deleted'}</p>
        )}
        {isImage && (
          <button type="button" onClick={() => src && onOpenImage(src)} className="relative block overflow-hidden rounded-md" aria-label="Open image">
            {src ? (
              <img
                src={src}
                alt={message.body || 'Photo'}
                onLoad={onImageLoad}
                className="block max-h-80 min-h-24 w-auto min-w-40 max-w-full object-cover"
              />
            ) : (
              <div className="h-48 w-64 bg-slate-200" />
            )}
            {uploading && (
              <div className="absolute inset-0 grid place-items-center bg-black/30 text-sm font-medium text-white">
                {Math.round((message.progress ?? 0) * 100)}%
              </div>
            )}
            {!caption && (
              <span className="absolute bottom-1 right-1.5 rounded bg-black/40 px-1.5 py-0.5 text-[11px] text-white [&_svg]:text-white">
                {timeEl}
              </span>
            )}
          </button>
        )}
        {type === 'document' && !deleted && <DocumentCard message={message} mine={mine} />}
        {type === 'contact' && !deleted && <ContactCard message={message} meId={meId} />}

        {caption && (
          <p className={`whitespace-pre-wrap break-words text-[15px] text-slate-800 ${padded ? '' : 'px-1.5 pb-1 pt-1'}`}>
            {caption}
            {/* Spacer so the time never overlaps the last line of text */}
            <span className={`inline-block ${mine ? 'w-[5.5rem]' : 'w-16'}`} aria-hidden="true" />
          </p>
        )}
        {(caption || deleted || (!isImage && type !== 'text')) && (
          <span className={`text-[11px] text-slate-500 ${caption || deleted ? 'absolute bottom-1 right-2' : 'flex justify-end px-1.5 pt-0.5'}`}>
            {timeEl}
          </span>
        )}

        {message.status === 'failed' && (
          <button onClick={onRetry} className="mt-1 block px-1 text-xs font-medium text-red-600 hover:underline">
            {message.error ?? 'Not sent'} · Tap to retry
          </button>
        )}
      </div>
    </div>
  );
}

function ReplyBar({ quote, meId, otherName, onCancel }) {
  const who = quote.senderId === meId ? 'You' : otherName;
  return (
    <div className="flex items-center gap-2 px-3 pt-2">
      <div className="flex min-w-0 flex-1 overflow-hidden rounded-md bg-white" aria-label="Replying to">
        <span className={`w-1 shrink-0 ${quote.senderId === meId ? 'bg-emerald-500' : 'bg-violet-500'}`} />
        <div className="min-w-0 flex-1 px-3 py-1.5">
          <div className={`text-xs font-medium ${quote.senderId === meId ? 'text-emerald-700' : 'text-violet-700'}`}>{who}</div>
          <div className="truncate text-sm text-slate-600">{quoteText(quote)}</div>
        </div>
        {quote.mediaKey && <img src={mediaUrl(quote.mediaKey)} alt="" className="h-12 w-12 object-cover" />}
      </div>
      <button onClick={onCancel} aria-label="Cancel reply" className="rounded-full p-1.5 text-slate-500 hover:bg-slate-200">
        <CloseIcon />
      </button>
    </div>
  );
}

function AttachmentPreview({ attachment, onRemove }) {
  return (
    <div className="flex items-end gap-3 border-b border-slate-200 px-4 pb-2 pt-3">
      {attachment.kind === 'image' ? (
        <img src={attachment.url} alt="Selected" className="h-24 max-w-48 rounded-md object-cover shadow" />
      ) : (
        <div className="flex max-w-xs items-center gap-3 rounded-md bg-white p-2.5 shadow" aria-label="Selected document">
          <FileBadge name={attachment.file.name} />
          <span className="min-w-0">
            <span className="block truncate text-sm text-slate-800">{attachment.file.name}</span>
            <span className="block text-xs text-slate-500">{formatBytes(attachment.file.size)}</span>
          </span>
        </div>
      )}
      <span className="flex-1 text-xs text-slate-500">Add a caption below, then send.</span>
      <button onClick={onRemove} aria-label="Remove attachment" className="rounded-full p-1.5 text-slate-500 hover:bg-slate-200">
        <CloseIcon />
      </button>
    </div>
  );
}

function Composer({ conversationId, replyTo, onCancelReply, meId, otherName }) {
  const [text, setText] = useState('');
  // { kind: 'image'|'document', file, url?, contentType? }
  const [attachment, setAttachment] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickingContact, setPickingContact] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef(null);
  const imageInput = useRef(null);
  const documentInput = useRef(null);
  const { send, sendFile, sendContact, userTyping, stopTyping } = useChat.getState();

  // Grow with content up to ~6 lines.
  useLayoutEffect(() => {
    const el = ref.current;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  // Starting a reply puts the cursor in the box.
  useEffect(() => {
    if (replyTo) ref.current?.focus();
  }, [replyTo]);

  // Leaving the chat: stop typing, drop any unsent preview.
  useEffect(() => () => stopTyping(conversationId), [conversationId, stopTyping]);
  useEffect(() => () => attachment?.url && URL.revokeObjectURL(attachment.url), [attachment]);

  function attachImage(file) {
    if (!file) return;
    const problem = checkImage(file);
    if (problem) return setError(problem);
    setError('');
    setAttachment({ kind: 'image', file, url: URL.createObjectURL(file) });
    ref.current.focus();
  }

  function attachDocument(file) {
    if (!file) return;
    const { error: problem, contentType } = checkDocument(file);
    if (problem) return setError(problem);
    setError('');
    setAttachment({ kind: 'document', file, contentType });
    ref.current.focus();
  }

  function onMenuSelect(option) {
    setMenuOpen(false);
    if (option === 'image') imageInput.current.click();
    if (option === 'document') documentInput.current.click();
    if (option === 'contact') setPickingContact(true);
  }

  function submit() {
    const body = text.trim();
    if (attachment) {
      sendFile(conversationId, attachment.file, {
        kind: attachment.kind,
        caption: body,
        contentType: attachment.contentType,
        replyTo,
      });
      setAttachment(null);
    } else if (body) {
      send(conversationId, body, replyTo);
    } else {
      return;
    }
    onCancelReply();
    setText('');
    ref.current.focus();
  }

  return (
    <div className="bg-[#f0f2f5]">
      {replyTo && <ReplyBar quote={quoteOf(replyTo)} meId={meId} otherName={otherName} onCancel={onCancelReply} />}
      {attachment && <AttachmentPreview attachment={attachment} onRemove={() => setAttachment(null)} />}
      {error && <p className="px-4 pt-2 text-xs text-red-600" role="alert">{error}</p>}
      <footer className="flex items-end gap-2 px-3 py-2.5">
        <input
          ref={imageInput}
          type="file"
          accept={IMAGE_TYPES.join(',')}
          className="hidden"
          data-testid="image-input"
          onChange={(e) => {
            attachImage(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <input
          ref={documentInput}
          type="file"
          accept={DOCUMENT_ACCEPT}
          className="hidden"
          data-testid="document-input"
          onChange={(e) => {
            attachDocument(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <div className="relative">
          <button
            data-attach-toggle
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Attach"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-200 ${menuOpen ? 'bg-slate-200' : ''}`}
          >
            <PaperclipIcon />
          </button>
          {menuOpen && <AttachMenu onSelect={onMenuSelect} onClose={() => setMenuOpen(false)} />}
        </div>
        <textarea
          ref={ref}
          rows={1}
          value={text}
          maxLength={MAX_LENGTH}
          autoFocus
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value) userTyping(conversationId);
            else stopTyping(conversationId);
          }}
          onPaste={(e) => {
            const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
            if (file) {
              e.preventDefault();
              attachImage(file);
            }
          }}
          onBlur={() => stopTyping(conversationId)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && replyTo) onCancelReply();
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={attachment ? 'Add a caption' : 'Type a message'}
          className="max-h-36 flex-1 resize-none rounded-lg bg-white px-4 py-2.5 text-[15px] outline-none"
        />
        <button
          onClick={submit}
          disabled={!text.trim() && !attachment}
          aria-label="Send"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-slate-300"
        >
          <SendIcon />
        </button>
      </footer>
      {pickingContact && (
        <ContactPicker
          onClose={() => setPickingContact(false)}
          onPick={(user) => {
            setPickingContact(false);
            sendContact(conversationId, user, replyTo);
            onCancelReply();
          }}
        />
      )}
    </div>
  );
}

function HeaderStatus({ other, typing }) {
  if (!other) return null;
  if (typing) return <span className="font-medium text-emerald-600">typing…</span>;
  if (other.online) return 'online';
  return other.lastSeenAt ? formatLastSeen(other.lastSeenAt) : `@${other.username}`;
}

export default function ChatThread() {
  const { conversationId: id } = useParams();
  const { user } = useAuth();

  const conversation = useChat((s) => s.conversations[id]);
  const thread = useChat((s) => s.threads[id]);
  const typing = useChat((s) => !!s.typing[id]);
  const { setActive, ensureConversation, loadThread, loadOlder, retry, markRead } = useChat.getState();
  const [error, setError] = useState('');
  const [lightbox, setLightbox] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [forwarding, setForwarding] = useState(null);
  const [highlightId, setHighlightId] = useState(null);
  const { deleteMessage, forwardMessage } = useChat.getState();

  // Switching chats drops any reply in progress.
  useEffect(() => setReplyTo(null), [id]);

  /** Scroll to a quoted message (if loaded) and flash it. */
  function jumpTo(messageId) {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightId(messageId);
    setTimeout(() => setHighlightId((h) => (h === messageId ? null : h)), 1500);
  }

  function onAction(message, action) {
    if (action === 'reply') setReplyTo(message);
    if (action === 'forward') setForwarding(message);
    if (action === 'delete') setDeleting(message);
  }

  const scrollRef = useRef(null);
  const nearBottom = useRef(true);
  const prev = useRef({ id: null, firstKey: null, lastKey: null, height: 0, top: 0 });

  useEffect(() => {
    setError('');
    setActive(id);
    ensureConversation(id).catch((err) => setError(err.message));
    loadThread(id);
    return () => setActive(null);
  }, [id, setActive, ensureConversation, loadThread]);

  const messages = thread?.messages ?? [];
  const firstKey = messages[0]?.clientMsgId;
  const lastMsg = messages[messages.length - 1];

  // Mark as read when new messages show up while this chat is open.
  useEffect(() => {
    if (thread?.status === 'ready') markRead(id);
  }, [id, thread?.status, lastMsg?.id, markRead]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  // Scroll management: stick to bottom for new messages, keep position when older ones load.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const p = prev.current;
    if (p.id !== id) {
      el.scrollTop = el.scrollHeight; // opened a chat
      nearBottom.current = true;
    } else if (firstKey !== p.firstKey && p.firstKey) {
      el.scrollTop = el.scrollHeight - p.height + p.top; // older messages prepended
    } else if (lastMsg?.clientMsgId !== p.lastKey || typing) {
      const mineNew = lastMsg?.senderId === user.id && lastMsg?.clientMsgId !== p.lastKey;
      if (mineNew || nearBottom.current) el.scrollTop = el.scrollHeight;
    }
    prev.current = { id, firstKey, lastKey: lastMsg?.clientMsgId, height: el.scrollHeight, top: el.scrollTop };
  });

  function onScroll() {
    const el = scrollRef.current;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    prev.current.height = el.scrollHeight;
    prev.current.top = el.scrollTop;
    if (el.scrollTop < 200) loadOlder(id);
  }

  if (error) {
    return (
      <div className="grid flex-1 place-items-center bg-[#efeae2] p-6 text-center">
        <div>
          <p className="text-slate-700">{error}</p>
          <Link to="/" className="mt-2 inline-block text-sm font-medium text-emerald-700 hover:underline">
            Back to chats
          </Link>
        </div>
      </div>
    );
  }

  const other = conversation?.otherUser;

  return (
    <>
      <header className="flex items-center gap-3 bg-[#f0f2f5] px-3 py-2.5">
        <Link to="/" className="rounded-full p-1 text-slate-600 hover:bg-slate-200 md:hidden" aria-label="Back">
          ←
        </Link>
        <Avatar user={other} />
        <div className="min-w-0">
          <div className="truncate font-medium text-slate-800">{other?.displayName ?? '…'}</div>
          <div className="truncate text-xs text-slate-500" aria-live="polite">
            <HeaderStatus other={other} typing={typing} />
          </div>
        </div>
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto bg-[#efeae2] px-3 py-3 md:px-12">
        {thread?.status === 'loading' && <p className="py-6 text-center text-sm text-slate-500">Loading messages…</p>}
        {thread?.status === 'error' && (
          <p className="py-6 text-center text-sm text-red-600">
            {thread.error}{' '}
            <button className="underline" onClick={() => loadThread(id)}>
              Try again
            </button>
          </p>
        )}
        {thread?.loadingOlder && <p className="py-2 text-center text-xs text-slate-500">Loading older messages…</p>}
        {thread?.status === 'ready' && !thread.hasMore && (
          <div className="mx-auto mb-3 w-fit rounded-lg bg-[#fff5c4] px-4 py-1.5 text-center text-xs text-slate-600 shadow-sm">
            This is the start of your chat with {other?.displayName ?? 'them'}.
          </div>
        )}

        <div className="space-y-1">
          {messages.map((m, i) => {
            const newDay = i === 0 || dayKey(m.createdAt) !== dayKey(messages[i - 1].createdAt);
            const groupGap = i > 0 && messages[i - 1].senderId !== m.senderId && !newDay;
            const mine = m.senderId === user.id;
            return (
              <Fragment key={m.clientMsgId}>
                {newDay && (
                  <div className="sticky top-0 z-10 flex justify-center py-2">
                    <span className="rounded-lg bg-white/95 px-3 py-1 text-xs text-slate-600 shadow-sm">
                      {formatDayLabel(m.createdAt)}
                    </span>
                  </div>
                )}
                <div className={groupGap ? 'pt-2' : ''}>
                  <Bubble
                    message={m}
                    mine={mine}
                    meId={user.id}
                    otherName={other?.displayName ?? 'Them'}
                    highlighted={highlightId === m.id}
                    onAction={(action) => onAction(m, action)}
                    onJump={jumpTo}
                    status={mine ? tickFor(m, conversation?.receipts) : null}
                    onRetry={() => retry(id, m.clientMsgId)}
                    onOpenImage={setLightbox}
                    onImageLoad={() => nearBottom.current && scrollToBottom()}
                  />
                </div>
              </Fragment>
            );
          })}
        </div>

        {typing && (
          <div className="mt-2 flex justify-start" aria-label={`${other?.displayName} is typing`}>
            <div className="flex gap-1 rounded-lg bg-white px-3 py-3 shadow-sm">
              {[0, 150, 300].map((d) => (
                <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${d}ms` }} />
              ))}
            </div>
          </div>
        )}
      </div>

      <Composer
        key={id}
        conversationId={id}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        meId={user.id}
        otherName={other?.displayName ?? 'Them'}
      />
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
      {deleting && (
        <DeleteDialog
          message={deleting}
          mine={deleting.senderId === user.id}
          onDelete={(scope) => deleteMessage(id, deleting.id, scope)}
          onClose={() => setDeleting(null)}
        />
      )}
      {forwarding && (
        <ForwardDialog
          quote={quoteOf(forwarding)}
          onForward={(targets) => forwardMessage(forwarding.id, targets)}
          onClose={() => setForwarding(null)}
        />
      )}
    </>
  );
}
