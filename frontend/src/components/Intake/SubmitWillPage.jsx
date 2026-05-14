/**
 * SubmitWillPage — public-facing archival document ingestion.
 *
 * No admin token required. Anyone can upload an archival PDF.
 * Supports multiple document types — will, case register, deed,
 * estate inventory, other — with context-appropriate form fields
 * for each type.
 *
 * Route: /contribute/will  (see App.jsx)
 *
 * Disambiguation: when multiple canonical_persons share the testator
 * name (wills only), the success screen fetches candidates via
 * GET /api/wills/candidates and lets the uploader select the correct
 * one via POST /api/wills/link.
 *
 * Session 53 — May 2026: added documentType selector; context-aware
 * fields for case registers (Hynson DC runaway/fugitive books):
 * documentTitle, eraStart, eraEnd, compiledBy. Will fields unchanged.
 */

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import ErrorBoundary from './ErrorBoundary';

const BACKEND = import.meta.env.VITE_API_URL || '';
const BACKEND_ROOT = BACKEND ? BACKEND.replace(/\/api$/, '') : '';

// ── Document type definitions ──────────────────────────────────────────────────
const DOC_TYPES = [
  {
    value: 'will',
    label: 'Will / Probate Record',
    description: 'Testamentary document, codicil, or probate filing naming an individual testator.',
  },
  {
    value: 'case_register',
    label: 'Case Register (runaway / fugitive cases)',
    description: 'Compiled register of custody events — e.g. Hynson DC Runaway & Fugitive Slave Cases. ' +
      'A secondary compilation of handwritten court records. Evidence tier: Tier C (secondary) pending ' +
      'original verification at NARA.',
  },
  {
    value: 'deed',
    label: 'Deed / Land Record',
    description: 'Property transfer, bill of sale, mortgage, or manumission deed.',
  },
  {
    value: 'estate_inventory',
    label: 'Estate Inventory',
    description: 'Inventory of estate assets — personal property, enslaved persons, livestock, goods.',
  },
  {
    value: 'other',
    label: 'Other Archival Document',
    description: 'Newspaper, letter, church record, or any document not covered above.',
  },
];

async function ingestDocument(formData) {
  const res = await fetch(`${BACKEND}/api/wills/ingest`, {
    method: 'POST',
    body: formData,
  });
  const data = await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }));
  if (!res.ok || !data.success) {
    throw new Error(data.error || `Upload failed (${res.status})`);
  }
  return data;
}

async function fetchCandidates(name) {
  const res = await fetch(
    `${BACKEND}/api/wills/candidates?name=${encodeURIComponent(name)}`,
    { headers: { Accept: 'application/json' } }
  );
  const data = await res.json().catch(() => ({ success: false, candidates: [] }));
  return data.candidates || [];
}

async function linkDocument(personDocId, canonicalPersonId, extractionId) {
  const res = await fetch(`${BACKEND}/api/wills/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ personDocId, canonicalPersonId, extractionId }),
  });
  const data = await res.json().catch(() => ({ success: false }));
  if (!res.ok || !data.success) {
    throw new Error(data.error || `Link failed (${res.status})`);
  }
  return data;
}

// ── Disambiguation panel (wills only) ─────────────────────────────────────────
function DisambiguationPanel({ testatorName, personDocId, extractionId, onLinked }) {
  const [candidates, setCandidates] = useState(null);
  const [selected, setSelected]     = useState(null);
  const [linking, setLinking]       = useState(false);
  const [linkError, setLinkError]   = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchCandidates(testatorName).then(c => {
      if (!cancelled) setCandidates(c);
    }).catch(() => {
      if (!cancelled) setCandidates([]);
    });
    return () => { cancelled = true; };
  }, [testatorName]);

  const handleLink = async () => {
    if (!selected) return;
    setLinking(true);
    setLinkError('');
    try {
      const result = await linkDocument(personDocId, selected.id, extractionId);
      onLinked(result.linkedTo);
    } catch (err) {
      setLinkError(err.message);
      setLinking(false);
    }
  };

  const cardStyle = (isSelected) => ({
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '0.65rem 0.85rem',
    marginBottom: '0.4rem',
    border: `1px solid ${isSelected ? 'rgba(0,200,100,0.5)' : 'rgba(255,255,255,0.1)'}`,
    borderRadius: 4,
    background: isSelected ? 'rgba(0,200,100,0.07)' : 'rgba(255,255,255,0.02)',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '0.83rem',
    transition: 'border-color 0.1s, background 0.1s',
  });

  return (
    <div style={{
      marginTop: '1.25rem',
      padding: '1rem',
      background: 'rgba(245,166,35,0.06)',
      border: '1px solid rgba(245,166,35,0.3)',
      borderRadius: 4,
      fontFamily: 'monospace',
    }}>
      <div style={{ color: '#f5a623', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
        ⚠ Multiple persons named &ldquo;{testatorName}&rdquo; exist in the database.
        Select the correct one to file this document now — or skip and a researcher will link it later.
      </div>

      {candidates === null && (
        <div style={{ color: '#888', fontSize: '0.8rem' }}>Loading candidates…</div>
      )}

      {candidates !== null && candidates.length === 0 && (
        <div style={{ color: '#888', fontSize: '0.8rem' }}>
          No candidates found. Document stored — will be linked when the person is added.
        </div>
      )}

      {candidates !== null && candidates.length > 0 && (
        <>
          <div style={{ fontSize: '0.78rem', color: '#888', marginBottom: '0.5rem' }}>
            Click a record to select it, then click Link:
          </div>
          {candidates.map(c => {
            const isSelected = selected?.id === c.id;
            const locationParts = [c.primary_plantation, c.primary_county, c.primary_state].filter(Boolean);
            const yearParts = [
              c.birth_year ? `b.${c.birth_year}` : null,
              c.death_year ? `d.${c.death_year}` : null,
            ].filter(Boolean);
            return (
              <div
                key={c.id}
                style={cardStyle(isSelected)}
                onClick={() => setSelected(isSelected ? null : c)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && setSelected(isSelected ? null : c)}
              >
                <div style={{ fontWeight: 600, color: isSelected ? '#4caf50' : '#e0e0e0' }}>
                  {isSelected ? '✓ ' : ''}{c.canonical_name}
                </div>
                <div style={{ color: '#888', fontSize: '0.75rem' }}>
                  {c.person_type}
                  {yearParts.length > 0 ? ' · ' + yearParts.join(' · ') : ''}
                  {locationParts.length > 0 ? ' · ' + locationParts.join(', ') : ''}
                  {' · '}id={c.id}
                </div>
                {c.notes && (
                  <div style={{ color: '#666', fontSize: '0.72rem', marginTop: 2 }}>
                    {c.notes.slice(0, 120)}{c.notes.length > 120 ? '…' : ''}
                  </div>
                )}
              </div>
            );
          })}

          {linkError && (
            <div style={{ color: '#ef4444', fontSize: '0.8rem', marginTop: '0.5rem' }}>
              ✗ {linkError}
            </div>
          )}

          <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button
              className="btn"
              disabled={!selected || linking}
              onClick={handleLink}
              style={{ opacity: selected ? 1 : 0.5 }}
            >
              {linking ? 'Linking…' : selected ? `Link to ${selected.canonical_name}` : 'Select a person above'}
            </button>
            <span style={{ color: '#555', fontSize: '0.78rem' }}>
              or leave it — a researcher will link it later
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ── Input field helper ─────────────────────────────────────────────────────────
function Field({ label, hint, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontFamily: 'monospace', fontSize: '0.8rem', color: '#888', marginBottom: 4 }}>
        {label}
      </label>
      {hint && (
        <div style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#555', marginBottom: 6 }}>
          {hint}
        </div>
      )}
      {children}
    </div>
  );
}

// ── Main page component ────────────────────────────────────────────────────────
export default function SubmitWillPage() {
  // ── Shared state ─────────────────────────────────────────────────────────────
  const [file, setFile]             = useState(null);
  const [docType, setDocType]       = useState('will');
  const [archiveSource, setArchive] = useState('');

  // ── Will-specific state ───────────────────────────────────────────────────────
  const [testatorName, setTestatorName]       = useState('');
  const [testatorYear, setTestatorYear]       = useState('');
  const [testatorLocation, setTestatorLoc]   = useState('');

  // ── Register-specific state ───────────────────────────────────────────────────
  const [documentTitle, setDocTitle]   = useState('');
  const [eraStart, setEraStart]         = useState('');
  const [eraEnd, setEraEnd]             = useState('');
  const [compiledBy, setCompiledBy]     = useState('');

  // ── UI state ──────────────────────────────────────────────────────────────────
  const [status, setStatus] = useState('idle'); // idle | uploading | done | error
  const [result, setResult] = useState(null);
  const [error, setError]   = useState('');
  const [manualLinked, setManualLinked] = useState(null);

  const selectedTypeDef = DOC_TYPES.find(t => t.value === docType) || DOC_TYPES[0];

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;

    setStatus('uploading');
    setError('');

    const fd = new FormData();
    fd.append('willPdf', file);
    fd.append('documentType', docType);
    if (archiveSource) fd.append('archiveSource', archiveSource);

    if (docType === 'will') {
      if (testatorName)     fd.append('testatorName', testatorName);
      if (testatorYear)     fd.append('testatorYear', testatorYear);
      if (testatorLocation) fd.append('testatorLocation', testatorLocation);
    } else if (docType === 'case_register') {
      if (documentTitle) fd.append('documentTitle', documentTitle);
      if (eraStart)      fd.append('eraStart', eraStart);
      if (eraEnd)        fd.append('eraEnd', eraEnd);
      if (compiledBy)    fd.append('compiledBy', compiledBy);
    } else {
      if (documentTitle || testatorName) fd.append('documentTitle', documentTitle || testatorName);
      if (testatorYear) fd.append('testatorYear', testatorYear);
      if (testatorLocation) fd.append('testatorLocation', testatorLocation);
    }

    try {
      const data = await ingestDocument(fd);
      setResult(data);
      setStatus('done');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  };

  const reset = () => {
    setFile(null);
    setDocType('will');
    setArchive('');
    setTestatorName('');
    setTestatorYear('');
    setTestatorLoc('');
    setDocTitle('');
    setEraStart('');
    setEraEnd('');
    setCompiledBy('');
    setStatus('idle');
    setResult(null);
    setError('');
    setManualLinked(null);
  };

  // ── Success screen ─────────────────────────────────────────────────────────────
  if (status === 'done' && result) {
    const matched   = manualLinked || result.matchedPerson;
    const ambiguous = result.matchAmbiguous && !manualLinked;
    const isRegister = result.docType === 'case_register';

    return (
      <ErrorBoundary>
        <div className="page">
          <div className="state ok">✓ Document uploaded successfully</div>

          {/* ── Linkage banner (wills only) ── */}
          {!isRegister && matched && matched.created ? (
            <div style={{
              marginTop: '1.25rem',
              padding: '0.75rem 1rem',
              background: 'rgba(0,200,100,0.08)',
              border: '1px solid rgba(0,200,100,0.25)',
              borderRadius: 4,
              fontFamily: 'monospace',
              fontSize: '0.85rem',
            }}>
              <div style={{ color: '#4caf50', marginBottom: '0.35rem' }}>
                ✓ Profile created for{' '}
                <Link
                  to={`/?id=${matched.id}&table=canonical_persons`}
                  style={{ color: '#80cbc4', textDecoration: 'underline' }}
                >
                  {matched.canonical_name}
                </Link>
              </div>
              <div style={{ color: '#888', fontSize: '0.78rem' }}>
                The will and testator profile are now in the database, pending source
                verification by a researcher. You can search for this person by name.
              </div>
            </div>
          ) : !isRegister && matched ? (
            <div style={{
              marginTop: '1.25rem',
              padding: '0.75rem 1rem',
              background: 'rgba(0,200,100,0.08)',
              border: '1px solid rgba(0,200,100,0.25)',
              borderRadius: 4,
              fontFamily: 'monospace',
              fontSize: '0.85rem',
            }}>
              <span style={{ color: '#4caf50' }}>✓ Linked to existing profile: </span>
              <Link
                to={`/?id=${matched.id}&table=canonical_persons`}
                style={{ color: '#80cbc4', textDecoration: 'underline' }}
              >
                {matched.canonical_name}
              </Link>
              <span style={{ color: '#888' }}> — document now visible on their profile</span>
            </div>
          ) : !isRegister && ambiguous ? (
            <DisambiguationPanel
              testatorName={testatorName}
              personDocId={result.personDocId}
              extractionId={result.extractionId}
              onLinked={(person) => setManualLinked(person)}
            />
          ) : !isRegister && testatorName ? (
            <div style={{
              marginTop: '1.25rem',
              padding: '0.75rem 1rem',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 4,
              fontFamily: 'monospace',
              fontSize: '0.85rem',
              color: '#888',
            }}>
              ℹ Document stored and queued for review. A researcher will create or link the
              testator profile for &ldquo;{testatorName}&rdquo;.
            </div>
          ) : null}

          {/* ── Register-specific status note ── */}
          {isRegister && (
            <div style={{
              marginTop: '1.25rem',
              padding: '0.75rem 1rem',
              background: 'rgba(128,203,196,0.07)',
              border: '1px solid rgba(128,203,196,0.25)',
              borderRadius: 4,
              fontFamily: 'monospace',
              fontSize: '0.85rem',
            }}>
              <div style={{ color: '#80cbc4', marginBottom: '0.4rem' }}>
                ✓ Case register stored in S3 — evidence tier: Tier C (secondary compilation)
              </div>
              <div style={{ color: '#666', fontSize: '0.78rem' }}>
                Originals are handwritten court records at NARA RG 21. This PDF is a
                Heritage Books printed compilation. OCR + case extraction must be run
                separately via the scripts listed below. Tier upgrades to Tier B only
                after original NARA records are independently verified.
              </div>
            </div>
          )}

          {/* ── Technical details + next steps ── */}
          <div className="contribute-result" style={{ marginTop: '1.5rem', fontFamily: 'monospace', fontSize: '0.85rem' }}>
            {result.s3Key && (
              <div style={{ marginBottom: '0.5rem' }}>
                <span style={{ color: '#888' }}>S3 key: </span>
                <code style={{ color: '#e0e0e0' }}>{result.s3Key}</code>
              </div>
            )}
            {result.personDocId && (
              <div style={{ marginBottom: '0.5rem' }}>
                <span style={{ color: '#888' }}>person_documents.id: </span>
                <code style={{ color: '#e0e0e0' }}>{result.personDocId}</code>
              </div>
            )}
            {result.extractionId && (
              <div style={{ marginBottom: '0.5rem' }}>
                <span style={{ color: '#888' }}>will_extractions.id: </span>
                <code style={{ color: '#e0e0e0' }}>{result.extractionId}</code>
              </div>
            )}
            {result.warning && (
              <div style={{ color: '#f5a623', marginTop: '0.75rem' }}>⚠ {result.warning}</div>
            )}
            {/* Show pipeline next-steps only for non-will types (case registers, deeds, etc.)
                where a researcher needs to know which scripts to run.
                For wills, the pipeline is fully automated — no contributor action needed. */}
            {isRegister && Array.isArray(result.nextSteps) && result.nextSteps.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ color: '#888', fontSize: '0.78rem', marginBottom: '0.4rem' }}>PIPELINE STEPS (admin):</div>
                <ul style={{ paddingLeft: '1.2rem', color: '#aaa', lineHeight: 2, margin: 0 }}>
                  {result.nextSteps.map((s, i) => <li key={i}><code style={{ fontSize: '0.78rem' }}>{s}</code></li>)}
                </ul>
              </div>
            )}
          </div>

          <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <button className="btn" onClick={reset}>Submit another document</button>
            <Link to="/" className="btn" style={{ textDecoration: 'none' }}>← Back to search</Link>
            <a
              href={`${BACKEND_ROOT}/review?queue=wills`}
              className="btn"
              style={{ textDecoration: 'none', opacity: 0.7 }}
              title="Review all unlinked documents"
            >
              ⟐ Document Review Queue
            </a>
          </div>
        </div>
      </ErrorBoundary>
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────────────
  return (
    <ErrorBoundary>
      <div className="page">
        <h2 style={{ fontFamily: 'monospace', marginBottom: '0.5rem' }}>
          Submit Archival Document
        </h2>
        <p style={{ color: '#888', fontFamily: 'monospace', fontSize: '0.85rem', marginBottom: '2rem', maxWidth: 540 }}>
          Upload a will, probate record, case register, deed, or estate inventory from an archive.
          PDF, JPEG, or PNG stored in S3 and queued for OCR extraction — no account required.
        </p>

        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem', maxWidth: 520 }}
        >
          {/* ── Document type selector ── */}
          <Field
            label="DOCUMENT TYPE *"
            hint="Select the type that best describes this archival document."
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {DOC_TYPES.map(t => (
                <label
                  key={t.value}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.6rem',
                    cursor: 'pointer',
                    padding: '0.5rem 0.7rem',
                    border: `1px solid ${docType === t.value ? 'rgba(128,203,196,0.4)' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: 4,
                    background: docType === t.value ? 'rgba(128,203,196,0.06)' : 'transparent',
                    transition: 'border-color 0.1s, background 0.1s',
                  }}
                >
                  <input
                    type="radio"
                    name="docType"
                    value={t.value}
                    checked={docType === t.value}
                    onChange={() => setDocType(t.value)}
                    style={{ marginTop: 2, flexShrink: 0 }}
                  />
                  <div>
                    <div style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: docType === t.value ? '#80cbc4' : '#e0e0e0' }}>
                      {t.label}
                    </div>
                    <div style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#555', marginTop: 2 }}>
                      {t.description}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </Field>

          {/* ── File input ── */}
          <Field label="DOCUMENT FILE *" hint="PDF, JPEG, or PNG. Max 75 MB.">
            <input
              type="file"
              accept=".pdf,application/pdf,.jpg,.jpeg,image/jpeg,.png,image/png"
              required
              onChange={e => setFile(e.target.files[0] || null)}
              style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: '#e0e0e0', width: '100%' }}
            />
            {file && (
              <div style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#888', marginTop: 4 }}>
                {file.name} — {(file.size / 1024 / 1024).toFixed(1)} MB
              </div>
            )}
          </Field>

          {/* ── Will-specific fields ── */}
          {docType === 'will' && (
            <>
              <Field label="TESTATOR NAME" hint="Full name of the person who wrote the will.">
                <input
                  type="text"
                  className="search-input"
                  placeholder="e.g. Henry Weaver"
                  value={testatorName}
                  onChange={e => setTestatorName(e.target.value)}
                />
              </Field>
              <Field label="YEAR OF WILL / PROBATE">
                <input
                  type="text"
                  className="search-input"
                  placeholder="e.g. 1847"
                  value={testatorYear}
                  onChange={e => setTestatorYear(e.target.value)}
                />
              </Field>
              <Field label="LOCATION (county, state)">
                <input
                  type="text"
                  className="search-input"
                  placeholder="e.g. Washington DC"
                  value={testatorLocation}
                  onChange={e => setTestatorLoc(e.target.value)}
                />
              </Field>
            </>
          )}

          {/* ── Case register fields ── */}
          {docType === 'case_register' && (
            <>
              <Field
                label="DOCUMENT TITLE"
                hint="Full title of the book or register. E.g. 'District of Columbia Runaway and Fugitive Slave Cases, 1848-1863'"
              >
                <input
                  type="text"
                  className="search-input"
                  placeholder="e.g. District of Columbia Runaway and Fugitive Slave Cases, 1848-1863"
                  value={documentTitle}
                  onChange={e => setDocTitle(e.target.value)}
                />
              </Field>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <Field label="ERA START YEAR">
                  <input
                    type="text"
                    className="search-input"
                    placeholder="1848"
                    value={eraStart}
                    onChange={e => setEraStart(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </Field>
                <Field label="ERA END YEAR">
                  <input
                    type="text"
                    className="search-input"
                    placeholder="1863"
                    value={eraEnd}
                    onChange={e => setEraEnd(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </Field>
              </div>
              <Field
                label="COMPILED BY"
                hint="Compiler and publisher. E.g. 'Hynson, Jerry M., Heritage Books Inc., 1999'"
              >
                <input
                  type="text"
                  className="search-input"
                  placeholder="e.g. Hynson, Jerry M., Heritage Books Inc., 1999"
                  value={compiledBy}
                  onChange={e => setCompiledBy(e.target.value)}
                />
              </Field>
              <div style={{
                padding: '0.6rem 0.85rem',
                background: 'rgba(245,166,35,0.06)',
                border: '1px solid rgba(245,166,35,0.2)',
                borderRadius: 4,
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                color: '#888',
              }}>
                ⚠ Case registers are secondary compilations. Evidence derived from this
                document will be assigned Tier C (secondary) in the enslaver evidence
                compendium. Tier upgrades require independent verification of the underlying
                original court records at NARA RG 21.
              </div>
            </>
          )}

          {/* ── Deed / estate / other fields ── */}
          {(docType === 'deed' || docType === 'estate_inventory' || docType === 'other') && (
            <>
              <Field label="DOCUMENT TITLE / SUBJECT">
                <input
                  type="text"
                  className="search-input"
                  placeholder="e.g. Deed of sale, John Biscoe to James Hopewell"
                  value={documentTitle}
                  onChange={e => setDocTitle(e.target.value)}
                />
              </Field>
              <Field label="YEAR">
                <input
                  type="text"
                  className="search-input"
                  placeholder="e.g. 1817"
                  value={testatorYear}
                  onChange={e => setTestatorYear(e.target.value)}
                />
              </Field>
              <Field label="LOCATION">
                <input
                  type="text"
                  className="search-input"
                  placeholder="e.g. St. Mary's County, Maryland"
                  value={testatorLocation}
                  onChange={e => setTestatorLoc(e.target.value)}
                />
              </Field>
            </>
          )}

          {/* ── Archive source (all types) ── */}
          <Field
            label="ARCHIVE SOURCE"
            hint="Where the original document is held. For compilations, cite the publisher."
          >
            <input
              type="text"
              className="search-input"
              placeholder="e.g. NARA RG 21 / Maryland State Archives / Heritage Books 1999"
              value={archiveSource}
              onChange={e => setArchive(e.target.value)}
            />
          </Field>

          {/* ── Error ── */}
          {status === 'error' && error && (
            <div className="state err">{error}</div>
          )}

          {/* ── Submit ── */}
          <button
            type="submit"
            className="btn"
            disabled={!file || status === 'uploading'}
            style={{ alignSelf: 'flex-start', marginTop: '0.5rem' }}
          >
            {status === 'uploading' ? 'Uploading…' : 'Submit Document'}
          </button>
        </form>
      </div>
    </ErrorBoundary>
  );
}
