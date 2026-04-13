import React from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';

/**
 * DocumentViewer — displays a historical document with its metadata.
 * Uses /api/documents/:id/access to get a presigned S3 URL.
 * Supports PDF, image formats, and falls back to a download link.
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
        {!viewUrl && <div className="state err">No access URL available for this document.</div>}
        {viewUrl && isPdf && (
          <iframe
            src={viewUrl}
            title={doc.filename}
            style={{
              width: '100%',
              height: '80vh',
              border: '1px solid var(--border)',
              background: '#fff',
            }}
          />
        )}
        {viewUrl && isImage && (
          <img
            src={viewUrl}
            alt={doc.filename}
            style={{
              maxWidth: '100%',
              border: '1px solid var(--border)',
              background: '#fff',
            }}
          />
        )}
        {viewUrl && !isPdf && !isImage && (
          <div className="box">
            <div>Unrecognized format — direct download:</div>
            <a href={downloadUrl} target="_blank" rel="noopener noreferrer">{downloadUrl}</a>
          </div>
        )}
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
