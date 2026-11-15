import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, getToken, setToken } from './api.js';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: !!getToken(), user: null, company: null });

  const refresh = useCallback(async () => {
    if (!getToken()) return setState({ loading: false, user: null, company: null });
    try {
      const me = await api.get('/auth/me');
      setState({ loading: false, ...me });
    } catch {
      setToken(null);
      setState({ loading: false, user: null, company: null });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = async (email, password) => {
    const r = await api.post('/auth/login', { email, password });
    setToken(r.token);
    await refresh();
  };
  const register = async (data) => {
    const r = await api.post('/auth/register', data);
    setToken(r.token);
    await refresh();
  };
  const logout = () => { setToken(null); setState({ loading: false, user: null, company: null }); };

  return <AuthCtx.Provider value={{ ...state, login, register, logout, refresh }}>{children}</AuthCtx.Provider>;
}
