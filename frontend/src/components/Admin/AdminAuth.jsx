import React, { useState } from 'react';
import { useAdminAuth } from '../../hooks/useAdminAuth.js';

/**
 * AdminAuth — wraps admin routes with a token gate.
 *
 * On mount: checks stored token against /api/admin/verify.
 *   - valid token → renders children
 *   - missing/invalid → shows login screen
 *
 * Children receive a `logout` function via render prop (optional).
 */
export function AdminAuth({ children }) {
  const { state, login, logout } = useAdminAuth();
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (state.loading) {
    return <div className="state">Verifying admin session<span className="blink">_</span></div>;
  }

  if (!state.authenticated) {
    async function onSubmit(e) {
      e.preventDefault();
      if (!input) return;
      setSubmitting(true);
      await login(input.trim());
      setSubmitting(false);
    }
    return (
      <div className="stack-lg" style={{ maxWidth: 480, margin: '48px auto' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 'normal' }}>Admin login</h1>
          <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
            Enter the admin token. The token is set via the <code>ADMIN_TOKEN</code>
            environment variable on the backend and rotated per event.
          </div>
        </div>
        <form onSubmit={onSubmit} className="stack">
          <input
            type="password"
            placeholder="admin token"
            value={input}
            onChange={e => setInput(e.target.value)}
            autoFocus
          />
          <button type="submit" disabled={!input || submitting}>
            {submitting ? 'Verifying...' : 'Log in'}
          </button>
        </form>
        {state.error && (
          <div className="state err">
            {state.error.status === 401
              ? 'Token rejected.'
              : state.error.status === 503
              ? 'Admin auth not configured on the server.'
              : `Error: ${state.error.message}`}
          </div>
        )}
        <div className="dim" style={{ fontSize: 11 }}>
          Token is stored in your browser's localStorage and sent as the
          X-Admin-Token header on admin API calls. Clear browser data to log out.
        </div>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" onClick={logout} style={{ fontSize: 12 }}>
          Log out
        </button>
      </div>
      {children}
    </div>
  );
}
