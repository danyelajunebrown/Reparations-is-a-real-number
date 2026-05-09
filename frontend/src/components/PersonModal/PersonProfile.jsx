import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, isVerified } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { ReparationsBreakdown } from '../Reparations/ReparationsBreakdown.jsx';
import { DocOverlay, DocCollectionOverlay } from '../DocumentViewer/DocumentViewer.jsx';
import {
  formatClass,
  CLASS_LABELS,
  CLASS_DESCRIPTIONS,
  formatYear,
  formatYearWithEstimation,
} from '../../api/format.js';

/**
 * PersonProfile — full page view of a verified person.
 *
 * Shows: identity, classification badge, enslaver matches (with lineage tree),
 * enslaved persons (if slaveholder), reparations breakdown (multi-calculator),
 * source attribution, primary documents.
 *
 * Strict: if the person is not verified, shows a refusal state. Admin can
 * view unverified via /admin route (separate component).
 */
export function PersonProfile({ personId, tableSource, adminOverride = false }) {
  const [viewDocId, setViewDocId] = useState(null);
  const [viewCollection, setViewCollection] = useState(null);
  const { data, loading, error } = useApi(
    signal => api.getPerson(personId, tableSource, signal),
    [personId, tableSource]
  );

  if (loading) return <div className="state">Loading person<span className="blink">_</span></div>;
  if (error) return <div className="state err">Error: {error.message}</div>;
  if (!data?.person) return <div className="state err">Person not found.</div>;

  const p = data.person;
  const verified = adminOverride || isVerified({
    verification_status: p.verification_status,
    status: p.status,
    table_source: tableSource,
  });

  if (!verified) {
    return (
      <div className="state err">
        This record has not been verified against primary sources and is not
        displayed on the public site. If you are an administrator, review it
        at <code>/admin/review</code>.
      </div>
    );
  }

  const reparations = data.reparations;
  const owner = data.owner;
  const enslavedPersons = data.enslavedPersons || [];
  const documents = data.documents || [];
  const ownerDocuments = data.ownerDocuments || [];
  const documentCollections = data.documentCollections || [];
  const descendants = data.descendants || [];
  const links = data.links || {};
  const coverage = data.coverage || {};

  // Backend returns familyMembers as { parents: [], children: [], spouse }
  // NOT a flat array — guard against either shape for safety
  const familyMembers = data.familyMembers || {};
  const parents = Array.isArray(familyMembers.parents) ? familyMembers.parents
    : Array.isArray(familyMembers) ? familyMembers.filter(m => m.relationship_type === 'parent' || m.role === 'parent')
    : [];
  const children = Array.isArray(familyMembers.children) ? familyMembers.children
    : Array.isArray(familyMembers) ? familyMembers.filter(m => m.relationship_type === 'child' || m.role === 'child')
    : [];
  const spouseFromFamily = familyMembers.spouse || null;

  // Names to highlight in document viewer — built from all related persons on this profile
  const namesToHighlight = [
    { name: p.full_name || p.name, category: 'primary' },
    ...(owner ? [{ name: owner.full_name, category: 'owner' }] : []),
    ...enslavedPersons.slice(0, 10).map(ep => ({ name: ep.full_name, category: 'enslaved' })),
  ].filter(n => n.name && n.name.length > 1);

  // Birth/death year formatted with estimation badge support
  const birthYearFormatted = formatYearWithEstimation(
    p.birth_year, p.birth_year_source, p.birth_year_confidence, p.birth_year_formula
  );
  const deathYearFormatted = formatYearWithEstimation(
    p.death_year, p.death_year_source, p.death_year_confidence, p.death_year_formula
  );
  const freedomYearFormatted = formatYearWithEstimation(
    p.freedom_year, p.freedom_year_source, null, null
  );

  return (
    <div className="stack-xl">
      <header>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 'normal' }}>{p.full_name || p.name || 'Unknown'}</h1>
            <div className="dim" style={{ marginTop: 4 }}>
              {p.person_type || p.type || 'unknown type'}
              {p.birth_year && ` · b.${formatYear(p.birth_year)}`}
              {p.death_year && `–${formatYear(p.death_year)}`}
              {p.location && ` · ${p.location}`}
            </div>
            {coverage.source_label && (
              <div style={{ marginTop: 6 }}>
                <span className="source-badge">{coverage.source_label}</span>
              </div>
            )}
          </div>
          {p.verification_status && (
            <div style={{ textAlign: 'right' }}>
              <span className={`badge ${p.verification_status}`}>
                {formatClass(p.verification_status)}
              </span>
              <div className="dim" style={{ fontSize: 11, marginTop: 4, maxWidth: 280 }}>
                {CLASS_DESCRIPTIONS[p.verification_status]}
              </div>
            </div>
          )}
        </div>
      </header>

      <Section title="Identity">
        <div className="grid-3">
          <Field label="Birth year" value={<YearDisplay formatted={birthYearFormatted} />} />
          <Field label="Death year" value={<YearDisplay formatted={deathYearFormatted} />} />
          <Field label="Gender" value={p.gender} />
          <Field label="Location" value={p.location} />
          {p.primary_plantation && (
            <Field label="Plantation" value={p.primary_plantation} />
          )}
          {p.freedom_year && (
            <Field label="Freedom year" value={<YearDisplay formatted={freedomYearFormatted} />} />
          )}
          <Field label="Occupation" value={p.occupation} />
          <Field label="Spouse" value={p.spouse_name} />
          <Field label="Racial designation" value={p.racial_designation} />
          <Field label="Source table" value={tableSource} />
          <Field label="Status" value={p.status} />
        </div>
      </Section>

      {owner && (
        <Section title="Enslaved by">
          <Link
            to={`/person/canonical_persons/${owner.id}`}
            className="box"
            style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
          >
            <div>{owner.full_name}</div>
            <div className="dim" style={{ fontSize: 12 }}>
              {owner.location}{owner.birth_year && ` · b.${owner.birth_year}`}
            </div>
            {owner.account_number && (
              <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>
                Freedmen's Bank acct #{owner.account_number}
                {owner.branch && ` · ${owner.branch} branch`}
                {owner.plantation && ` · ${owner.plantation}`}
              </div>
            )}
          </Link>

          {/* DC Compensated Emancipation Petition */}
          {owner.petition && (
            <div className="box" style={{ marginTop: 8, borderColor: 'var(--cls-free-poc)' }}>
              <div className="box-label" style={{ color: 'var(--cls-free-poc)' }}>
                DC Compensated Emancipation Petition
              </div>
              <div style={{ fontSize: 12 }}>
                {owner.petition.petitioner_name && (
                  <div>Petitioner: <strong>{owner.petition.petitioner_name}</strong></div>
                )}
                {owner.petition.petition_date && (
                  <div className="dim">Date: {owner.petition.petition_date}</div>
                )}
                {owner.petition.enslaved_name && (
                  <div className="dim">Enslaved named: {owner.petition.enslaved_name}</div>
                )}
                {owner.petition.compensation_amount && (
                  <div className="dim">Compensation claimed: ${owner.petition.compensation_amount}</div>
                )}
                {owner.petition.source_url && (
                  <a
                    href={owner.petition.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 11, marginTop: 4, display: 'inline-block' }}
                  >
                    Primary source →
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Inheritance / provenance chain */}
          {owner.inheritance_chain && owner.inheritance_chain.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="box-label">Provenance / inheritance chain</div>
              <div className="provenance-chain">
                {owner.inheritance_chain.map((step, i) => (
                  <div key={i} className="provenance-step">
                    <strong>{step.from_name || step.from_person_name || 'Unknown'}</strong>
                    {' → '}
                    <strong>{step.to_name || step.to_person_name || 'Unknown'}</strong>
                    {step.relationship_type && (
                      <span className="dim"> ({step.relationship_type})</span>
                    )}
                    {step.document_reference && (
                      <span className="dim"> · {step.document_reference}</span>
                    )}
                    {(step.year || step.transfer_year) && (
                      <span className="dim"> · {step.year || step.transfer_year}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      {/* Family members (parents / children) */}
      {(parents.length > 0 || children.length > 0) && (
        <Section title="Family">
          {parents.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div className="box-label" style={{ marginBottom: 6 }}>Parents</div>
              <div className="stack">
                {parents.map((m, i) => (
                  <Link
                    key={m.id || i}
                    to={`/person/${m.table_source || 'canonical_persons'}/${m.id}`}
                    className="box"
                    style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
                  >
                    <div>{m.full_name || m.name || 'Unknown'}</div>
                    <div className="dim" style={{ fontSize: 12 }}>
                      {m.birth_year && `b.${m.birth_year} `}
                      {m.death_year && `d.${m.death_year} `}
                      {m.location}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
          {children.length > 0 && (
            <div>
              <div className="box-label" style={{ marginBottom: 6 }}>Children</div>
              <div className="stack">
                {children.map((m, i) => (
                  <Link
                    key={m.id || i}
                    to={`/person/${m.table_source || 'canonical_persons'}/${m.id}`}
                    className="box"
                    style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
                  >
                    <div>{m.full_name || m.name || 'Unknown'}</div>
                    <div className="dim" style={{ fontSize: 12 }}>
                      {m.birth_year && `b.${m.birth_year} `}
                      {m.death_year && `d.${m.death_year} `}
                      {m.location}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      {enslavedPersons.length > 0 && (
        <Section title={`Enslaved persons (${enslavedPersons.length})`}>
          <div className="stack">
            {enslavedPersons.slice(0, 50).map(ep => (
              <Link
                key={ep.id}
                to={`/person/${ep.table_source || 'enslaved_individuals'}/${ep.id}`}
                className="box"
                style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
              >
                <div>{ep.full_name || ep.enslaved_name || 'Unknown'}</div>
                <div className="dim" style={{ fontSize: 12 }}>
                  {ep.birth_year && `b.${ep.birth_year} `}
                  {ep.age && `age ${ep.age} `}
                  {ep.gender}
                </div>
              </Link>
            ))}
          </div>
          {enslavedPersons.length > 50 && (
            <div className="dim" style={{ marginTop: 8 }}>
              ...and {enslavedPersons.length - 50} more.
            </div>
          )}
        </Section>
      )}

      {reparations && (
        <Section title="Reparations owed">
          <ReparationsBreakdown
            breakdown={reparations}
            enslavedCount={enslavedPersons.length || 1}
            subject={p}
          />
        </Section>
      )}

      {/* ── No-documents banner: shown when coverage says no docs exist ─── */}
      {!coverage.hasDocuments && (
        <Section title="Primary source documents">
          <div className="box" style={{ color: 'var(--dim)', fontSize: 13 }}>
            <div style={{ marginBottom: 4 }}>No primary source documents linked yet.</div>
            {coverage.source_label && (
              <div style={{ fontSize: 11 }}>
                This record was extracted from the{' '}
                <strong>{coverage.source_label}</strong>.
                Source images may not yet be digitized or linked in this database.
              </div>
            )}
          </div>
        </Section>
      )}

      {/* ── Primary source documents ─────────────────────────────────────
           If backend returned documentCollections (grouped by source), render
           collection cards with multi-page viewer support. Otherwise fall back
           to the legacy flat list of documents + ownerDocuments.
      ──────────────────────────────────────────────────────────────────── */}
      {(documentCollections.length > 0 || documents.length > 0) && (
        <Section title="Primary source documents">
          <div className="stack">
            {/* Collection cards — each card opens the full multi-page viewer */}
            {documentCollections.map((col, idx) => {
              const hasPages = col.pages && col.pages.some(pg => pg.id || pg.source_url);
              if (!hasPages) {
                // No viewable URL in any page — show metadata-only card
                return (
                  <div key={col.collection_key || idx} className="box" style={{ opacity: 0.6 }}>
                    <div>{col.collection_name || 'Primary source document'}</div>
                    <div className="dim" style={{ fontSize: 12 }}>
                      {col.doc_type}{col.page_count > 1 ? ` · ${col.page_count} pages` : ''}
                      {col.source_type_label && ` · ${col.source_type_label}`}
                    </div>
                  </div>
                );
              }
              return (
                <button
                  key={col.collection_key || idx}
                  type="button"
                  onClick={() => setViewCollection(col)}
                  className="box"
                  style={{ width: '100%', textAlign: 'left', cursor: 'pointer', color: 'inherit', background: 'none', border: '1px solid var(--border)' }}
                >
                  <div>{col.collection_name || 'Primary source document'}</div>
                  <div className="dim" style={{ fontSize: 12 }}>
                    {col.doc_type}
                    {col.page_count > 1 ? ` · ${col.page_count} pages` : ' · 1 page'}
                    {col.source_type_label && <span style={{ display: 'block', marginTop: 2, fontSize: 11 }}>{col.source_type_label}</span>}
                    <span style={{ marginLeft: 8, color: 'var(--accent, #4a9eff)' }}>↗ view</span>
                  </div>
                </button>
              );
            })}

            {/* Enslaved individual's own directly-linked documents (flat list) */}
            {documents.map((doc, idx) => {
              const docId = doc.id || doc.document_id;
              const hasS3 = !!(doc.s3_key || doc.s3_url);
              const canUseViewer = !!(docId && hasS3);
              const externalUrl = doc.source_url;

              if (canUseViewer) {
                return (
                  <button
                    key={`doc-${docId}-${idx}`}
                    type="button"
                    onClick={() => setViewDocId(docId)}
                    className="box"
                    style={{ width: '100%', textAlign: 'left', cursor: 'pointer', color: 'inherit', background: 'none', border: '1px solid var(--border)' }}
                  >
                    <div>{doc.title || doc.filename || 'Untitled document'}</div>
                    <div className="dim" style={{ fontSize: 12 }}>
                      {doc.doc_type}{doc.page_reference && ` · ${doc.page_reference}`}
                      <span style={{ marginLeft: 8, color: 'var(--accent, #4a9eff)' }}>↗ view</span>
                    </div>
                  </button>
                );
              }

              if (externalUrl) {
                let hostname = externalUrl;
                try { hostname = new URL(externalUrl).hostname; } catch (_) {}
                return (
                  <a
                    key={`ext-${idx}`}
                    href={externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="box"
                    style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
                  >
                    <div>{doc.title || doc.filename || 'Primary source document'}</div>
                    <div className="dim" style={{ fontSize: 12 }}>
                      {doc.doc_type}{doc.page_reference && ` · ${doc.page_reference}`}
                      {' · '}<span style={{ color: 'var(--accent, #4a9eff)' }}>{hostname} ↗</span>
                    </div>
                  </a>
                );
              }

              return (
                <div key={`meta-${idx}`} className="box" style={{ opacity: 0.6 }}>
                  <div>{doc.title || doc.filename || 'Document reference'}</div>
                  <div className="dim" style={{ fontSize: 12 }}>{doc.doc_type} · no file available</div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {viewDocId && (
        <DocOverlay docId={viewDocId} onClose={() => setViewDocId(null)} />
      )}
      {viewCollection && (
        <DocCollectionOverlay
          collection={viewCollection}
          onClose={() => setViewCollection(null)}
          namesToHighlight={namesToHighlight}
        />
      )}

      {descendants.length > 0 && (
        <Section title="Known descendants">
          <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>
            Cross-referenced via WikiTree and FamilySearch.
          </div>
          <div className="stack">
            {descendants.map((d, i) => (
              <div key={i} className="box">
                <div>{d.full_name || d.name}</div>
                <div className="dim" style={{ fontSize: 12 }}>
                  Generation {d.generation || '?'}
                  {d.is_living ? ' · living' : ''}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="External references">
        <div className="row-wrap">
          {links.familySearch && (
            <a href={links.familySearch} target="_blank" rel="noopener noreferrer">FamilySearch →</a>
          )}
          {links.wikiTree && (
            <a href={links.wikiTree} target="_blank" rel="noopener noreferrer">WikiTree →</a>
          )}
          {links.ancestry && (
            <a href={links.ancestry} target="_blank" rel="noopener noreferrer">Ancestry →</a>
          )}
          {p.source_url && (
            <a href={p.source_url} target="_blank" rel="noopener noreferrer">Original source →</a>
          )}
        </div>
      </Section>

      {p.notes && (
        <Section title="Notes">
          <div className="box" style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--dim)' }}>
            {p.notes}
          </div>
        </Section>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <section>
      <h2 className="upper" style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>{title}</h2>
      {children}
    </section>
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

/**
 * YearDisplay — renders a plain year string OR an estimation badge.
 * The `formatted` prop is the return value of formatYearWithEstimation().
 * If it's a plain string, render it directly.
 * If it's an object { yearStr, isEstimate, tooltip }, render a dashed
 * underline with "(est.)" label and native title tooltip.
 */
function YearDisplay({ formatted }) {
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
