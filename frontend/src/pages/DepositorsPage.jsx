import React, { useState } from 'react';
import { api } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';

export default function DepositorsPage() {
  const [query, setQuery] = useState('');
  const [branch, setBranch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchBranch, setSearchBranch] = useState('');

  const branchesState = useApi(() => api.getDepositorBranches(), []);
  const searchState = useApi(
    signal => (searchQuery || searchBranch)
      ? api.searchDepositors({ q: searchQuery, branch: searchBranch }, signal)
      : Promise.resolve({ depositors: [], total: 0 }),
    [searchQuery, searchBranch]
  );

  const branches = branchesState.data?.branches || [];
  const depositors = searchState.data?.depositors || [];
  const total = searchState.data?.total || 0;

  function handleSearch(e) {
    e.preventDefault();
    setSearchQuery(query);
    setSearchBranch(branch);
  }

  return (
    <div className="stack-xl">
      <div>
        <h2 className="upper" style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>
          Freedmen's Bank Depositors
        </h2>
        <p className="dim" style={{ fontSize: 13, marginBottom: 16 }}>
          Formerly enslaved persons who opened accounts at the Freedman's Savings Bank (1865–1874).
          Each record is extracted from FamilySearch Collection 1417695.
        </p>
      </div>

      {/* Branch stats */}
      <div className="box">
        <div className="box-label">Branches ({branches.reduce((s, b) => s + b.depositor_count, 0).toLocaleString()} depositors)</div>
        <div className="row-wrap">
          {branches.map(b => (
            <button
              key={b.branch}
              type="button"
              onClick={() => { setBranch(b.branch); setSearchBranch(b.branch); }}
              style={{
                borderColor: branch === b.branch ? 'var(--fg)' : 'var(--border)',
                color: branch === b.branch ? 'var(--fg)' : 'var(--dim)',
              }}
            >
              {b.branch} ({b.depositor_count.toLocaleString()})
            </button>
          ))}
          {branch && (
            <button
              type="button"
              onClick={() => { setBranch(''); setSearchBranch(''); }}
              style={{ borderColor: 'var(--border)', color: 'var(--dim)' }}
            >
              Clear filter
            </button>
          )}
        </div>
      </div>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="box">
        <div className="box-label">Search depositors</div>
        <div className="row" style={{ gap: 8 }}>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Name..."
            style={{ flex: 1 }}
          />
          <button type="submit">Search</button>
        </div>
      </form>

      {/* Results */}
      {(searchQuery || searchBranch) && (
        <section>
          <h2 className="upper" style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>
            Results ({total.toLocaleString()})
          </h2>
          {searchState.loading && <div className="state">Loading<span className="blink">_</span></div>}
          {searchState.error && <div className="state err">Error: {searchState.error.message}</div>}
          {!searchState.loading && depositors.length === 0 && (
            <div className="state">No depositors match your query.</div>
          )}
          <div className="stack">
            {depositors.map(d => <DepositorCard key={d.lead_id} depositor={d} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function DepositorCard({ depositor }) {
  const rels = depositor.family_members || [];
  const familyNames = rels.filter(r => r.type !== 'enslaved_by');
  const enslavers = rels.filter(r => r.type === 'enslaved_by');

  return (
    <div className="box">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 600 }}>{depositor.full_name}</div>
        <span className="badge enslaved_ancestor" style={{ fontSize: 11 }}>freedperson</span>
      </div>
      <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
        {depositor.branch || depositor.locations?.[0]}
        {depositor.context_text && ` · ${depositor.context_text.substring(0, 120)}`}
      </div>
      {familyNames.length > 0 && (
        <div style={{ fontSize: 12, marginTop: 6, color: 'var(--dim)' }}>
          Family: {familyNames.map(r => `${r.name} (${r.type})`).join(', ')}
        </div>
      )}
      {enslavers.length > 0 && (
        <div style={{ fontSize: 12, marginTop: 4, color: 'var(--accent, orange)' }}>
          Former enslaver: {enslavers.map(r => r.name).join(', ')}
        </div>
      )}
      {depositor.source_url && depositor.source_url.includes('ark:') && (
        <a
          href={depositor.source_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 11, marginTop: 4, display: 'inline-block' }}
        >
          View on FamilySearch →
        </a>
      )}
    </div>
  );
}
