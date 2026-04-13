import React from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { formatUSD, formatInt } from '../../api/format.js';

/**
 * LegalTopic — detail view for /legal/:topic.
 *
 * Topic dispatch:
 *   uk-1833         → /api/legal/uk-1833 → renders UK1833View
 *   haiti           → /api/legal/haiti → renders HaitiView
 *   farmer-paellmann → /api/legal/farmer-paellmann → renders FarmerPaellmannView
 *   jurisdictions   → /api/legal/jurisdictions → renders JurisdictionsView
 *
 * Response shapes verified against src/api/routes/legal-precedents.js and
 * src/services/reparations/LegalPrecedentService.js (Apr 13, 2026).
 */
export function LegalTopic({ topic }) {
  const fetcher = getFetcher(topic);
  const { data, loading, error } = useApi(fetcher || (() => Promise.resolve(null)), [topic]);

  if (!fetcher) return <div className="state err">Unknown topic: {topic}</div>;
  if (loading) return <div className="state">Loading<span className="blink">_</span></div>;
  if (error) return <div className="state err">Error: {error.message}</div>;

  return (
    <div className="stack-xl">
      <Link to="/legal" className="dim">← Framework overview</Link>
      <h1 style={{ fontSize: 22, fontWeight: 'normal' }}>{topicTitle(topic)}</h1>
      {topic === 'uk-1833' && <UK1833View data={data} />}
      {topic === 'haiti' && <HaitiView data={data} />}
      {topic === 'farmer-paellmann' && <FarmerPaellmannView data={data} />}
      {topic === 'jurisdictions' && <JurisdictionsView data={data} />}
    </div>
  );
}

// --- UK 1833 ----------------------------------------------------------------

function UK1833View({ data }) {
  if (!data) return <div className="state">No data.</div>;
  const d = data.data || {};
  const args = data.keyArguments || [];
  const citation = data.citation;

  return (
    <div className="stack-xl">
      <Lede>
        The British government borrowed £20 million in 1835 — 40% of the
        national budget — to compensate slaveholders after the Slavery
        Abolition Act 1833. Final payment was made by British taxpayers in
        2015. <strong>The descendants of the enslaved paid taxes toward this
        debt for 182 years.</strong>
      </Lede>

      <Section title="The loan">
        <div className="grid-3">
          <Field label="Original amount" value={d.loan_amount_original} suffix={d.loan_currency} />
          <Field label="Loan date" value={fmtDate(d.loan_date)} />
          <Field label="Final payment" value={fmtDate(d.final_payment_date)} />
          <Field label="Years to payoff" value={d.years_to_payoff} />
          <Field label="Modern value (GBP)" value={d.modern_value_gbp ? formatUSD(d.modern_value_gbp).replace('$', '£') : null} />
          <Field label="Modern value (USD)" value={d.modern_value_usd && formatUSD(d.modern_value_usd)} />
        </div>
      </Section>

      <Section title="Who received what">
        <div className="grid-2">
          <Field label="Owners received" value={d.owners_received} />
          <Field label="Enslaved received" value={d.enslaved_received} />
          <Field label="Enslaved persons documented" value={formatInt(d.enslaved_count)} />
          <Field label="Paid by" value={d.paid_by} />
        </div>
      </Section>

      {args.length > 0 && (
        <Section title="Key arguments">
          <ul style={{ paddingLeft: 20, fontSize: 13 }}>
            {args.map((a, i) => <li key={i} style={{ marginBottom: 6 }}>{a}</li>)}
          </ul>
        </Section>
      )}

      {d.arguments && (
        <Section title="Database notes">
          <Pre>{stringifyMaybe(d.arguments)}</Pre>
        </Section>
      )}

      {d.notes && <Section title="Notes"><Pre>{d.notes}</Pre></Section>}

      {(d.primary_source || citation) && (
        <Cite>
          {citation && <div>{citation}</div>}
          {d.primary_source && <div className="mono" style={{ marginTop: 4, fontSize: 11 }}>{d.primary_source}</div>}
        </Cite>
      )}
    </div>
  );
}

// --- Haiti ------------------------------------------------------------------

function HaitiView({ data }) {
  if (!data) return <div className="state">No data.</div>;
  const d = data.data || {};
  const args = data.keyArguments || [];
  const citation = data.citation;

  return (
    <div className="stack-xl">
      <Lede>
        After winning independence in 1804, Haiti was forced by France in 1825
        to pay 150 million gold francs as compensation for the "loss" of
        enslaved property. Haiti finished paying in 1947 — 122 years of
        compound interest paid by the descendants of the enslaved themselves,
        for the audacity of being free. Modern value: ~$21 billion USD.
      </Lede>

      <Section title="The demand">
        <div className="grid-3">
          <Field label="Original demand" value={d.original_demand} suffix={d.original_currency} />
          <Field label="Demand date" value={fmtDate(d.demand_date)} />
          <Field label="Final payment year" value={d.final_payment_year} />
          <Field label="Years paying" value={d.years_paying} />
          <Field label="Amount paid" value={d.amount_paid} suffix={d.payment_currency} />
          <Field label="Modern value (USD)" value={d.modern_value_usd && formatUSD(d.modern_value_usd)} />
        </div>
      </Section>

      <Section title="Framing">
        <div className="grid-2">
          <Field label="France extorted for" value={d.france_extorted_for} />
          <Field label="Haiti gained" value={d.haiti_gained} />
        </div>
      </Section>

      {args.length > 0 && (
        <Section title="Key arguments">
          <ul style={{ paddingLeft: 20, fontSize: 13 }}>
            {args.map((a, i) => <li key={i} style={{ marginBottom: 6 }}>{a}</li>)}
          </ul>
        </Section>
      )}

      {d.arguments && (
        <Section title="Database notes">
          <Pre>{stringifyMaybe(d.arguments)}</Pre>
        </Section>
      )}

      {d.notes && <Section title="Notes"><Pre>{d.notes}</Pre></Section>}

      {(d.primary_source || citation || d.academic_sources) && (
        <Cite>
          {citation && <div>{citation}</div>}
          {d.primary_source && <div className="mono" style={{ marginTop: 4, fontSize: 11 }}>{d.primary_source}</div>}
          {d.academic_sources && <div className="mono" style={{ marginTop: 4, fontSize: 11 }}>{stringifyMaybe(d.academic_sources)}</div>}
        </Cite>
      )}
    </div>
  );
}

// --- Farmer-Paellmann -------------------------------------------------------

function FarmerPaellmannView({ data }) {
  if (!data) return <div className="state">No data.</div>;
  const d = data.data || {};
  const summary = data.summary || {};

  return (
    <div className="stack-xl">
      <Lede>
        In re African-American Slave Descendants Litigation (N.D. Ill. 2004)
        was dismissed primarily on standing, statute of limitations, and
        political question grounds. The factual record it built — corporate
        defendants, succession chains, documented slaveholding — is the
        foundation for everything tracked in this system. The strategic
        lesson: avoid the standing trap by pursuing individual DAAs first.
      </Lede>

      <Section title="The case">
        <div className="grid-2">
          <Field label="Case name" value={d.case_name} />
          <Field label="Citation" value={d.citation} mono />
          <Field label="Court" value={d.court} />
          <Field label="Judge" value={d.judge} />
          <Field label="Decision date" value={fmtDate(d.decision_date)} />
          <Field label="Outcome" value={d.outcome || summary.outcome} />
        </div>
      </Section>

      {(d.failure_points || summary.mainFailures) && (
        <Section title="Why it failed">
          <ul style={{ paddingLeft: 20, fontSize: 13 }}>
            {(asArray(d.failure_points) || summary.mainFailures || []).map((f, i) => (
              <li key={i} style={{ marginBottom: 6 }}>{String(f)}</li>
            ))}
          </ul>
        </Section>
      )}

      {(d.changed_circumstances || summary.changedCircumstances) && (
        <Section title="What has changed since 2004">
          <ul style={{ paddingLeft: 20, fontSize: 13 }}>
            {(asArray(d.changed_circumstances) || summary.changedCircumstances || []).map((c, i) => (
              <li key={i} style={{ marginBottom: 6 }}>{String(c)}</li>
            ))}
          </ul>
        </Section>
      )}

      {d.strategic_lessons && (
        <Section title="Strategic lessons">
          <Pre>{stringifyMaybe(d.strategic_lessons)}</Pre>
        </Section>
      )}

      {summary.ourStrategy && (
        <Section title="Our strategy">
          <div className="box">{summary.ourStrategy}</div>
        </Section>
      )}

      {d.notes && <Section title="Notes"><Pre>{d.notes}</Pre></Section>}
    </div>
  );
}

// --- Jurisdictions ----------------------------------------------------------

function JurisdictionsView({ data }) {
  if (!data) return <div className="state">No data.</div>;
  const jurisdictions = data.jurisdictions || [];
  const note = data.note;

  return (
    <div className="stack-xl">
      <Lede>
        Triangle Trade participants. Each jurisdiction has its own legal
        history, mechanisms for redress, and strategic posture. The system
        tracks all of them so DAAs can be tailored to the relevant legal
        framework.
      </Lede>

      {note && <div className="dim" style={{ fontSize: 12 }}>{note}</div>}

      <div className="stack">
        {jurisdictions.map((j, i) => (
          <div key={i} className="box">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div style={{ fontSize: 16 }}>{j.country_name || j.country || j.name}</div>
              {j.priority && <span className="badge unverified">priority {j.priority}</span>}
            </div>
            {j.legal_system && (
              <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>{j.legal_system}</div>
            )}
            {j.strategy && (
              <div style={{ fontSize: 13, marginTop: 6 }}>{j.strategy}</div>
            )}
            {j.recommended_mechanism && (
              <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>
                Recommended mechanism: {j.recommended_mechanism}
              </div>
            )}
            {j.notes && <Pre style={{ marginTop: 6 }}>{j.notes}</Pre>}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Helpers ----------------------------------------------------------------

function getFetcher(topic) {
  switch (topic) {
    case 'uk-1833': return () => api.getUK1833();
    case 'haiti': return () => api.getHaitiDebt();
    case 'farmer-paellmann': return () => api.getFarmerPaellmannLegal();
    case 'jurisdictions': return () => api.listJurisdictions();
    default: return null;
  }
}

function topicTitle(topic) {
  return {
    'uk-1833': 'UK 1833 Compensation Loan',
    'haiti': 'Haiti independence debt',
    'farmer-paellmann': 'Farmer-Paellmann strategic lessons',
    'jurisdictions': 'Triangle Trade jurisdictions',
  }[topic] || topic;
}

function Lede({ children }) {
  return (
    <div className="box" style={{ borderColor: 'var(--fg)' }}>
      <div className="box-label">Summary</div>
      <div style={{ fontSize: 13, marginTop: 4 }}>{children}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section>
      <h2 className="upper" style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, value, suffix, mono }) {
  return (
    <div className="box">
      <div className="box-label">{label}</div>
      <div style={{ fontFamily: mono ? 'var(--font-mono)' : undefined, wordBreak: 'break-word' }}>
        {value == null || value === '' ? <span className="dimmer">—</span> : (
          <>
            {String(value)}
            {suffix && <span className="dim"> {suffix}</span>}
          </>
        )}
      </div>
    </div>
  );
}

function Cite({ children }) {
  return (
    <div className="box" style={{ borderStyle: 'dashed', fontSize: 11, color: 'var(--dim)' }}>
      <div className="box-label">Citation</div>
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  );
}

function Pre({ children, style }) {
  return (
    <pre style={{
      whiteSpace: 'pre-wrap',
      fontSize: 12,
      color: 'var(--dim)',
      border: '1px solid var(--border)',
      padding: 12,
      overflow: 'auto',
      ...style,
    }}>
      {children}
    </pre>
  );
}

function fmtDate(d) {
  if (!d) return null;
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toISOString().slice(0, 10);
}

function stringifyMaybe(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function asArray(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [v];
    } catch {
      return [v];
    }
  }
  return [v];
}
