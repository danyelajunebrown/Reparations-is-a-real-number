import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, filterVerified } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { SearchBar } from '../components/Search/SearchBar.jsx';
import { PersonCard, DocumentCard, Section } from '../components/ui/index.jsx';
import { CLASS_LABELS } from '../api/format.js';

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
  // An explicit person-ID lookup (query was a bare number / #id / id:) returns exact matches.
  // It bypasses the user's CLASSIFICATION toggle (so the asked-for record appears), but it must
  // STILL respect the verified/external-assertion gate (M102) — an undocumented lead or gated
  // canonical must never surface to the public even via an exact-id lookup.
  const isIdSearch = personsState.data?.idSearch === true;
  const verifiedPersons = filterVerified(allPersons);
  // Additional user filter on classification (skipped for id-search)
  const shownPersons = isIdSearch ? verifiedPersons : verifiedPersons.filter(p => {
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
          {!isIdSearch && (
            <Filters
              activeClasses={activeClasses}
              showAll={showAll}
              onToggleClass={toggleClass}
              onSetShowAll={setShowAll}
            />
          )}

          <Section
            title={isIdSearch
              ? `Person ID ${query} (${shownPersons.length} match${shownPersons.length === 1 ? '' : 'es'})`
              : `Persons (${shownPersons.length} of ${verifiedPersons.length} verified, ${allPersons.length} total)`}
            loading={personsState.loading}
            error={personsState.error}
          >
            {shownPersons.length === 0 && !personsState.loading && (
              <div className="state">
                {isIdSearch ? `No person found with ID ${query}.` : `No verified persons match "${query}".`}
              </div>
            )}
            <div className="stack">
              {shownPersons.map((p, i) => <PersonCard key={p.id + '-' + i} person={p} />)}
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
              {documents.map(d => <DocumentCard key={d.document_id || d.id} doc={d} />)}
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
