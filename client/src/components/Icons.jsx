export function ClockIcon(props) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" strokeLinecap="round" />
    </svg>
  );
}

export function CheckIcon(props) {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DoubleCheckIcon(props) {
  return (
    <svg viewBox="0 0 20 16" width="18" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M1.5 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 11.5l7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SendIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" {...props}>
      <path d="M3.4 20.4l17.45-7.48a1 1 0 000-1.84L3.4 3.6a.993.993 0 00-1.39.91L2 9.12c0 .5.37.93.87.99L17 12 2.87 13.88c-.5.07-.87.5-.87 1l.01 4.61c0 .71.73 1.2 1.39.91z" />
    </svg>
  );
}

export function PaperclipIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M21 11.5l-8.6 8.6a5.5 5.5 0 01-7.8-7.8l8.6-8.6a3.7 3.7 0 015.2 5.2l-8.6 8.6a1.8 1.8 0 01-2.6-2.6l7.9-7.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CloseIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" {...props}>
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}

export function AlertIcon(props) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" {...props}>
      <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 3.5h1.5v4.5h-1.5V4.5zm0 6h1.5V12h-1.5v-1.5z" />
    </svg>
  );
}

/** Status of one of my messages: 🕓 sending, ✓ sent, ✓✓ delivered, blue ✓✓ read, ! failed. */
export function MessageStatus({ status, className = '' }) {
  if (status === 'pending') return <ClockIcon className={`text-slate-400 ${className}`} aria-label="Sending" />;
  if (status === 'failed') return <AlertIcon className={`text-red-500 ${className}`} aria-label="Not sent" />;
  if (status === 'read') return <DoubleCheckIcon className={`text-sky-500 ${className}`} aria-label="Read" />;
  if (status === 'delivered') return <DoubleCheckIcon className={`text-slate-400 ${className}`} aria-label="Delivered" />;
  return <CheckIcon className={`text-slate-400 ${className}`} aria-label="Sent" />;
}
