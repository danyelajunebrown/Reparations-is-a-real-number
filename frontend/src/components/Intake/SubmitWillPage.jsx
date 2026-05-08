/**
 * SubmitWillPage — public-facing probate / will document ingestion.
 *
 * No admin token required. Anyone can upload an archival PDF.
 * Uses the project's native terminal aesthetic (global.css) and the
 * fetch-based api client pattern — no axios, no react-bootstrap.
 *
 * Route: /contribute/will  (see App.jsx)
 */

import React, { useState } from 'react';
import { Link } from 'react-router-dom';

const BACKEND = import.meta.env.VITE_API_URL || '';

async function ingestWill(formData) {
  const res = await fetch(`${BACKEND}/api/wills/ingest`, {
    method: 'POST',
    // No Content-Type header — browser sets multipart boundary automatically
    body: formData,
  });
  const data = await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }));
  if (!res.ok || !data.success) {
    throw new Error(data.error || `Upload failed (${res.status})`);
  }
  return data;
}

export default function SubmitWillPage() {
  const [file, setFile] = useState(null);
  const [testatorName, setTestatorName] = useState('');
  const [testatorYear, setTestatorYear] = useState('');
  const [testatorLocation, setTestatorLocation] = useState('');
  const [archiveSource, setArchiveSource] = useState('');

  const [status, setStatus] = useState('idle'); // idle | uploading | done | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;

    setStatus('uploading');
    setError('');

    const fd = new FormData();
    fd.append('willPdf', file);
    if (testatorName)     fd.append('testatorName', testatorName);
    if (testatorYear)     fd.append('testatorYear', testatorYear);
    if (testatorLocation) fd.append('testatorLocation', testatorLocation);
    if (archiveSource)    fd.append('archiveSource', archiveSource);

    try {
      const data = await ingestWill(fd);
      setResult(data);
      setStatus('done');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  };

  const reset = () => {
    setFile(null);
    setTestatorName('');
    setTestatorYear('');
    setTestatorLocation('');
    setArchiveSource('');
    setStatus('idle');
    setResult(null);
    setError('');
  };

  // ── Success screen ────────────────────────────────────────────────────────
  if (status === 'done' && result) {
    return (
      <div className="page">
        <div className="state ok">✓ Document uploaded successfully</div>

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
          {Array.isArray(result.nextSteps) && result.nextSteps.length > 0 && (
            <ul style={{ marginTop: '1rem', paddingLeft: '1.2rem', color: '#aaa', lineHeight: 1.8 }}>
              {result.nextSteps.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          )}
        </div>

        <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem' }}>
          <button className="btn" onClick={reset}>Submit another document</button>
          <Link to="/" className="btn" style={{ textDecoration: 'none' }}>← Back to search</Link>
        </div>
      </div>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <div className="page">
      <h2 style={{ fontFamily: 'monospace', marginBottom: '0.5rem' }}>
        Submit Archival Document
      </h2>
      <p style={{ color: '#888', fontFamily: 'monospace', fontSize: '0.85rem', marginBottom: '2rem', maxWidth: 520 }}>
        Upload a will, probate record, estate inventory, or deed from an archive.
        The PDF is stored in S3 and queued for OCR extraction — no account required.
        Genealogical connections found during extraction will be reflected across
        all public person profiles automatically.
      </p>

      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 500 }}
      >
        {/* PDF file input */}
        <div>
          <label style={{ display: 'block', fontFamily: 'monospace', fontSize: '0.8rem', color: '#888', marginBottom: 6 }}>
            PDF FILE *
          </label>
          <input
            type="file"
            accept=".pdf,application/pdf"
            required
            onChange={e => setFile(e.target.files[0] || null)}
            style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: '#e0e0e0', width: '100%' }}
          />
          {file && (
            <div style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#888', marginTop: 4 }}>
              {file.name} — {(file.size / 1024).toFixed(0)} KB
            </div>
          )}
        </div>

        {/* Testator name */}
        <div>
          <label style={{ display: 'block', fontFamily: 'monospace', fontSize: '0.8rem', color: '#888', marginBottom: 6 }}>
            TESTATOR NAME
          </label>
          <input
            type="text"
            className="search-input"
            placeholder="e.g. Henry Weaver"
            value={testatorName}
            onChange={e => setTestatorName(e.target.value)}
          />
        </div>

        {/* Year */}
        <div>
          <label style={{ display: 'block', fontFamily: 'monospace', fontSize: '0.8rem', color: '#888', marginBottom: 6 }}>
            YEAR OF WILL / PROBATE
          </label>
          <input
            type="text"
            className="search-input"
            placeholder="e.g. 1847"
            value={testatorYear}
            onChange={e => setTestatorYear(e.target.value)}
          />
        </div>

        {/* Location */}
        <div>
          <label style={{ display: 'block', fontFamily: 'monospace', fontSize: '0.8rem', color: '#888', marginBottom: 6 }}>
            LOCATION (county, state / territory)
          </label>
          <input
            type="text"
            className="search-input"
            placeholder="e.g. Washington DC"
            value={testatorLocation}
            onChange={e => setTestatorLocation(e.target.value)}
          />
        </div>

        {/* Archive source */}
        <div>
          <label style={{ display: 'block', fontFamily: 'monospace', fontSize: '0.8rem', color: '#888', marginBottom: 6 }}>
            ARCHIVE SOURCE
          </label>
          <input
            type="text"
            className="search-input"
            placeholder="e.g. DC Archives, NARA RG 21, Maryland State Archives"
            value={archiveSource}
            onChange={e => setArchiveSource(e.target.value)}
          />
        </div>

        {/* Error */}
        {status === 'error' && error && (
          <div className="state err">{error}</div>
        )}

        {/* Submit */}
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
  );
}
