import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, filterVerified } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { formatClass } from '../api/format.js';
import { SearchBar } from '../components/Search/SearchBar.jsx';
import { LedgerSection } from '../components/Layout/LedgerSection.jsx';
import IntakeButton from '../components/Intake/IntakeButton.jsx';
import { useKioskMode } from '../hooks/useKioskMode.js';

// Home page.
// Pre-search: mission statement + live stats + provenance + section navigation + search bar.
// Post-search: collapses to search + inline results (Google-minimal behaviour preserved).

const SECTIONS = [
  {
    to: '/search',
    label: 'Search',
    desc: 'Full-text search across all verified persons and primary-source documents.',
  },
  {
    to: '/depositors',
    label: 'Depositors',
    desc: "Freedmen's Bank account holders, 1865-1874. 61,000+ entries indexed.",
  },
  {
    to: '/lineage',
    label: 'Lineages',
    desc: 'Ancestor climb sessions -- FamilySearch-verified kinship chains.',
  },
  {
    to: '/documents',
    label: 'Documents',
    desc: 'Primary sources: DC petitions, slave schedules, wills, deeds, ship manifests.',
  },
  {
    to: '/corporate',
    label: 'Corporate Debts',
    desc: 'Farmer-Paellmann entities. Institutional liability by sector and company.',
  },
  {
    to: '/legal',
    label: 'Legal Framework',
    desc: 'Jurisdictions, doctrines, and precedents undergirding the accounting.',
  },
  {
    to: '/pay',
    label: 'Blockchain Ledger',
    desc: 'On-chain reparations accounting deployed on Base (Ethereum L2).',
  },
];

// Example searches shown below the search bar pre-search.
// These help the primary audience (Black folks searching ancestors) understand
// what kind of queries this database answers.
const EXAMPLE_SEARCHES = [
  'Ann Maria Biscoe',
  'James Hopewell',
  'freedmen Richmond Virginia',
  'Biscoe District of Columbia',
];

export default function HomePage() {
  const [submitted, setSubmitted] = useState('');
  // useKioskMode persists the ?mode=kiosk flag in sessionStorage so it
  // survives React Router navigation (pushState strips the query param).
  const isKiosk = useKioskMode();

  const personsState = useApi(
    signal => submitted ? api.searchPersons(submitted, signal) : Promise.resolve({ results: [] }),
    [submitted]
  );
  const docsState = useApi(
    signal => submitted ? api.searchDocuments(submitted, signal) : Promise.resolve({ documents: [] }),
    [submitted]
  );

  const allPersons = personsState.data?.results || [];
  const persons = filterVerified(allPersons);
  const documents = docsState.data?.documents || [];
  const hasResults = !!submitted;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      minHeight: hasResults ? 'auto' : 'calc(70vh - 80px)',
      justifyContent: hasResults ? 'flex-start' : 'center',
      paddingTop: hasResults ? 40 : 0,
      transition: 'all 0.2s ease',
      width: '100%',
    }}>

      {/* Title */}
      <div style={{
        fontSize: hasResults ? 18 : 42,
        fontWeight: 600,
        letterSpacing: hasResults ? 0 : 3,
        marginBottom: 12,
        textAlign: 'center',
        transition: 'all 0.2s ease',
      }}>
        Reparations &#x2208; &#x211d;
      </div>

      {/* Mission statement -- pre-search only */}
      {!hasResults && (
        <div style={{
          color: 'var(--dim)',
          fontSize: 13,
          textAlign: 'center',
          maxWidth: 560,
          marginBottom: 32,
          lineHeight: 1.8,
        }}>
          A global slavery accountability infrastructure.{' '}
          Every person displayed here is verified against primary sources.
          The number is real. This is the ledger.
        </div>
      )}

      {/* Search bar */}
      <div style={{
        width: '100%',
        maxWidth: hasResults ? '100%' : 540,
        transition: 'max-width 0.2s ease',
      }}>
        <SearchBar autoFocus onSearch={q => setSubmitted(q)} />
      </div>

      {/* Example searches -- pre-search only */}
      {!hasResults && (
        <div style={{
          width: '100%',
          maxWidth: 540,
          marginTop: 10,
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px 16px',
        }}>
          <span style={{ color: 'var(--dimmer)', fontSize: 11 }}>try:</span>
          {EXAMPLE_SEARCHES.map(q => (
            <button
              key={q}
              type="button"
              onClick={() => setSubmitted(q)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--dim)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                cursor: 'pointer',
                padding: 0,
                textDecoration: 'underline',
                textDecorationStyle: 'dotted',
              }}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* REQUEST INTAKE button -- kiosk mode only (Pi) */}
      {!hasResults && isKiosk && (
        <div style={{ width: '100%', maxWidth: 540, marginTop: 20, textAlign: 'center' }}>
          <IntakeButton />
        </div>
      )}

      {/* Ledger: live stats + collections -- pre-search only
          Replaces the old separate StatsRibbon + hardcoded "What's in this ledger" box.
          LedgerSection makes one api.stats() call and renders both. */}
      {!hasResults && (
        <div style={{ width: '100%', maxWidth: 800 }}>
          <LedgerSection />
        </div>
      )}

      {/* Section cards -- pre-search only */}
      {!hasResults && (
        <div style={{ width: '100%', maxWidth: 800, marginTop: 32 }}>
          <div
            className="upper"
            style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 12 }}
          >
            Sections
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 8,
            }}
          >
            {SECTIONS.map(s => (
              <SectionCard key={s.to} to={s.to} label={s.label} desc={s.desc} />
            ))}
          </div>
        </div>
      )}

      {/* Inline results -- post-search */}
      {hasResults && (
        <div style={{ width: '100%', marginTop: 32 }} className="stack-xl">

          {/* Link to full SearchPage */}
          <div style={{ textAlign: 'right' }}>
            <Link
              to={`/search?q=${encodeURIComponent(submitted)}`}
              style={{ fontSize: 12, color: 'var(--dim)' }}
            >
              View full search results &rarr;
            </Link>
          </div>

          {/* Persons */}
          <section>
            <h2 className="upper" style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 8 }}>
              {personsState.loading
                ? 'Persons -- loading...'
                : `Persons -- ${persons.length} verified${allPersons.length > persons.length
                    ? ` of ${allPersons.length} total`
                    : ''
                  }`
              }
            </h2>
            {personsState.loading && (
              <div className="state">Loading<span className="blink">_</span></div>
            )}
            {personsState.error && (
              <div className="state err">Error: {personsState.error.message}</div>
            )}
            {!personsState.loading && !personsState.error && persons.length === 0 && (
              <div className="state dim">No verified persons match &ldquo;{submitted}&rdquo;.</div>
            )}
            <div className="stack">
              {persons.map((p, i) => (
                <PersonResult key={`${p.id}-${i}`} person={p} />
              ))}
            </div>
          </section>

          {/* Documents */}
          <section>
            <h2 className="upper" style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 8 }}>
              {docsState.loading
                ? 'Documents -- loading...'
                : `Documents -- ${documents.length}`
              }
            </h2>
            {docsState.loading && (
              <div className="state">Loading<span className="blink">_</span></div>
            )}
            {docsState.error && (
              <div className="state err">Error: {docsState.error.message}</div>
            )}
            {!docsState.loading && !docsState.error && documents.length === 0 && (
              <div className="state dim">No documents match &ldquo;{submitted}&rdquo;.</div>
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
                  <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
                    {d.doc_type} &middot; {d.owner_name || 'unknown owner'}
                  </div>
                </Link>
              ))}
            </div>
          </section>

        </div>
      )}
    </div>
  );
}

// Sub-components

function SectionCard({ to, label, desc }) {
  return (
    <Link
      to={to}
      className="box"
      style={{
        textDecoration: 'none',
        color: 'inherit',
        display: 'block',
        padding: 14,
      }}
    >
      <div className="upper" style={{ fontSize: 11, marginBottom: 6 }}>{label}</div>
      <div className="dim" style={{ fontSize: 12, lineHeight: 1.6 }}>{desc}</div>
    </Link>
  );
}

function PersonResult({ person }) {
  const id = person.id;
  const source = person.table_source || person.tableSource || 'canonical_persons';
  const cls = person.verification_status || person.classification;
  return (
    <Link
      to={`/person/${source}/${id}`}
      className="box"
      style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
    >
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 500 }}>{person.name || person.full_name}</div>
        {cls && <span className={`badge ${cls}`}>{formatClass(cls)}</span>}
      </div>
      <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
        {person.type || person.person_type}
        {person.birth_year ? ` \u00b7 b.${person.birth_year}` : ''}
        {person.location ? ` \u00b7 ${person.location}` : ''}
        {person.source_url ? ` \u00b7 ${safeHostname(person.source_url)}` : ''}
      </div>
    </Link>
  );
}

function safeHostname(url) {
  try { return new URL(url, 'https://x').hostname; } catch { return ''; }
}
