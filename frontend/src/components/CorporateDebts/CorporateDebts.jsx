import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';

/**
 * CorporateDebts — Farmer-Paellmann defendants.
 *
 * IMPORTANT: The /api/corporate-debts/calculate endpoint is explicitly gated
 * as RESEARCH_IN_PROGRESS by the backend (src/api/routes/corporate-debts.js
 * lines 42-62). It uses placeholder enslaved counts and unsourced multipliers.
 * We do NOT call that endpoint or display computed debt figures here.
 *
 * Instead, we show the 17 defendants as documented entities with their sector,
 * historical name, and involvement — all of which is sourced from the SCAC
 * complaint paragraphs and is verified fact.
 *
 * Data sources:
 *   GET /api/corporate-debts/farmer-paellmann
 *     → { success, count, defendants: [{ entity_id, modern_name, historical_name,
 *                                         entity_type, scac_paragraph_reference,
 *                                         documented_activity, involvement_category,
 *                                         self_concealment_alleged, misleading_statements_alleged,
 *                                         is_active, stock_ticker }], legalReference }
 *   GET /api/corporate-debts/farmer-paellmann/by-sector
 *     → { success, sectors: [{ sector, defendant_count, defendants: [name,...],
 *                              concealment_alleged_count, misleading_alleged_count }] }
 */
export function CorporateDebts() {
  const defendantsState = useApi(() => api.listFarmerPaellmann(), []);
  const sectorsState = useApi(() => api.getFarmerPaellmannBySector(), []);
  const [activeSector, setActiveSector] = useState(null);

  if (defendantsState.loading || sectorsState.loading) {
    return <div className="state">Loading corporate debts<span className="blink">_</span></div>;
  }
  if (defendantsState.error) {
    return <div className="state err">Error: {defendantsState.error.message}</div>;
  }

  const defendants = defendantsState.data?.defendants || [];
  const sectors = sectorsState.data?.sectors || [];
  const legalRef = defendantsState.data?.legalReference;

  const filtered = activeSector
    ? defendants.filter(d => d.entity_type === activeSector)
    : defendants;

  return (
    <div className="stack-xl">
      <header>
        <h1 style={{ fontSize: 20, fontWeight: 'normal' }}>Corporate debts</h1>
        <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
          Farmer-Paellmann v. FleetBoston Financial (N.D. Ill. 2004). 17 corporate
          defendants whose wealth traces directly to slave labor through insurance
          underwriting, banking, railroad construction, and related industries.
          Succession chains track mergers and acquisitions so present-day entities
          inherit the liability.
        </div>
        {legalRef && (
          <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>{legalRef}</div>
        )}
      </header>

      <div className="box warn" style={{ fontSize: 11 }}>
        <strong>Note on debt figures:</strong> The backend's corporate debt
        calculators (Insurance, Banking, Railroad) are explicitly gated as
        research-in-progress and use placeholder enslaved counts with unsourced
        multipliers. Dollar figures are not displayed here. Defendants are shown
        with their documented activities only — which is verified fact from the
        SCAC complaint.
      </div>

      {sectors.length > 0 && (
        <div className="box">
          <div className="box-label">Sectors</div>
          <div className="row-wrap">
            <button
              type="button"
              onClick={() => setActiveSector(null)}
              style={{
                borderColor: activeSector === null ? 'var(--fg)' : 'var(--border)',
                color: activeSector === null ? 'var(--fg)' : 'var(--dim)',
              }}
            >
              All sectors ({defendants.length})
            </button>
            {sectors.map(s => (
              <button
                key={s.sector}
                type="button"
                onClick={() => setActiveSector(s.sector)}
                style={{
                  borderColor: activeSector === s.sector ? 'var(--fg)' : 'var(--border)',
                  color: activeSector === s.sector ? 'var(--fg)' : 'var(--dim)',
                }}
              >
                {s.sector} ({s.defendant_count})
              </button>
            ))}
          </div>
        </div>
      )}

      <section>
        <h2 className="upper" style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>
          Defendants ({filtered.length})
        </h2>
        <div className="stack">
          {filtered.map(ent => (
            <Link
              key={ent.entity_id}
              to={`/corporate/${ent.entity_id}`}
              className="box"
              style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
            >
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div>{ent.modern_name}</div>
                  {ent.historical_name && ent.historical_name !== ent.modern_name && (
                    <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>
                      formerly {ent.historical_name}
                    </div>
                  )}
                </div>
                <span className="badge unverified">{ent.entity_type}</span>
              </div>
              {ent.documented_activity && (
                <div style={{ fontSize: 12, marginTop: 6 }}>{ent.documented_activity}</div>
              )}
              <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>
                {ent.scac_paragraph_reference && `SCAC ¶${ent.scac_paragraph_reference} · `}
                {/* involvement_category is TEXT[] in PostgreSQL — render as comma-separated */}
                {Array.isArray(ent.involvement_category)
                  ? ent.involvement_category.join(', ')
                  : ent.involvement_category}
                {ent.self_concealment_alleged && ' · alleged concealment'}
                {ent.stock_ticker && ` · ${ent.stock_ticker}`}
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
