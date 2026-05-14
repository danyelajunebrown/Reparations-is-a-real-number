import React, { useEffect, useState } from 'react';
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

  // ── External URL guard ────────────────────────────────────────────────────
  // Presigned S3 URLs contain amazonaws.com or X-Amz-Signature.
  // Relative paths are safe. Everything else (FamilySearch, etc.) blocks
  // hotlinking/iframe embedding and must be opened in a new tab.
  const isPresignedS3 = viewUrl.includes('amazonaws.com') || viewUrl.includes('X-Amz-Signature');
  const isRelative = viewUrl.startsWith('/');
  const isExternal = !isPresignedS3 && !isRelative;

  if (isExternal) {
    let hostLabel = viewUrl;
    try { hostLabel = new URL(viewUrl).hostname.replace(/^www\./, ''); } catch (_) {}
    return (
      <div
        className={fullscreen ? undefined : 'box'}
        style={fullscreen
          ? { color: '#aaa', padding: 40, textAlign: 'center' }
          : { textAlign: 'center', padding: 24 }}
      >
        <div style={{ marginBottom: 12, fontSize: 13, color: fullscreen ? '#aaa' : undefined }}>
          This document is hosted on <strong>{hostLabel}</strong> and cannot be embedded here.
        </div>
        <a
          href={viewUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: '#66aaff',
            fontSize: 13,
            textDecoration: 'none',
            border: '1px solid #336',
            padding: '6px 14px',
            display: 'inline-block',
          }}
        >
          Open on {hostLabel} ↗
        </a>
        {downloadUrl && downloadUrl !== viewUrl && (
          <div style={{ marginTop: 8 }}>
            <a href={downloadUrl} target="_blank" rel="noopener noreferrer"
               style={{ color: fullscreen ? '#666' : 'var(--dim)', fontSize: 11 }}>
              ↓ download
            </a>
          </div>
        )}
      </div>
    );
  }
  // ── End external URL guard ─────────────────────────────────────────────────

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

/**
 * DocCollectionOverlay — fullscreen fixed overlay for multi-page document collections.
 * Accepts a `collection` object: { collection_name, source_type_label, doc_type, pages[] }
 * where each page has { id, s3_url, source_url, title, filename, ocr_text, ... }.
 * ← / → arrow keys navigate pages. Escape closes. H toggles name highlights.
 *
 * namesToHighlight: [{ name, category }] — names to highlight in OCR text strip.
 * Categories: 'primary' (amber), 'owner' (red), 'enslaved' (blue), 'family' (green).
 */
export function DocCollectionOverlay({ collection, onClose, namesToHighlight = [] }) {
  const [pageIdx, setPageIdx] = useState(0);
  const [highlightsOn, setHighlightsOn] = useState(true);
  const pages = collection.pages || [];
  const page = pages[pageIdx];
  const total = pages.length;

  // Presigned URL state — refetched whenever the current page changes
  const [accessData, setAccessData] = useState(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!page?.id) return;
    setAccessLoading(true);
    setAccessData(null);
    setAccessError(null);
    const controller = new AbortController();
    api.getPersonDocAccess(page.id, controller.signal)
      .then(data => { if (!controller.signal.aborted) setAccessData(data); })
      .catch(err => {
        if (!controller.signal.aborted) {
          console.warn('[DocCollectionOverlay] presign error:', err.message);
          setAccessError(err.message || 'Presign failed');
        }
      })
      .finally(() => { if (!controller.signal.aborted) setAccessLoading(false); });
    return () => controller.abort();
  }, [page?.id, retryCount]);

  // Keyboard navigation — H toggles highlights
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
        setPageIdx(i => Math.min(i + 1, total - 1));
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
        setPageIdx(i => Math.max(i - 1, 0));
      if (e.key === 'h' || e.key === 'H')
        setHighlightsOn(v => !v);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, total]);

  // Lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  if (!page) return null;

  // Prefer backend presigned URL; fall back to source_url (NOT raw s3_url — bucket is private)
  const access = accessData || {};
  const viewUrl = access.viewUrl || access.view_url || page.source_url;
  const downloadUrl = access.downloadUrl || access.download_url || viewUrl;

  const urlExt = viewUrl ? viewUrl.split('?')[0].toLowerCase().split('.').pop() : '';
  const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'tiff', 'gif', 'webp'];
  const isImage = IMAGE_EXTS.includes(urlExt);
  const isPdf   = urlExt === 'pdf';

  const CATEGORY_COLORS = { primary: '#f59e0b', owner: '#ef4444', enslaved: '#3b82f6', family: '#22c55e' };
  const ocrText = page.ocr_text || '';

  // Which names appear in this page's OCR text?
  const pageMatches = namesToHighlight.filter(({ name }) =>
    name && ocrText.toLowerCase().includes(name.toLowerCase())
  );

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 999, background: '#000', display: 'flex', flexDirection: 'column' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', borderBottom: '1px solid #333', flexShrink: 0, gap: 12 }}>
        {/* Title + name-found badges */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ color: '#ccc', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {collection.collection_name}
            {collection.source_type_label && (
              <span style={{ color: '#555', marginLeft: 8, fontSize: 11 }}>· {collection.source_type_label}</span>
            )}
          </div>
          {highlightsOn && pageMatches.length > 0 && (
            <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
              {pageMatches.map(({ name, category }) => (
                <span key={name} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: CATEGORY_COLORS[category] || '#f59e0b', color: '#000', fontWeight: 600 }}>
                  🔍 {name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Controls: highlight toggle + page nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {namesToHighlight.length > 0 && ocrText && (
            <button
              onClick={() => setHighlightsOn(v => !v)}
              title="Toggle name highlights (H key)"
              style={{ background: highlightsOn ? '#f59e0b22' : 'none', border: `1px solid ${highlightsOn ? '#f59e0b' : '#444'}`, color: highlightsOn ? '#f59e0b' : '#666', cursor: 'pointer', padding: '4px 8px', fontSize: 11, borderRadius: 3 }}
            >
              H {highlightsOn ? '✓' : '○'}
            </button>
          )}
          <button
            onClick={() => setPageIdx(i => Math.max(i - 1, 0))}
            disabled={pageIdx === 0}
            style={{ background: 'none', border: '1px solid #444', color: pageIdx === 0 ? '#444' : '#ccc', cursor: pageIdx === 0 ? 'default' : 'pointer', padding: '4px 10px' }}
            aria-label="Previous page"
          >←</button>
          <span style={{ color: '#888', fontSize: 12, minWidth: 75, textAlign: 'center' }}>
            Page {pageIdx + 1} of {total}
          </span>
          <button
            onClick={() => setPageIdx(i => Math.min(i + 1, total - 1))}
            disabled={pageIdx === total - 1}
            style={{ background: 'none', border: '1px solid #444', color: pageIdx === total - 1 ? '#444' : '#ccc', cursor: pageIdx === total - 1 ? 'default' : 'pointer', padding: '4px 10px' }}
            aria-label="Next page"
          >→</button>
          {viewUrl && (
            <a href={viewUrl} target="_blank" rel="noopener noreferrer"
              style={{ color: '#aaa', fontSize: 12, textDecoration: 'none', padding: '4px 8px', border: '1px solid #444' }}>
              ↓ download
            </a>
          )}
          <button onClick={onClose}
            style={{ background: 'none', border: '1px solid #444', color: '#ccc', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '2px 10px' }}
            aria-label="Close document viewer">×</button>
        </div>
      </div>

      {/* Page content */}
      <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
        {accessLoading && (
          <div style={{ color: '#aaa', padding: 40 }}>Loading<span className="blink">_</span></div>
        )}
        {!accessLoading && !viewUrl && (
          <div style={{ color: '#f66', padding: 40, textAlign: 'center' }}>
            <div style={{ marginBottom: 12 }}>
              {accessError
                ? `Could not load document: ${accessError}`
                : `No document URL available for page ${pageIdx + 1}.`}
            </div>
            {page?.id && (
              <button
                onClick={() => setRetryCount(c => c + 1)}
                style={{ background: 'none', border: '1px solid #f66', color: '#f66', cursor: 'pointer', padding: '6px 16px', fontSize: 12 }}
              >
                ↺ Retry
              </button>
            )}
          </div>
        )}
        {!accessLoading && viewUrl && (() => {
          // External URL guard — same logic as DocEmbed.
          // FamilySearch and other external hosts block hotlinking; must open in new tab.
          const isPresignedS3 = viewUrl.includes('amazonaws.com') || viewUrl.includes('X-Amz-Signature');
          const isExternalUrl = !isPresignedS3 && !viewUrl.startsWith('/');
          if (isExternalUrl) {
            let hostLabel = viewUrl;
            try { hostLabel = new URL(viewUrl).hostname.replace(/^www\./, ''); } catch (_) {}
            return (
              <div style={{ color: '#aaa', padding: 40, textAlign: 'center' }}>
                <div style={{ marginBottom: 12, fontSize: 13 }}>
                  This document is hosted on <strong style={{ color: '#ccc' }}>{hostLabel}</strong> and cannot be embedded here.
                </div>
                <a href={viewUrl} target="_blank" rel="noopener noreferrer"
                  style={{ color: '#66aaff', fontSize: 13, textDecoration: 'none', border: '1px solid #336', padding: '6px 14px', display: 'inline-block' }}>
                  Open on {hostLabel} ↗
                </a>
              </div>
            );
          }
          if (isImage) return (
            <img src={viewUrl} alt={page.title || page.filename || `Page ${pageIdx + 1}`}
              style={{ maxWidth: '100%', display: 'block' }} />
          );
          if (isPdf) return (
            <iframe src={viewUrl} title={page.title || `Page ${pageIdx + 1}`}
              style={{ width: '100%', flex: 1, border: 'none', alignSelf: 'stretch', minHeight: '80vh' }} />
          );
          return (
            <div style={{ color: '#aaa', padding: 40 }}>
              <div>Unrecognized format — open directly:</div>
              <a href={viewUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#66aaff' }}>{viewUrl}</a>
            </div>
          );
        })()}
      </div>

      {/* OCR text strip — with name highlighting when enabled */}
      {ocrText && (
        <div style={{ maxHeight: 120, overflow: 'auto', borderTop: '1px solid #333', padding: '8px 16px', fontSize: 11, color: '#777', whiteSpace: 'pre-wrap', flexShrink: 0 }}>
          <span style={{ color: '#555', marginRight: 8 }}>OCR:</span>
          {highlightsOn && namesToHighlight.length > 0
            ? <span dangerouslySetInnerHTML={{ __html: buildHighlightedOcr(ocrText, namesToHighlight, CATEGORY_COLORS) }} />
            : ocrText}
        </div>
      )}
    </div>
  );
}

/**
 * buildHighlightedOcr — HTML-escapes OCR text then wraps matched names in
 * <mark> spans coloured by category.  Sorted by name length descending so
 * "Ann Maria" matches before "Ann".
 */
function buildHighlightedOcr(text, namesToHighlight, colors) {
  let safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const sorted = [...namesToHighlight]
    .filter(n => n.name && n.name.length > 1)
    .sort((a, b) => b.name.length - a.name.length);
  for (const { name, category } of sorted) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const color = colors[category] || '#f59e0b';
    safe = safe.replace(
      new RegExp(`(${esc})`, 'gi'),
      `<mark style="background:${color};color:#000;padding:0 2px;border-radius:2px">$1</mark>`
    );
  }
  return safe;
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
