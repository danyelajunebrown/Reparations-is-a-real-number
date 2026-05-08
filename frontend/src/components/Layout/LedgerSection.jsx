import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { formatNumber, formatInt } from '../../api/format.js';

/**
 * LedgerSection — unified live-data section for the home page.
 *
 * Replaces the separate StatsRibbon + hardcoded "What's in this ledger" box.
 * Makes ONE api.stats() call and renders:
 *   1. Live aggregate stats grid (enslaved, slaveholders, DC petitions, MSA certs, sources)
 *   2. Collections list (Freedmen's Bank — static 61K; doc types; corporate; blockchain)
 *
 * Cold-start UX:
 *   - After 8s of loading  → advisory: "database waking up (Render free tier, ~30s)"
 *   - On error            → "database unavailable — counts not loaded"
 *   - On load             → clears advisory immediately
 *
 * Stats fields used from /api/contribute/stats:
 *   enslaved          — sum canonical + enslaved_individuals + unconfirmed
 *   slaveholders      — sum canonical + unconfirmed
 *   civilwardc_records — DC Civil War petitions (1862)
 *   msa_records       — MSA SC 2908 Certificates of Freedom (1806-1864)
 *   unique_sources    — distinct source URLs across unconfirmed_persons
 */
export function LedgerSection() {
  const { data, loading, error } = useApi(() => api.stats(), []);
  const [slowLoad, setSlowLoad] = useState(false);

  // Trigger slow-load advisory after 8 seconds; clear it immediately on completion.
  useEffect(() => {
    if (!loading) {
      setSlowLoad(false);
      return;
    }
    const t = setTimeout(() => setSlowLoad(true), 8000);
    return () => clearTimeout(t);
  }, [loading]);

  const stats = data?.stats || {};

  return (
    <div style={{ width: '100%', marginTop: 40 }}>

      {/* ── Section label ──────────────────────────────────── */}
      <div
        className="upper"
        style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 10 }}
      >
        Ledger
      </div>

      {/* ── Cold-start / error advisories ─────────────────── */}
      {loading && slowLoad && (
        <div style={{ fontSize: 11, color: 'var(--warn)', marginBottom: 8 }}>
          database waking up — Render free tier (~30s on first visit)
        </div>
      )}
      {error && !loading && (
        <div style={{ fontSize: 11, color: 'var(--err)', marginBottom: 8 }}>
          database unavailable — live counts not loaded
        </div>
      )}

      {/* ── Live stats grid ────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <StatBox
          label="Enslaved persons"
          value={stats.enslaved}
          fmt={formatNumber}
          loading={loading}
          error={error}
        />
        <StatBox
          label="Slaveholders"
          value={stats.slaveholders}
          fmt={formatNumber}
          loading={loading}
          error={error}
        />
        <StatBox
          label="DC petitions (1862)"
          value={stats.civilwardc_records}
          fmt={formatInt}
          loading={loading}
          error={error}
        />
        <StatBox
          label="Certificates of Freedom"
          value={stats.msa_records}
          fmt={formatInt}
          loading={loading}
          error={error}
        />
        <StatBox
          label="Unique sources"
          value={stats.unique_sources}
          fmt={formatNumber}
          loading={loading}
          error={error}
        />
      </div>

      {/* ── Collections — static or lightly annotated ─────── */}
      <div
        className="box"
        style={{ fontSize: 12, color: 'var(--dim)', padding: '10px 12px' }}
      >
        <CollectionLine to="/depositors">
          61,000+ Freedmen's Bank account holders (1865–1874)
        </CollectionLine>
        <CollectionLine to="/documents">
          Slave schedules · wills · deeds · ship manifests · runaway ads
        </CollectionLine>
        <CollectionLine to="/corporate">
          11 institutional corporate slavery disclosures (Aetna, JPMorgan Chase, Wells Fargo…)
        </CollectionLine>
        <CollectionLine to="/pay" last>
          Base blockchain escrow (ReparationsEscrow.sol)
        </CollectionLine>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatBox({ label, value, fmt, loading, error }) {
  let display;
  if (error && !loading) display = <span className="dim">—</span>;
  else if (loading) display = <span className="dim blink">...</span>;
  else display = fmt(value);

  return (
    <div className="box" style={{ padding: 8 }}>
      <div className="box-label">{label}</div>
      <div style={{ fontSize: 18 }}>{display}</div>
    </div>
  );
}

function CollectionLine({ to, children, last }) {
  return (
    <div style={{ borderBottom: last ? 'none' : '1px solid var(--border)', padding: '5px 0' }}>
      <Link
        to={to}
        style={{
          color: 'var(--dim)',
          textDecoration: 'none',
          display: 'block',
          lineHeight: 1.6,
        }}
      >
        {children}
      </Link>
    </div>
  );
}
