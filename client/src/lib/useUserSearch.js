import { useEffect, useState } from 'react';
import { api } from './api.js';

/** Search-as-you-type over /api/users (debounced, cancels stale requests). */
export function useUserSearch(q) {
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [error, setError] = useState('');

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setStatus('idle');
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setStatus('loading');
      try {
        const d = await api.get(`/api/users?search=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        setResults(d.users);
        setStatus('done');
      } catch (err) {
        if (err.name === 'AbortError') return;
        setError(err.message);
        setStatus('error');
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q]);

  return { results, status, error };
}
