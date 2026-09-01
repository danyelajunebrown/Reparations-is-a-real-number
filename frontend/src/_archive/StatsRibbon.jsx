import React, { useState, useEffect } from 'react';
import { api } from '../../api/client.js';
import { formatNumber } from '../../api/format.js';

// Client-side cache key + TTL (5 min, matching server-side cache).
// Prevents burning the rate limit on remounts / React StrictMode double-invokes.
const CACHE_KEY = 'reparations.stats_cache';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function readCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) return null; // expired
    return data;
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch {
    // sessionStorage unavailable (private mode etc.) — silently ignore
  }
}

export function StatsRibbon() {
  const cached = readCache();
  const [stats, setStats] = useState(cached || null);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState(null);

  useEffect(() => {
    // If we already have valid cached data, skip the network request entirely.
    if (readCache()) return;

    let cancelled = false;
    const controller = new AbortController();

    api.stats()
      .then(data => {
        if (cancelled) return;
        const s = data?.stats || {};
        writeCache(s);
        setStats(s);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled || err.name === 'AbortError') return;
        setError(err);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []); // empty deps — fetch once per mount; cache prevents re-fetch on remount

  const s = stats || {};

  return (
    <div className="stats-ribbon" style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: 12,
      marginTop: 16,
      paddingTop: 12,
      borderTop: '1px solid var(--border)',
    }}>
      <Stat label="Total records"    value={s.total_records}  loading={loading} error={error} />
      <Stat label="Slaveholders"     value={s.slaveholders}   loading={loading} error={error} />
      <Stat label="Enslaved persons" value={s.enslaved}       loading={loading} error={error} />
      <Stat label="Unique sources"   value={s.unique_sources} loading={loading} error={error} />
    </div>
  );
}

function Stat({ label, value, loading, error }) {
  let display;
  if (error)   display = <span className="dim">—</span>;
  else if (loading) display = <span className="dim blink">...</span>;
  else         display = formatNumber(value);
  return (
    <div className="box" style={{ padding: 8 }}>
      <div className="box-label">{label}</div>
      <div style={{ fontSize: 18 }}>{display}</div>
    </div>
  );
}
