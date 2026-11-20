import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

function Field({ label, hint, ...props }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        {...props}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
      />
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export default function AuthPage({ mode }) {
  const { user, login, register } = useAuth();
  const isRegister = mode === 'register';
  const [form, setForm] = useState({ username: '', displayName: '', phone: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (isRegister) {
        await register({
          username: form.username,
          displayName: form.displayName,
          password: form.password,
          ...(form.phone.trim() && { phone: form.phone.trim() }),
        });
      } else {
        await login(form.username, form.password);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-app grid place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-emerald-600 text-2xl text-white">
            💬
          </div>
          <h1 className="text-2xl font-semibold text-slate-800">
            {isRegister ? 'Create your account' : 'Welcome back'}
          </h1>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 rounded-2xl bg-panel p-6 shadow-sm">
          <Field
            label="Username"
            autoComplete="username"
            autoFocus
            required
            value={form.username}
            onChange={set('username')}
            hint={isRegister ? 'Letters, numbers and underscores, 3–30 characters' : undefined}
          />
          {isRegister && (
            <>
              <Field label="Display name" required maxLength={60} value={form.displayName} onChange={set('displayName')} />
              <Field
                label="Phone (optional)"
                type="tel"
                autoComplete="tel"
                placeholder="+250780000000"
                value={form.phone}
                onChange={set('phone')}
                hint="International format. Others can find you by your exact number."
              />
            </>
          )}
          <Field
            label="Password"
            type="password"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            required
            minLength={isRegister ? 8 : undefined}
            value={form.password}
            onChange={set('password')}
            hint={isRegister ? 'At least 8 characters' : undefined}
          />

          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-emerald-600 py-2.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {busy ? 'Please wait…' : isRegister ? 'Create account' : 'Log in'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-600">
          {isRegister ? 'Already have an account? ' : 'New here? '}
          <Link to={isRegister ? '/login' : '/register'} className="font-medium text-emerald-700 hover:underline">
            {isRegister ? 'Log in' : 'Create an account'}
          </Link>
        </p>
      </div>
    </main>
  );
}
