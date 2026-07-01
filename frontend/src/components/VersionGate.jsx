/* global __BUILD_SHA__ */
import React, { useEffect, useState } from 'react';

/**
 * VersionGate — detects a stale client. The running bundle knows the SHA it was built from
 * (__BUILD_SHA__, injected by vite.config.js). It fetches dist/version.json with cache:'no-store'
 * (bypassing the HTTP cache that GitHub Pages can't disable) and, if the deployed SHA differs,
 * shows a non-intrusive banner prompting a refresh. This is why today's "search shows nothing"
 * incident (a cached index.html pointing at old bundles) will be self-evident next time.
 */
const BUILD_SHA = typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'dev';
const CHECK_MS = 5 * 60 * 1000; // re-check every 5 minutes + on tab focus

export default function VersionGate() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const url = `${import.meta.env.BASE_URL}version.json?t=${Date.now()}`;
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) return;
        const { sha } = await r.json();
        if (!cancelled && sha && BUILD_SHA !== 'dev' && sha !== BUILD_SHA) setStale(true);
      } catch { /* offline / not deployed yet — ignore */ }
    }
    check();
    const id = setInterval(check, CHECK_MS);
    const onFocus = () => check();
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, []);

  if (!stale) return null;
  return (
    <div
      className="version-gate"
      role="alert"
      style={{
        position: 'sticky', top: 0, zIndex: 1000,
        background: '#1f6feb', color: '#fff',
        fontFamily: 'var(--font-mono, monospace)', fontSize: '0.85rem',
        padding: '6px 12px', textAlign: 'center',
      }}
    >
      A new version of this site is available.{' '}
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          marginLeft: 8, cursor: 'pointer',
          background: '#fff', color: '#1f6feb', border: 'none',
          borderRadius: 3, padding: '2px 10px', fontWeight: 600,
        }}
      >
        Refresh
      </button>
    </div>
  );
}

export { BUILD_SHA };
