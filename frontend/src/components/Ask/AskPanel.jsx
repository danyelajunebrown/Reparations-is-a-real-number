import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { LoadingState, ErrorState } from '../ui/index.jsx';

/**
 * AskPanel — ask a question and get an answer grounded in the digitized primary
 * sources, with citations that open the source document.
 *
 * Honesty is the whole point (this is an evidence system):
 *  - Backed by /api/rag/query (semantic retrieval over the document corpus), NOT
 *    the keyword /api/chat — so answers are grounded and cited.
 *  - If nothing relevant is retrieved (grounded:false / no citations), we say so
 *    and give NO answer. We never invent one.
 *  - If the retrieval backend is unreachable (degraded:true), we say that plainly.
 *  - Read-only: this never computes a reparations figure (that stays deterministic).
 */
export function AskPanel() {
  const [params] = useSearchParams();
  const initialQ = params.get('q') || '';
  const [question, setQuestion] = useState(initialQ);
  const [asked, setAsked] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function askQuestion(q) {
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setAsked(q);
    try {
      setResult(await api.ragQuery(q, { k: 8 }));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }
  const ask = (e) => { if (e) e.preventDefault(); askQuestion(question.trim()); };

  // Deep-linked from Search / a person profile (?q=…): run it automatically.
  useEffect(() => {
    if (initialQ.trim()) askQuestion(initialQ.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQ]);

  const citations = result?.citations || [];
  const grounded = !!result && result.grounded !== false && citations.length > 0;

  return (
    <div className="stack-xl" style={{ maxWidth: 720, margin: '0 auto', width: '100%' }}>
      <header>
        <h1>Ask the archive</h1>
        <p className="dim" style={{ marginTop: 6, maxWidth: '60ch' }}>
          Ask a question about the people and documents in this collection. Answers come
          only from the digitized primary sources, and every answer links to the records
          it draws on. If the archive holds nothing relevant, it says so rather than guessing.
        </p>
      </header>

      <form onSubmit={ask} className="stack">
        <textarea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask(e); }}
          rows={3}
          placeholder="e.g. Whose will freed William Lee?"
          aria-label="Your question"
          style={{ resize: 'vertical', fontFamily: 'var(--font-body)' }}
        />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="dim" style={{ fontSize: 'var(--fs-xs)' }}>⌘/Ctrl + Enter to ask</span>
          <button type="submit" className="btn-primary" disabled={loading || !question.trim()}>
            {loading ? 'Searching…' : 'Ask'}
          </button>
        </div>
      </form>

      {loading && <LoadingState label="Searching the archive" />}
      {error && <ErrorState message={error.message} />}

      {result && !loading && !error && (
        <section className="stack-lg">
          {/* Honest states first. */}
          {result.degraded && (
            <div className="state">
              The retrieval service is temporarily unavailable, so this question can’t be
              answered right now. Please try again shortly.
            </div>
          )}

          {!result.degraded && !grounded && (
            <div className="state">
              No documents in the archive matched “{asked}”. Nothing was found to ground an
              answer on, so none is given. Try different names, places, or terms — or browse
              the <Link to="/documents">documents</Link> and <Link to="/search">people</Link> directly.
            </div>
          )}

          {!result.degraded && grounded && (
            <>
              <div className="evidence">
                <div className="box-label">Answer</div>
                <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{result.answer}</div>
              </div>

              <div>
                <div className="box-label" style={{ marginBottom: 'var(--sp-2)' }}>
                  Grounded on {citations.length} source{citations.length === 1 ? '' : 's'} — tap to open
                </div>
                <div className="stack">
                  {citations.map((c, i) => <SourceCitation key={c.document_id ?? i} c={c} />)}
                </div>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function SourceCitation({ c }) {
  const label = `Document #${c.document_id}${c.document_type ? ` · ${c.document_type}` : ''}`;
  // A citation with a document_id opens in the in-app viewer (presigned S3 scan).
  if (c.document_id != null) {
    return (
      <Link
        to={`/documents/${c.document_id}`}
        className="box"
        style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
      >
        <div>{label} <span style={{ color: 'var(--accent)' }}>↗ open</span></div>
        {c.source_url && <div className="citation">{c.source_url}</div>}
      </Link>
    );
  }
  // No internal id — link out to the source URL if we have one.
  if (c.source_url) {
    return (
      <a href={c.source_url} target="_blank" rel="noopener noreferrer" className="box"
        style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
        <div>{c.document_type || 'Source'} <span style={{ color: 'var(--accent)' }}>↗</span></div>
        <div className="citation">{c.source_url}</div>
      </a>
    );
  }
  return <div className="box">{label}</div>;
}
