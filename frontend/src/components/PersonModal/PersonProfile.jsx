import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, isVerified } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { ReparationsBreakdown } from '../Reparations/ReparationsBreakdown.jsx';
import { DocOverlay, DocCollectionOverlay } from '../DocumentViewer/DocumentViewer.jsx';
import { RecordDetail, Field, Section } from '../ui/index.jsx';
import { PERSON_FIELDS } from '../../api/fieldRegistry.js';
import {
  formatClass,
  CLASS_LABELS,
  CLASS_DESCRIPTIONS,
  formatYear,
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

  // External-assertion gate (M102): the backend returns a name-only STUB ({gated:true, gatedMessage})
  // for a canonical person with no stored proposition-specific document. Show the explanatory note —
  // we make NO slaveholder/enslaved claim. (Admin/research callers get full data and never hit this.)
  if (data.gated || data.person.gated) {
    return (
      <div className="stack-xl">
        <header>
          <h1 style={{ fontSize: 22, fontWeight: 'normal' }}>{data.person.full_name || data.person.name || 'Unknown'}</h1>
        </header>
        <div className="state">
          {data.gatedMessage || 'A record exists for this name, but we cannot publicly state whether this person was a slaveholder or was enslaved until a qualifying primary-source document is archived.'}
        </div>
      </div>
    );
  }

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
  const forensicEstate = data.forensicEstate || null;

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

  // Spouse is a bespoke field (comes from the family graph, links to the person)
  // that the registry can't express — passed to RecordDetail as an `extra`.
  const spouseNode = spouseFromFamily
    ? (spouseFromFamily.id
        ? <Link to={`/person/${spouseFromFamily.table_source || 'canonical_persons'}/${spouseFromFamily.id}`}>{spouseFromFamily.full_name || spouseFromFamily.name}</Link>
        : (spouseFromFamily.full_name || spouseFromFamily.name))
    : (p.spouse_name || null);

  // ── Source documents ────────────────────────────────────────────────────────
  // Group into PRIMARY (an original scan/record image) vs SECONDARY (indexed,
  // transcribed, republished, or database-derived). Hoisted out of the render so
  // the primary scan can sit HIGH on the page (objective c: primary sources up),
  // above the derived commentary, while the full list stays below.
  const isCollPrimary = (col) => (col.pages || []).some((pg) => pg?.evidence_strength === 'direct_primary');
  const isDocPrimary  = (d) => d?.evidence_strength === 'direct_primary';
  const primaryColls   = documentCollections.filter(isCollPrimary);
  const secondaryColls = documentCollections.filter((c) => !isCollPrimary(c));
  const primaryDocs    = documents.filter(isDocPrimary);
  const secondaryDocs  = documents.filter((d) => !isDocPrimary(d));
  const hasPrimaryDocs = primaryColls.length > 0 || primaryDocs.length > 0;
  const hasSecondaryDocs = secondaryColls.length > 0 || secondaryDocs.length > 0;

  const renderCollCard = (col, idx) => {
    const hasPages = col.pages && col.pages.some(pg => pg.id || pg.source_url);
    if (!hasPages) {
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
          <span style={{ marginLeft: 8, color: 'var(--accent)' }}>↗ view</span>
        </div>
      </button>
    );
  };
  const renderDocCard = (doc, idx) => {
    const docId = doc.id || doc.document_id;
    const hasS3 = !!(doc.s3_key || doc.s3_url);
    const canUseViewer = !!(docId && hasS3);
    const externalUrl = doc.source_url;
    const isPdRow = hasS3 && docId != null &&
      (typeof docId === 'number' || /^\d+$/.test(String(docId)));

    if (canUseViewer) {
      const handleClick = isPdRow
        ? () => setViewCollection({
            collection_name: doc.title || doc.filename || 'Source document',
            source_type_label: doc.doc_type || '',
            doc_type: doc.doc_type || 'will',
            pages: [{
              id: docId,
              filename: doc.filename,
              title: doc.title || doc.filename,
              ocr_text: doc.ocr_text || null,
              source_url: null,
            }],
          })
        : () => setViewDocId(docId);
      return (
        <button
          key={`doc-${docId}-${idx}`}
          type="button"
          onClick={handleClick}
          className="box"
          style={{ width: '100%', textAlign: 'left', cursor: 'pointer', color: 'inherit', background: 'none', border: '1px solid var(--border)' }}
        >
          <div>{doc.title || doc.filename || 'Untitled document'}</div>
          <div className="dim" style={{ fontSize: 12 }}>
            {doc.doc_type}{doc.page_reference && ` · ${doc.page_reference}`}
            <span style={{ marginLeft: 8, color: 'var(--accent)' }}>↗ view</span>
          </div>
        </button>
      );
    }
    if (externalUrl) {
      let host = externalUrl;
      try { host = new URL(externalUrl).hostname; } catch (_) {}
      return (
        <a
          key={`ext-${idx}`}
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="box"
          style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
        >
          <div>{doc.title || doc.filename || 'Source document'}</div>
          <div className="dim" style={{ fontSize: 12 }}>
            {doc.doc_type}{doc.page_reference && ` · ${doc.page_reference}`}
            {' · '}<span style={{ color: 'var(--accent)' }}>{host} ↗</span>
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
  };

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
            {/* Ground the person-modal flow in RAG (RULE 0.5): ask a question about
                this person, answered from the source documents with citations. */}
            {(p.full_name || p.name) && (
              <div style={{ marginTop: 8 }}>
                <Link to={`/ask?q=${encodeURIComponent(p.full_name || p.name)}`} style={{ fontSize: 'var(--fs-sm)' }}>
                  Ask the archive about {p.full_name || p.name} ↗
                </Link>
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
        {/* Schema-driven: fields come from PERSON_FIELDS (api/fieldRegistry.js),
            rendered by priority with progressive disclosure. Adding a new column
            to the profile is a one-line registry entry — no change here. */}
        <RecordDetail
          record={p}
          fields={PERSON_FIELDS}
          columns={3}
          visibleCount={9}
          extras={[
            { label: 'Spouse', priority: 66, present: !!spouseNode, node: spouseNode },
            { label: 'Source table', priority: 20, present: !!tableSource, node: tableSource },
          ]}
        />
      </Section>

      {/* Primary source high on the page: the original scan this profile rests on,
          above the derived/secondary commentary (objective c). Tap to open the
          zoomable viewer. The full document list (incl. secondary) stays below. */}
      {hasPrimaryDocs && (
        <Section title="Primary source">
          <div className="dim" style={{ fontSize: 11, marginBottom: 6 }}>
            The original record image this profile rests on. Tap to open the scan in a zoomable viewer.
          </div>
          <div className="stack">
            {primaryColls.map(renderCollCard)}
            {primaryDocs.map(renderDocCard)}
          </div>
        </Section>
      )}

      {Array.isArray(p.facts) && p.facts.length > 0 && (() => {
        const plantations = p.facts.filter((f) => f.fact_type === 'plantation');
        // Facts already surfaced in the Identity grid — don't repeat them here.
        const shownInIdentity = ['birth', 'death', 'occupation', 'spouse', 'plantation'];
        const record = p.facts.filter((f) => !shownInIdentity.includes(f.fact_type));
        const needsPrimary = (f) => f.verification_status === 'needs_primary';
        return (
          <>
            {plantations.length > 0 && (
              <Section title={`Plantations & Holdings (${plantations.length})`}>
                <div className="grid-3">
                  {plantations.map((f, i) => (
                    <div key={i} className="box" style={{ padding: 8 }}>
                      <div style={{ fontWeight: 600 }}>{f.value_text}</div>
                      <div className="dim" style={{ fontSize: 11, marginTop: 3 }}>
                        <span style={{ color: needsPrimary(f) ? 'var(--flag)' : 'var(--seal)' }}>
                          {needsPrimary(f) ? '○ needs primary' : '● primary-corroborated'}
                        </span>
                      </div>
                      {f.source_citation && (
                        <div className="dim" style={{ fontSize: 10, marginTop: 3 }}>{f.source_citation}</div>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}
            {record.length > 0 && (
              <Section title="Documented record">
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {record.map((f, i) => (
                    <li key={i} style={{ marginBottom: 4 }}>
                      <span className="dim" style={{ fontSize: 11 }}>{formatClass(f.fact_type)}:</span>{' '}
                      {f.value_text}
                      {needsPrimary(f) && (
                        <span className="dim" style={{ fontSize: 10 }}> (needs primary)</span>
                      )}
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </>
        );
      })()}

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

      {forensicEstate && (
        <Section title="Forensic estate accounting">
          {(() => {
            const usd = (n) => (n == null ? null : '$' + Number(n).toLocaleString());
            const t = forensicEstate.totals || {};
            const fe = forensicEstate;
            const hasTotals = t.total_appraised_value_usd != null || t.enslaved_value_usd != null || t.non_chattel_value_usd != null;
            return (
              <div className="stack">
                <div className="dim" style={{ fontSize: 12 }}>
                  Extracted from {fe.document_type || 'probate document'}
                  {fe.document_year ? ` (${fe.document_year})` : ''} · {fe.extractor_version}
                </div>

                {hasTotals && (
                  <div className="box">
                    <div style={{ fontWeight: 'bold', marginBottom: 4 }}>Estate totals</div>
                    {t.total_appraised_value_usd != null && <div>Total appraised value: {usd(t.total_appraised_value_usd)}</div>}
                    {t.enslaved_value_usd != null && <div>Value attributed to enslaved people: {usd(t.enslaved_value_usd)}</div>}
                    {t.non_chattel_value_usd != null && <div>Non-chattel value: {usd(t.non_chattel_value_usd)}</div>}
                  </div>
                )}

                {fe.enslaved_persons.length > 0 && (
                  <div className="box">
                    <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
                      Enslaved people named ({fe.enslaved_persons.length})
                    </div>
                    {fe.enslaved_persons.slice(0, 60).map((e, i) => (
                      <div key={i} className="dim" style={{ fontSize: 13 }}>
                        {e.name || '(unnamed)'}
                        {e.age != null && ` · age ${e.age}`}
                        {e.appraised_value_usd != null && ` · ${usd(e.appraised_value_usd)}`}
                        {e.kin_relation && ` · ${e.kin_relation}`}
                      </div>
                    ))}
                  </div>
                )}

                {fe.heirs.length > 0 && (
                  <div className="box">
                    <div style={{ fontWeight: 'bold', marginBottom: 4 }}>Heirs &amp; bequests ({fe.heirs.length})</div>
                    {fe.heirs.map((h, i) => (
                      <div key={i} className="dim" style={{ fontSize: 13 }}>
                        {h.name}{h.relation && ` (${h.relation})`}{h.bequest && ` — ${h.bequest}`}
                      </div>
                    ))}
                  </div>
                )}

                {fe.non_chattel_assets.length > 0 && (
                  <div className="box">
                    <div style={{ fontWeight: 'bold', marginBottom: 4 }}>Non-chattel assets ({fe.non_chattel_assets.length})</div>
                    {fe.non_chattel_assets.slice(0, 40).map((a, i) => (
                      <div key={i} className="dim" style={{ fontSize: 13 }}>
                        {a.description}{a.category && ` [${a.category}]`}{a.quantity && ` · ${a.quantity}`}{a.value_usd != null && ` · ${usd(a.value_usd)}`}
                      </div>
                    ))}
                  </div>
                )}

                {fe.liabilities.length > 0 && (
                  <div className="box">
                    <div style={{ fontWeight: 'bold', marginBottom: 4 }}>Liabilities ({fe.liabilities.length})</div>
                    {fe.liabilities.map((l, i) => (
                      <div key={i} className="dim" style={{ fontSize: 13 }}>
                        {l.description}{l.creditor && ` · ${l.creditor}`}{l.amount_usd != null && ` · ${usd(l.amount_usd)}`}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
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
        <Section title="Source documents">
          <div className="box" style={{ color: 'var(--dim)', fontSize: 13 }}>
            <div style={{ marginBottom: 4 }}>No source documents linked yet.</div>
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

      {/* "Primary documentation still needed" banner — fires when the person
           has documents but none of them are direct_primary (the linked
           sources are all secondary/indexed). Surfacing this is the project's
           research-priority signal. */}
      {coverage.hasDocuments && coverage.hasPrimarySource === false && (
        <div className="box" style={{
          margin: '12px 0', padding: 12, borderLeft: '3px solid var(--flag)',
          background: 'rgba(122, 93, 16, 0.08)', fontSize: 13,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>⚠ Primary documentation still needed</div>
          <div className="dim" style={{ fontSize: 11 }}>
            Every linked source on this profile is a secondary citation
            (indexed transcript, published compilation, or database entry).
            An original document — scanned will, deed, slave-schedule scan,
            or other archival record — has not yet been linked.
          </div>
        </div>
      )}

      {/* ── Source documents, split by evidence tier ──────────────────────
           Primary = direct_primary (an original record image / scan).
           Secondary = indirect_primary, secondary_published, secondary_database,
           tertiary_aggregate, unverified — any citation that is not itself
           an original. A collection counts as primary if any of its pages is
           direct_primary.
      ──────────────────────────────────────────────────────────────────── */}
      {/* Secondary source documents stay LOW — indexed/transcribed/republished
          citations that a record exists, not the original scan (which is up top). */}
      {hasSecondaryDocs && (
        <Section title="Secondary source documents">
          <div className="dim" style={{ fontSize: 11, marginBottom: 6 }}>
            Indexed, transcribed, republished or database-derived citations.
            These document that a record exists; they are not the original.
          </div>
          <div className="stack">
            {secondaryColls.map(renderCollCard)}
            {secondaryDocs.map(renderDocCard)}
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
// Field and Section now come from components/ui (shared primitives).

// YearDisplay moved into the schema-driven renderer (components/ui RecordDetail):
// year fields with format 'yearEstimate' now render the estimation badge there.
