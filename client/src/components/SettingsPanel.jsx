import { useId, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../lib/api.js';
import { squareAvatar, uploadWithProgress } from '../lib/images.js';
import { THEMES, WALLPAPERS } from '../lib/theme.js';
import Avatar from './Avatar.jsx';

function Section({ title, children }) {
  return (
    <section className="border-b border-slate-200 px-5 py-5">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-emerald-700">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, hint, ...props }) {
  const hintId = useId();
  // The hint sits outside the <label> (linked via aria-describedby) so the field's
  // accessible name is just the label.
  return (
    <div className="mb-3">
      <label className="block">
        <span className="text-sm text-slate-600">{label}</span>
        <input
          {...props}
          aria-describedby={hint ? hintId : undefined}
          className="mt-1 w-full rounded-lg border border-slate-200 bg-panel px-3 py-2 text-slate-800 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
        />
      </label>
      {hint && <span id={hintId} className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </div>
  );
}

const Status = ({ state }) =>
  state.error ? (
    <p role="alert" className="mt-2 text-sm text-red-600">{state.error}</p>
  ) : state.ok ? (
    <p role="status" className="mt-2 text-sm text-emerald-700">{state.ok}</p>
  ) : null;

function PhotoEditor() {
  const { user, updateProfile } = useAuth();
  const input = useRef(null);
  const [state, setState] = useState({});
  const [busy, setBusy] = useState(false);

  async function upload(file) {
    if (!file) return;
    setBusy(true);
    setState({});
    try {
      const blob = await squareAvatar(file);
      const { uploadUrl, key } = await api.post('/api/me/avatar-upload', { contentType: blob.type, size: blob.size });
      await uploadWithProgress(uploadUrl, blob, () => {});
      await updateProfile({ avatarKey: key });
      setState({ ok: 'Profile photo updated' });
    } catch (err) {
      setState({ error: err.message || 'Could not update your photo' });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setState({});
    try {
      await updateProfile({ avatarKey: null });
      setState({ ok: 'Profile photo removed' });
    } catch (err) {
      setState({ error: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center">
      <button
        onClick={() => input.current.click()}
        disabled={busy}
        className="group relative rounded-full focus:outline-none focus:ring-4 focus:ring-emerald-600/30"
        aria-label="Change profile photo"
      >
        <Avatar user={user} size="xl" />
        <span className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-sm font-medium text-white opacity-0 transition group-hover:opacity-100 group-focus:opacity-100">
          {busy ? 'Uploading…' : user.avatarUrl ? 'Change photo' : 'Add photo'}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        data-testid="avatar-input"
        onChange={(e) => {
          upload(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => input.current.click()}
          disabled={busy}
          className="rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {user.avatarUrl ? 'Change photo' : 'Add photo'}
        </button>
        {user.avatarUrl && (
          <button
            onClick={remove}
            disabled={busy}
            className="rounded-full px-4 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
          >
            Remove photo
          </button>
        )}
      </div>
      <Status state={state} />
    </div>
  );
}

function ProfileForm() {
  const { user, updateProfile } = useAuth();
  const [name, setName] = useState(user.displayName);
  const [about, setAbout] = useState(user.about ?? '');
  const [state, setState] = useState({});
  const [busy, setBusy] = useState(false);
  const changed = name.trim() !== user.displayName || about.trim() !== (user.about ?? '');

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setState({});
    try {
      await updateProfile({ displayName: name, about });
      setState({ ok: 'Profile saved' });
    } catch (err) {
      setState({ error: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-5">
      <Field label="Name" value={name} maxLength={60} required onChange={(e) => setName(e.target.value)} />
      <Field
        label="About"
        value={about}
        maxLength={140}
        placeholder="Hey there! I am using Chat."
        onChange={(e) => setAbout(e.target.value)}
        hint={`${about.length}/140 · Shown to people who find or chat with you`}
      />
      <button
        type="submit"
        disabled={!changed || busy || !name.trim()}
        className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:bg-slate-300"
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
      <Status state={state} />
    </form>
  );
}

function Appearance() {
  const { user, updateProfile } = useAuth();
  const settings = user.settings ?? { theme: 'system', wallpaper: 'default' };
  const [error, setError] = useState('');

  const choose = (patch) => {
    setError('');
    updateProfile(patch).catch((err) => setError(err.message));
  };

  return (
    <>
      <fieldset>
        <legend className="mb-2 text-sm text-slate-600">Theme</legend>
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map((t) => (
            <label
              key={t.id}
              className={`cursor-pointer rounded-lg border px-3 py-2 text-center text-sm ${
                settings.theme === t.id
                  ? 'border-emerald-600 bg-emerald-600/10 font-medium text-emerald-700'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                name="theme"
                value={t.id}
                checked={settings.theme === t.id}
                onChange={() => choose({ theme: t.id })}
                className="sr-only"
              />
              {t.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-5">
        <legend className="mb-2 text-sm text-slate-600">Chat wallpaper</legend>
        <div className="flex flex-wrap gap-3">
          {WALLPAPERS.map((w) => {
            const selected = settings.wallpaper === w.id;
            return (
              <label key={w.id} className="flex cursor-pointer flex-col items-center gap-1 text-xs text-slate-600">
                <input
                  type="radio"
                  name="wallpaper"
                  value={w.id}
                  checked={selected}
                  onChange={() => choose({ wallpaper: w.id })}
                  className="sr-only"
                  aria-label={`${w.label} wallpaper`}
                />
                <span
                  className={`block h-12 w-12 rounded-xl border-2 shadow-sm ${selected ? 'border-emerald-600 ring-2 ring-emerald-600/30' : 'border-slate-200'}`}
                  style={{ background: `linear-gradient(135deg, ${w.light} 50%, ${w.dark} 50%)` }}
                />
                {w.label}
              </label>
            );
          })}
        </div>
      </fieldset>
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
    </>
  );
}

function PasswordForm() {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [state, setState] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (form.next !== form.confirm) return setState({ error: 'New passwords don’t match' });
    setBusy(true);
    setState({});
    try {
      await api.post('/api/auth/password', { currentPassword: form.current, newPassword: form.next });
      setForm({ current: '', next: '', confirm: '' });
      setState({ ok: 'Password changed' });
    } catch (err) {
      setState({ error: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Field label="Current password" type="password" autoComplete="current-password" required value={form.current} onChange={set('current')} />
      <Field label="New password" type="password" autoComplete="new-password" required minLength={8} value={form.next} onChange={set('next')} hint="At least 8 characters" />
      <Field label="Confirm new password" type="password" autoComplete="new-password" required value={form.confirm} onChange={set('confirm')} />
      <button
        type="submit"
        disabled={busy || !form.current || !form.next}
        className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:bg-slate-300"
      >
        {busy ? 'Changing…' : 'Change password'}
      </button>
      <Status state={state} />
    </form>
  );
}

export default function SettingsPanel({ onClose }) {
  const { user, logout } = useAuth();
  return (
    <div className="flex h-full flex-col bg-panel" role="region" aria-label="Settings">
      <div className="flex items-center gap-4 bg-emerald-700 px-4 pb-3 pt-4 text-white">
        <button onClick={onClose} aria-label="Back" className="rounded-full p-1 hover:bg-white/10">
          ←
        </button>
        <h2 className="text-lg font-medium">Settings</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Section title="Profile">
          <PhotoEditor />
          <ProfileForm />
        </Section>

        <Section title="Appearance">
          <Appearance />
        </Section>

        <Section title="Account">
          <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-500">Username</dt>
            <dd className="text-slate-800">@{user.username}</dd>
            <dt className="text-slate-500">Phone</dt>
            <dd className="text-slate-800">{user.phone ?? '—'}</dd>
          </dl>
          <PasswordForm />
        </Section>

        <div className="px-5 py-5">
          <button
            onClick={logout}
            className="w-full rounded-full border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
