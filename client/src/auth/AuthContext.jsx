import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setUnauthorizedHandler } from '../lib/api.js';
import { applyAppearance } from '../lib/theme.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // undefined = still checking the session, null = logged out
  const [user, setUserState] = useState(undefined);

  // Every time we learn who the user is, apply their saved theme + wallpaper.
  const setUser = useCallback((u) => {
    setUserState(u);
    if (u?.settings) applyAppearance(u.settings);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api
      .get('/api/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setUser(null));
  }, [setUser]);

  const login = useCallback(
    async (username, password) => {
      const d = await api.post('/api/auth/login', { username, password });
      setUser(d.user);
    },
    [setUser],
  );

  const register = useCallback(
    async (fields) => {
      const d = await api.post('/api/auth/register', fields);
      setUser(d.user);
    },
    [setUser],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setUser(null);
    }
  }, [setUser]);

  /** Save profile/settings changes (PATCH /api/me) and update everywhere. */
  const updateProfile = useCallback(
    async (fields) => {
      const d = await api.patch('/api/me', fields);
      setUser(d.user);
      return d.user;
    },
    [setUser],
  );

  /** Another tab of mine changed my profile (socket `user:updated`). */
  const applyRemoteProfile = useCallback((publicUser) => {
    setUserState((u) => (u && u.id === publicUser.id ? { ...u, ...publicUser } : u));
  }, []);

  const value = useMemo(
    () => ({ user, login, register, logout, updateProfile, applyRemoteProfile }),
    [user, login, register, logout, updateProfile, applyRemoteProfile],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
