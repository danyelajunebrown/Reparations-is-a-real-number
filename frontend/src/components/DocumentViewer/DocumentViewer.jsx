import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';

/**
 * DocumentViewer — full-page view at /documents/:id.
 * Uses /api/documents/:id/access to get a presigned S3 URL.
 */
export function DocumentViewer({ documentId }) {
  const metaState = useApi(s => api.getDocument(documentId, s), [documentId]);
  const accessState = useApi(s => api.getDocumentAccess(documentId, s), [documentId]);

  if (metaState.loading || accessState.loading) {
    return <div className="state">Loading document<span className="blink">_</span></div>;
  }
  if (metaState.error) return <div className="state err">Metadata error: {metaState.error.message}</div>;

  const doc = metaState.data?.document || metaState.data;
  if (!doc) return <div className="state err">Document not found.</div>;

  const access = accessState.data || {};
  const viewUrl = access.viewUrl || access.view_url || access.url || access.downloadUrl;
  const downloadUrl = access.downloadUrl || access.download_url || viewUrl;
  const ext = (doc.filename || doc.file_path || '').toLowerCase().split('.').pop();
  const isImage = ['jpg', 'jpeg', 'png', 'tiff', 'gif', 'webp'].includes(ext);
  const isPdf = ext === 'pdf' || (viewUrl && viewUrl.toLowerCase().includes('.pdf'));

  return (
    <div className="stack-xl">
      <header>
        <Link to="/documents" className="dim">← All documents</Link>
        <h1 style={{ fontSize: 20, fontWeight: 'normal', marginTop: 8 }}>
          {doc.title || doc.filename || 'Untitled document'}
        </h1>
      </header>

      <section className="grid-3">
        <Field label="Owner" value={doc.owner_name} />
        <Field label="Document type" value={doc.doc_type} />
        <Field label="Location" value={doc.location} />
        <Field label="Year" value={doc.year || (doc.birth_year && `${doc.birth_year}–${doc.death_year}`)} />
        <Field label="Enslaved persons documented" value={doc.total_enslaved} />
        <Field label="Source ARK" value={doc.source_ark} mono />
      </section>

      <section>
        <h2 className="upper" style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>Document</h2>
        <DocEmbed viewUrl={viewUrl} downloadUrl={downloadUrl} filename={doc.filename} isPdf={isPdf} isImage={isImage} />
      </section>

      {doc.ocr_text && (
        <section>
          <h2 className="upper" style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>
            OCR transcription
          </h2>
          <div className="box" style={{ whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: '40vh', overflow: 'auto' }}>
            {doc.ocr_text}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * DocOverlay — fullscreen fixed overlay for S3 document viewing.
 * Used from PersonProfile when clicking a primary source document.
 * Press Escape or click × to close.
 */
export function DocOverlay({ docId, onClose }) {
  const metaState = useApi(s => api.getDocument(docId, s), [docId]);
  const accessState = useApi(s => api.getDocumentAccess(docId, s), [docId]);

  // Escape to close
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const doc = metaState.data?.document || metaState.data;
  const access = accessState.data || {};
  const viewUrl = access.viewUrl || access.view_url || access.url || access.downloadUrl;
  const downloadUrl = access.downloadUrl || access.download_url || viewUrl;
  const ext = (doc?.filename || doc?.file_path || '').toLowerCase().split('.').pop();
  const isImage = ['jpg', 'jpeg', 'png', 'tiff', 'gif', 'webp'].includes(ext);
  const isPdf = ext === 'pdf' || (viewUrl && viewUrl.toLowerCase().includes('.pdf'));

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999,
        background: '#000',
        display: 'flex',
        flexDirection: 'column',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Top bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        borderBottom: '1px solid #333',
        flexShrink: 0,
        gap: 12,
      }}>
        <div style={{ color: '#ccc', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {metaState.loading
            ? 'Loading…'
            : doc
              ? (doc.title || doc.filename || 'Primary source document')
              : 'Document'}
          {doc?.owner_name && <span style={{ color: '#666', marginLeft: 8 }}>· {doc.owner_name}</span>}
          {doc?.doc_type && <span style={{ color: '#666', marginLeft: 8 }}>· {doc.doc_type}</span>}
          {doc?.source_ark && <span style={{ color: '#555', marginLeft: 8, fontFamily: 'monospace', fontSize: 11 }}>ARK:{doc.source_ark}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {downloadUrl && (
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#aaa', fontSize: 12, textDecoration: 'none', padding: '4px 8px', border: '1px solid #444' }}
            >
              ↓ download
            </a>
          )}
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: '1px solid #444',
              color: '#ccc',
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
              padding: '2px 10px',
            }}
            aria-label="Close document viewer"
          >
            ×
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
        {(metaState.loading || accessState.loading) && (
          <div style={{ color: '#aaa', padding: 40 }}>Loading<span className="blink">_</span></div>
        )}
        {metaState.error && (
          <div style={{ color: '#f66', padding: 40 }}>Error: {metaState.error.message}</div>
        )}
        {!metaState.loading && !accessState.loading && !metaState.error && (
          <DocEmbed
            viewUrl={viewUrl}
            downloadUrl={downloadUrl}
            filename={doc?.filename}
            isPdf={isPdf}
            isImage={isImage}
            fullscreen
            accessError={accessState.error}
            accessData={accessState.data}
          />
        )}
      </div>

      {/* OCR strip if available */}
      {doc?.ocr_text && (
        <div style={{
          maxHeight: 120,
          overflow: 'auto',
          borderTop: '1px solid #333',
          padding: '8px 16px',
          fontSize: 11,
          color: '#777',
          whiteSpace: 'pre-wrap',
          flexShrink: 0,
        }}>
          <span style={{ color: '#555', marginRight: 8 }}>OCR:</span>
          {doc.ocr_text}
        </div>
      )}
    </div>
  );
}

/** Shared embed logic for PDF / image / fallback.
 *
 * Extension detection uses two layers:
 *   1. The filename/file_path from document metadata (passed as props).
 *   2. The viewUrl itself — strip the query string and read the extension.
 * Layer 2 handles person_documents rows where the metadata field name
 * doesn't match what DocEmbed expects (e.g. s3_key instead of file_path).
 */
function DocEmbed({ viewUrl, downloadUrl, filename, isPdf: isPdfHint, isImage: isImageHint, fullscreen = false, accessError, accessData }) {
  const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'tiff', 'gif', 'webp'];
  // Strip the S3 query string before checking the URL extension.
  const urlExt = viewUrl ? viewUrl.split('?')[0].toLowerCase().split('.').pop() : '';
  const isImage = isImageHint || IMAGE_EXTS.includes(urlExt);
  const isPdf   = isPdfHint   || urlExt === 'pdf';
  if (!viewUrl) {
    // Build a useful diagnostic message from whatever the API returned
    let errMsg = 'No access URL available for this document.';
    if (accessError) {
      errMsg = `Access error: ${accessError.message || String(accessError)}`;
    } else if (accessData) {
      // API returned 200 but no viewUrl — show whatever came back
      const detail = accessData.error || accessData.message || JSON.stringify(accessData).slice(0, 200);
      errMsg = `Document access failed: ${detail}`;
    }
    return (
      <div
        className={fullscreen ? undefined : 'state err'}
        style={fullscreen
          ? { color: '#f66', padding: 40, fontFamily: 'monospace', fontSize: 13, whiteSpace: 'pre-wrap', maxWidth: 600 }
          : undefined}
      >
        {errMsg}
        {accessData?.debugInfo && (
          <pre style={{ marginTop: 12, fontSize: 11, color: '#a44', whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(accessData.debugInfo, null, 2)}
          </pre>
        )}
      </div>
    );
  }

  if (isPdf) {
    return (
      <iframe
        src={viewUrl}
        title={filename || 'document'}
        style={{
          width: fullscreen ? '100%' : '100%',
          height: fullscreen ? '100%' : '80vh',
          border: fullscreen ? 'none' : '1px solid var(--border)',
          background: '#fff',
          display: 'block',
          flex: fullscreen ? 1 : undefined,
          alignSelf: fullscreen ? 'stretch' : undefined,
        }}
      />
    );
  }

  if (isImage) {
    return (
      <img
        src={viewUrl}
        alt={filename || 'document'}
        style={{
          maxWidth: '100%',
          maxHeight: fullscreen ? '100%' : undefined,
          border: fullscreen ? 'none' : '1px solid var(--border)',
          background: fullscreen ? 'transparent' : '#fff',
          display: 'block',
        }}
      />
    );
  }

  return (
    <div className={fullscreen ? undefined : 'box'} style={fullscreen ? { color: '#aaa', padding: 40 } : undefined}>
      <div>Unrecognized format — direct download:</div>
      <a href={downloadUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#66aaff' }}>{downloadUrl}</a>
    </div>
  );
}

function Field({ label, value, mono }) {
  return (
    <div className="box">
      <div className="box-label">{label}</div>
      <div style={{ fontFamily: mono ? 'var(--font-mono)' : undefined }}>
        {value || <span className="dimmer">—</span>}
      </div>
    </div>
  );
}
