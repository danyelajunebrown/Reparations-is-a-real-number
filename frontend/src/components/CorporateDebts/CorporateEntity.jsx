import React from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { formatUSD } from '../../api/format.js';

export function CorporateEntity({ entityId }) {
  const { data, loading, error } = useApi(() => api.getCorporateEntity(entityId), [entityId]);

  if (loading) return <div className="state">Loading<span className="blink">_</span></div>;
  if (error) return <div className="state err">Error: {error.message}</div>;

  const e = data?.entity || data;
  if (!e) return <div className="state err">Entity not found.</div>;

  const succession = data?.succession || e.succession || [];
  const debt = data?.debt || e.debt;
  const slaveholding = data?.slaveholding || e.slaveholding || [];
  const instruments = data?.financial_instruments || e.financial_instruments || [];

  return (
    <div className="stack-xl">
      <Link to="/corporate" className="dim">← All corporate debtors</Link>
      <h1 style={{ fontSize: 22, fontWeight: 'normal' }}>{e.name || e.entity_name}</h1>

      <section className="grid-3">
        <Field label="Sector" value={e.sector} />
        <Field label="Founded" value={e.founded_year} />
        <Field label="Current entity" value={e.current_name || e.modern_name} />
        <Field label="Documented enslaved" value={e.enslaved_count} />
        <Field label="Total documented debt" value={debt?.total && formatUSD(debt.total)} />
        <Field label="Methodology" value={debt?.methodology} />
      </section>

      {succession.length > 0 && (
        <section>
          <h2 className="upper" style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>
            Succession chain
          </h2>
          <div className="stack">
            {succession.map((s, i) => (
              <div key={i} className="box">
                <div>{s.from_name} → {s.to_name}</div>
                <div className="dim" style={{ fontSize: 12 }}>
                  {s.year} · {s.type || 'merger'} {s.notes && `· ${s.notes}`}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {instruments.length > 0 && (
        <section>
          <h2 className="upper" style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>
            Financial instruments
          </h2>
          <div className="stack">
            {instruments.map((inst, i) => (
              <div key={i} className="box">
                <div>{inst.type}: {inst.description}</div>
                <div className="dim" style={{ fontSize: 12 }}>
                  {inst.year} {inst.value != null && `· ${formatUSD(inst.value)}`}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {slaveholding.length > 0 && (
        <section>
          <h2 className="upper" style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>
            Slaveholding records ({slaveholding.length})
          </h2>
          <div className="stack">
            {slaveholding.slice(0, 50).map((rec, i) => (
              <div key={i} className="box">
                <div>{rec.enslaved_name || 'unnamed'}</div>
                <div className="dim" style={{ fontSize: 12 }}>
                  {rec.year} {rec.location && `· ${rec.location}`}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div className="box">
      <div className="box-label">{label}</div>
      <div>{value || <span className="dimmer">—</span>}</div>
    </div>
  );
}
