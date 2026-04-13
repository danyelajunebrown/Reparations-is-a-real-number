import { useState, useEffect, useCallback } from 'react';
import { api, setAdminToken, clearAdminToken, getAdminToken } from '../api/client.js';

/**
 * useAdminAuth — manages the admin bearer token stored in localStorage.
 *
 * On mount, if a token is present, verifies it against /api/admin/verify.
 * Returns: { state, login, logout }
 *
 * state:
 *   loading:      verifying stored token
 *   authenticated: token is valid
 *   error:        verification failed
 *
 * The admin UI renders only when authenticated === true. Otherwise, the
 * AdminAuth component shows a login screen.
 */
export function useAdminAuth() {
  const [state, setState] = useState({
    loading: true,
    authenticated: false,
    error: null,
  });

  const verify = useCallback(async () => {
    const token = getAdminToken();
    if (!token) {
      setState({ loading: false, authenticated: false, error: null });
      return;
    }
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      await api.verifyAdmin();
      setState({ loading: false, authenticated: true, error: null });
    } catch (err) {
      // Invalid token — clear it so we don't keep retrying
      clearAdminToken();
      setState({ loading: false, authenticated: false, error: err });
    }
  }, []);

  useEffect(() => {
    verify();
  }, [verify]);

  const login = useCallback(async (token) => {
    setAdminToken(token);
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      await api.verifyAdmin();
      setState({ loading: false, authenticated: true, error: null });
      return true;
    } catch (err) {
      clearAdminToken();
      setState({ loading: false, authenticated: false, error: err });
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    clearAdminToken();
    setState({ loading: false, authenticated: false, error: null });
  }, []);

  return { state, login, logout };
}
