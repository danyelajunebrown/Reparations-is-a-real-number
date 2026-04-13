import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, filterVerified } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { SearchBar } from '../components/Search/SearchBar.jsx';
import { formatClass, CLASS_LABELS } from '../api/format.js';

// Verified data policy (strict):
// The frontend filters unverified matches before rendering. An "Include unverified"
// toggle exists ONLY in admin context — not here.
export default function SearchPage() {
  const [params] = useSearchParams();
  const query = params.get('q') || '';
  const [showAll, setShowAll] = useState(false); // classification filter
  const [activeClasses, setActiveClasses] = useState(new Set([
    'confirmed_slaveholder',
    'enslaved_ancestor',
    'free_poc',
    'free_poc_slaveholder',
  ]));

  const personsState = useApi(
    signal => query ? api.searchPersons(query, signal) : Promise.resolve({ results: [] }),
    [query]
  );
  const docsState = useApi(
    signal => query ? api.searchDocuments(query, signal) : Promise.resolve({ documents: [] }),
    [query]
  );

  const allPersons = personsState.data?.results || [];
  const verifiedPersons = filterVerified(allPersons);
  // Additional user filter on classification
  const shownPersons = verifiedPersons.filter(p => {
    if (showAll) return true;
    if (!p.verification_status) return true; // canonical/individuals table rows
    return activeClasses.has(p.verification_status);
  });

  const documents = docsState.data?.documents || [];

  function toggleClass(cls) {
    setActiveClasses(prev => {
      const next = new Set(prev);
      if (next.has(cls)) next.delete(cls);
      else next.add(cls);
      return next;
    });
  }

  return (
    <div className="stack-xl">
      <SearchBar />

      {query && (
        <>
          <Filters
            activeClasses={activeClasses}
            showAll={showAll}
            onToggleClass={toggleClass}
            onSetShowAll={setShowAll}
          />

          <Section
            title={`Persons (${shownPersons.length} of ${verifiedPersons.length} verified, ${allPersons.length} total)`}
            loading={personsState.loading}
            error={personsState.error}
          >
            {shownPersons.length === 0 && !personsState.loading && (
              <div className="state">No verified persons match "{query}".</div>
            )}
            <div className="stack">
              {shownPersons.map((p, i) => <PersonResult key={p.id + '-' + i} person={p} />)}
            </div>
          </Section>

          <Section
            title={`Documents (${documents.length})`}
            loading={docsState.loading}
            error={docsState.error}
          >
            {documents.length === 0 && !docsState.loading && (
              <div className="state">No documents match "{query}".</div>
            )}
            <div className="stack">
              {documents.map(d => (
                <Link
                  key={d.document_id || d.id}
                  to={`/documents/${d.document_id || d.id}`}
                  className="box"
                  style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
                >
                  <div>{d.title || d.filename || d.owner_name}</div>
                  <div className="dim" style={{ fontSize: 12 }}>
                    {d.doc_type} · {d.owner_name || 'unknown owner'}
                  </div>
                </Link>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

function Filters({ activeClasses, showAll, onToggleClass, onSetShowAll }) {
  const classes = ['confirmed_slaveholder', 'enslaved_ancestor', 'free_poc', 'free_poc_slaveholder'];
  return (
    <div className="box">
      <div className="box-label">Classification filter</div>
      <div className="row-wrap">
        {classes.map(cls => (
          <button
            key={cls}
            type="button"
            onClick={() => onToggleClass(cls)}
            style={{
              borderColor: activeClasses.has(cls) && !showAll ? 'var(--fg)' : 'var(--border)',
              color: activeClasses.has(cls) && !showAll ? 'var(--fg)' : 'var(--dim)',
            }}
          >
            {activeClasses.has(cls) && !showAll ? '[×] ' : '[ ] '}
            {CLASS_LABELS[cls]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onSetShowAll(!showAll)}
          style={{
            borderColor: showAll ? 'var(--fg)' : 'var(--border)',
            color: showAll ? 'var(--fg)' : 'var(--dim)',
          }}
        >
          {showAll ? '[×]' : '[ ]'} Show all verified
        </button>
      </div>
    </div>
  );
}

function PersonResult({ person }) {
  const id = person.id;
  const source = person.table_source || person.tableSource || 'canonical_persons';
  const href = `/person/${source}/${id}`;
  const cls = person.verification_status;
  return (
    <Link to={href} className="box" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>{person.name || person.full_name}</div>
        {cls && <span className={`badge ${cls}`}>{formatClass(cls)}</span>}
      </div>
      <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
        {person.type || person.person_type}
        {person.birth_year ? ` · b.${person.birth_year}` : ''}
        {person.location ? ` · ${person.location}` : ''}
        {person.source_url ? ` · ${new URL(person.source_url, 'https://x').hostname || 'source'}` : ''}
      </div>
    </Link>
  );
}

function Section({ title, loading, error, children }) {
  return (
    <section>
      <h2 className="upper" style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>{title}</h2>
      {loading && <div className="state">Loading<span className="blink">_</span></div>}
      {error && <div className="state err">Error: {error.message}</div>}
      {!loading && !error && children}
    </section>
  );
}
