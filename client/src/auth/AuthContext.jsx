import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setUnauthorizedHandler } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // undefined = still checking the session, null = logged out
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api
      .get('/api/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setUser(null));
  }, []);

  const login = useCallback(async (username, password) => {
    const d = await api.post('/api/auth/login', { username, password });
    setUser(d.user);
  }, []);

  const register = useCallback(async (fields) => {
    const d = await api.post('/api/auth/register', fields);
    setUser(d.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(() => ({ user, login, register, logout }), [user, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
