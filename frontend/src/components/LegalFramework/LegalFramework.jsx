import React from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { formatUSD } from '../../api/format.js';

/**
 * LegalFramework — Triangle Trade jurisdictions, UK 1833 loan, Haiti debt,
 * Farmer-Paellmann lessons, legal doctrines. Sourced from the /api/legal
 * endpoints (LegalPrecedentService).
 */
export function LegalFramework() {
  const { data, loading, error } = useApi(() => api.getFrameworkSummary(), []);

  if (loading) return <div className="state">Loading framework<span className="blink">_</span></div>;
  if (error) return <div className="state err">Error: {error.message}</div>;

  const f = data?.framework || data || {};

  return (
    <div className="stack-xl">
      <header>
        <h1 style={{ fontSize: 20, fontWeight: 'normal' }}>Legal framework</h1>
        <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
          Multi-jurisdictional accountability for the Atlantic slave trade.
          Starting point: the UK 1833 compensation loan — a 182-year debt
          finally repaid by British taxpayers in 2015 — which proves that
          multi-generational slavery-era debt enforcement is possible in
          living legal memory.
        </div>
      </header>

      <div className="grid-2">
        <Tile
          to="/legal/uk-1833"
          title="UK 1833 Compensation Loan"
          body="Primary precedent. £20M borrowed in 1835 to compensate slaveholders after abolition. Final payment made by British taxpayers in 2015 — 182 years later."
        />
        <Tile
          to="/legal/haiti"
          title="Haiti independence debt"
          body="Counter-precedent. France extorted 150M francs from newly independent Haiti (1825) as compensation for 'loss' of enslaved 'property'. Modern value: ~$21 billion."
        />
        <Tile
          to="/legal/farmer-paellmann"
          title="Farmer-Paellmann v. FleetBoston (2004)"
          body="Strategic lessons from a case that was dismissed on standing grounds. The factual record it built is the foundation for the corporate debts tracked here."
        />
        <Tile
          to="/legal/jurisdictions"
          title="Triangle Trade jurisdictions"
          body="Legal mechanisms across UK, US, France, Spain, Netherlands, Portugal. Doctrines of unjust enrichment, continuing trespass, successor liability."
        />
      </div>

      {f.precedents && (
        <section>
          <h2 className="upper" style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>
            Ranked precedents
          </h2>
          <div className="stack">
            {f.precedents.map((p, i) => (
              <div key={i} className="box">
                <div>{p.name}</div>
                <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
                  Strength: {p.strength} · {p.jurisdiction} {p.year && `· ${p.year}`}
                </div>
                {p.summary && (
                  <div style={{ fontSize: 12, marginTop: 6 }}>{p.summary}</div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {f.doctrines && (
        <section>
          <h2 className="upper" style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>
            Legal doctrines
          </h2>
          <div className="grid-2">
            {f.doctrines.map((d, i) => (
              <div key={i} className="box">
                <div>{d.name}</div>
                <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>{d.summary}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Tile({ to, title, body }) {
  return (
    <Link to={to} className="box" style={{
      textDecoration: 'none',
      color: 'inherit',
      display: 'block',
      padding: 16,
    }}>
      <div className="upper" style={{ fontSize: 12, color: 'var(--dim)' }}>{title}</div>
      <div style={{ marginTop: 6, fontSize: 13 }}>{body}</div>
    </Link>
  );
}
