// Shared UI primitives.
//
// One home for the small building blocks that were previously copy-pasted across
// views (the person-result card lived in BOTH HomePage and SearchPage; a `Section`
// and `Field` helper were re-defined in several components). Everything here speaks
// the design system in styles/global.css — the three type voices (display / body /
// mono-ledger) and the evidence palette (seal / debt / flag).
//
// Consume via:  import { PersonCard, DocumentCard, Section } from '../components/ui/index.jsx';

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatClass, formatYearWithEstimation, formatPct } from '../../api/format.js';

/** Safe hostname for a source URL (used in the person meta line). */
export function hostname(url) {
  try { return new URL(url, 'https://x').hostname; } catch { return ''; }
}

// ── State primitives (consistent loading / empty / error everywhere) ──────────

export function LoadingState({ label = 'Loading' }) {
  return <div className="state">{label}<span className="blink">_</span></div>;
}

export function EmptyState({ children }) {
  return <div className="state">{children}</div>;
}

export function ErrorState({ message }) {
  return <div className="state err">Error: {message}</div>;
}

// ── Section: an eyebrow label over content, with built-in state handling ───────

export function Section({ title, loading, error, children }) {
  return (
    <section>
      <h2
        className="upper"
        style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 'var(--fs-xs)', color: 'var(--ink-soft)', marginBottom: 'var(--sp-2)' }}
      >
        {title}
      </h2>
      {loading && <LoadingState />}
      {error && <ErrorState message={error.message} />}
      {!loading && !error && children}
    </section>
  );
}

// ── PersonCard: the single person-result card (folds the two old PersonResults) ─
// Superset of both prior copies: reads verification_status OR classification, and
// renders the name in the serif display voice.

export function PersonCard({ person }) {
  const id = person.id;
  const source = person.table_source || person.tableSource || 'canonical_persons';
  const cls = person.verification_status || person.classification;
  return (
    <Link
      to={`/person/${source}/${id}`}
      className="box"
      style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
    >
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>
          {person.name || person.full_name}
        </div>
        {cls && <span className={`badge ${cls}`}>{formatClass(cls)}</span>}
      </div>
      <div className="dim" style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--sp-1)' }}>
        {person.type || person.person_type}
        {person.birth_year ? ` · b.${person.birth_year}` : ''}
        {person.location ? ` · ${person.location}` : ''}
        {person.source_url ? ` · ${hostname(person.source_url)}` : ''}
      </div>
    </Link>
  );
}

// ── DocumentCard: the document-result card (was duplicated in Home + Search) ────

export function DocumentCard({ doc }) {
  const id = doc.document_id || doc.id;
  return (
    <Link
      to={`/documents/${id}`}
      className="box"
      style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
    >
      <div>{doc.title || doc.filename || doc.owner_name}</div>
      <div className="dim" style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--sp-1)' }}>
        {doc.doc_type} &middot; {doc.owner_name || 'unknown owner'}
      </div>
    </Link>
  );
}

// ── Evidence primitives (the "ledger spine" — claim hangs off its source) ──────

/** A labelled key/value box. Consolidates the ad-hoc `Field` helpers. */
export function Field({ label, children }) {
  return (
    <div className="box" style={{ padding: 'var(--sp-3)' }}>
      <div className="box-label">{label}</div>
      <div>{children}</div>
    </div>
  );
}

/** Solid seal badge for a primary-source-backed record. */
export function SealBadge({ children = 'Primary source' }) {
  return <span className="badge-seal">&#9679; {children}</span>;
}

/** Citation line in the mono ledger voice (ARKs, IDs, source refs). */
export function Citation({ children }) {
  return <div className="citation">{children}</div>;
}

/** Evidence block with the left ledger-spine rule (seal green, or flag if unproven). */
export function EvidenceBlock({ unproven = false, children }) {
  return <div className={unproven ? 'evidence unproven' : 'evidence'}>{children}</div>;
}

/** The amount owed, in the mono ledger voice, tabular, oxblood. */
export function LedgerFigure({ children }) {
  return <span className="figure-ledger">{children}</span>;
}

// ── RecordDetail: schema-driven field rendering ───────────────────────────────
// Renders any record from a field REGISTRY (see api/fieldRegistry.js) instead of
// hardcoding each field. Because the schema grows every few migrations, adding a
// new column to the UI is a ~one-line registry entry: if the field is present on
// the record it surfaces at its configured priority; if absent it's skipped.
// Only fields with a value render (empty "—" rows are noise, not data), and
// lower-priority fields collapse under "Show all fields" (progressive disclosure).

function EstimatedYear({ formatted }) {
  if (!formatted || formatted === '—') return <span className="dimmer">—</span>;
  if (typeof formatted === 'string') return <span>{formatted}</span>;
  const { yearStr, tooltip } = formatted;
  return (
    <span className="estimate-badge">
      <span className="estimate-badge-year" title={tooltip}>{yearStr}</span>
      <span className="estimate-badge-label" title={tooltip}>(est.)</span>
    </span>
  );
}

function fieldHasValue(field, record) {
  const raw = record?.[field.key];
  if (field.format === 'yearEstimate') return raw != null && raw !== '' && raw !== 0;
  return raw != null && raw !== '';
}

function renderFieldValue(field, record) {
  const raw = record?.[field.key];
  switch (field.format) {
    case 'yearEstimate':
      return (
        <EstimatedYear
          formatted={formatYearWithEstimation(
            raw,
            record?.[`${field.key}_source`],
            record?.[`${field.key}_confidence`],
            record?.[`${field.key}_formula`],
          )}
        />
      );
    case 'mono': return <span className="mono">{raw}</span>;
    case 'pct': return <span className="tnum">{formatPct(raw)}</span>;
    default: return <span>{raw}</span>;
  }
}

export function RecordDetail({ record, fields, extras = [], columns = 3, visibleCount }) {
  const [showAll, setShowAll] = useState(false);

  const items = [];
  for (const f of fields || []) {
    if (!fieldHasValue(f, record)) continue;
    items.push({ label: f.label, priority: f.priority ?? 0, node: renderFieldValue(f, record) });
  }
  // Bespoke fields the registry can't express (e.g. a linked spouse) come in as `extras`.
  for (const e of extras || []) {
    if (e.present === false || e.node == null) continue;
    items.push({ label: e.label, priority: e.priority ?? 0, node: e.node });
  }
  items.sort((a, b) => b.priority - a.priority);

  const cap = visibleCount == null ? items.length : visibleCount;
  const canCollapse = items.length > cap;
  const visible = showAll || !canCollapse ? items : items.slice(0, cap);

  return (
    <>
      <div className={`grid-${columns}`}>
        {visible.map((it, i) => <Field key={it.label + i} label={it.label}>{it.node}</Field>)}
      </div>
      {canCollapse && (
        <button
          type="button"
          onClick={() => setShowAll(s => !s)}
          style={{ marginTop: 'var(--sp-3)', fontSize: 'var(--fs-sm)' }}
        >
          {showAll ? 'Show fewer fields' : `Show all fields (${items.length - cap} more)`}
        </button>
      )}
    </>
  );
}
