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
          <Field label="Spouse" value={
            spouseFromFamily
              ? (spouseFromFamily.id
                  ? <Link to={`/person/${spouseFromFamily.table_source || 'canonical_persons'}/${spouseFromFamily.id}`}>{spouseFromFamily.full_name || spouseFromFamily.name}</Link>
                  : (spouseFromFamily.full_name || spouseFromFamily.name))
              : p.spouse_name
          } />
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
          margin: '12px 0', padding: 12, borderLeft: '3px solid #d97706',
          background: 'rgba(217, 119, 6, 0.08)', fontSize: 13,
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
      {(() => {
        if (documentCollections.length === 0 && documents.length === 0) return null;

        const isCollPrimary = (col) => (col.pages || []).some((p) => p?.evidence_strength === 'direct_primary');
        const isDocPrimary  = (d) => d?.evidence_strength === 'direct_primary';
        const primaryColls   = documentCollections.filter(isCollPrimary);
        const secondaryColls = documentCollections.filter((c) => !isCollPrimary(c));
        const primaryDocs    = documents.filter(isDocPrimary);
        const secondaryDocs  = documents.filter((d) => !isDocPrimary(d));

        const renderCollCard = (col, idx) => {
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
        };
        const renderDocCard = (doc, idx) => {
          const docId = doc.id || doc.document_id;
          const hasS3 = !!(doc.s3_key || doc.s3_url);
          const canUseViewer = !!(docId && hasS3);
          const externalUrl = doc.source_url;
          // Detect whether this doc comes from person_documents (integer id)
          // vs the documents table (UUID string). person_documents rows must be
          // opened via DocCollectionOverlay → getPersonDocAccess so the backend
          // generates a presigned S3 URL from s3_key. Using DocOverlay for these
          // returns 404 (that endpoint queries the separate documents table).
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
                <div>{doc.title || doc.filename || 'Source document'}</div>
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
        };

        return (
          <>
            {(primaryColls.length > 0 || primaryDocs.length > 0) && (
              <Section title="Primary source documents">
                <div className="stack">
                  {primaryColls.map(renderCollCard)}
                  {primaryDocs.map(renderDocCard)}
                </div>
              </Section>
            )}
            {(secondaryColls.length > 0 || secondaryDocs.length > 0) && (
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
          </>
        );
      })()}

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
