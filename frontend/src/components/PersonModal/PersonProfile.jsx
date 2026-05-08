import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, isVerified } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { ReparationsBreakdown } from '../Reparations/ReparationsBreakdown.jsx';
import { DocOverlay } from '../DocumentViewer/DocumentViewer.jsx';
import { formatClass, CLASS_LABELS, CLASS_DESCRIPTIONS, formatYear } from '../../api/format.js';

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
  const descendants = data.descendants || [];
  const links = data.links || {};

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
          <Field label="Birth year" value={formatYear(p.birth_year)} />
          <Field label="Death year" value={formatYear(p.death_year)} />
          <Field label="Gender" value={p.gender} />
          <Field label="Location" value={p.location} />
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
              {owner.location} {owner.birth_year && `· b.${owner.birth_year}`}
            </div>
          </Link>
        </Section>
      )}

      {enslavedPersons.length > 0 && (
        <Section title={`Enslaved persons (${enslavedPersons.length})`}>
          <div className="stack">
            {enslavedPersons.slice(0, 50).map(ep => (
              <Link
                key={ep.id}
                to={`/person/enslaved_individuals/${ep.id}`}
                className="box"
                style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
              >
                <div>{ep.full_name}</div>
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

      {(documents.length > 0 || ownerDocuments.length > 0) && (
        <Section title="Primary source documents">
          <div className="stack">
            {[...documents, ...ownerDocuments].map((doc, idx) => {
              const docId = doc.id || doc.document_id;
              // A document is viewable in the inline viewer only if it has
              // a real document DB id AND either an s3_key or s3_url.
              // Everything else (source_url only, external PDFs) opens
              // directly in a new tab — no viewer wrapper needed.
              const hasS3 = !!(doc.s3_key || doc.s3_url);
              const canUseViewer = !!(docId && hasS3);
              const externalUrl = doc.source_url;

              if (canUseViewer) {
                return (
                  <button
                    key={`${docId}-${idx}`}
                    type="button"
                    onClick={() => setViewDocId(docId)}
                    className="box"
                    style={{ textDecoration: 'none', color: 'inherit', display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer' }}
                  >
                    <div>{doc.title || doc.filename || 'Untitled document'}</div>
                    <div className="dim" style={{ fontSize: 12 }}>
                      {doc.doc_type}{doc.page_reference && ` · ${doc.page_reference}`}
                      <span style={{ marginLeft: 8, color: 'var(--dim)' }}>↗ view fullscreen</span>
                    </div>
                  </button>
                );
              }

              if (externalUrl) {
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
                      {' · '}<span style={{ color: 'var(--accent, #4a9eff)' }}>
                        {new URL(externalUrl).hostname} ↗
                      </span>
                    </div>
                  </a>
                );
              }

              // No usable URL at all — show as metadata only
              return (
                <div key={`meta-${idx}`} className="box" style={{ opacity: 0.6 }}>
                  <div>{doc.title || doc.filename || 'Document reference'}</div>
                  <div className="dim" style={{ fontSize: 12 }}>
                    {doc.doc_type} · no file available
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {viewDocId && (
        <DocOverlay docId={viewDocId} onClose={() => setViewDocId(null)} />
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
