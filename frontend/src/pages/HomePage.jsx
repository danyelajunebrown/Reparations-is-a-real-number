import React from 'react';
import { Link } from 'react-router-dom';
import { SearchBar } from '../components/Search/SearchBar.jsx';
import { api } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { formatNumber } from '../api/format.js';

export default function HomePage() {
  const statsState = useApi(() => api.stats(), []);
  const branchesState = useApi(() => api.getDepositorBranches(), []);

  const stats = statsState.data?.stats || {};
  const branches = branchesState.data?.branches || [];
  const totalDepositors = branches.reduce((s, b) => s + (b.depositor_count || 0), 0);

  return (
    <div className="stack-xl">

      {/* ── Live stats ── */}
      <section>
        <div className="stats-ribbon" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
        }}>
          <StatBox label="Total records"     value={stats.total_records}  loading={statsState.loading}    error={statsState.error} />
          <StatBox label="Slaveholders"      value={stats.slaveholders}   loading={statsState.loading}    error={statsState.error} />
          <StatBox label="Enslaved persons"  value={stats.enslaved}       loading={statsState.loading}    error={statsState.error} />
          <StatBox
            label="Freedmen's Bank depositors"
            value={totalDepositors || null}
            loading={branchesState.loading}
            error={branchesState.error}
          />
        </div>
      </section>

      {/* ── Search ── */}
      <section>
        <SearchBar autoFocus />
        <div className="dim" style={{ marginTop: 8, fontSize: 12 }}>
          Search verified slaveholders, enslaved persons, corporate debtors, and legal precedents.
          Human review is required before any record appears here.
        </div>
      </section>

      {/* ── Featured dataset: Freedmen's Bank ── */}
      <section className="box" style={{ padding: 20 }}>
        <div className="upper" style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 8 }}>
          Featured dataset
        </div>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Freedmen's Bank Depositors</div>
        <div className="dim" style={{ fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
          Formerly enslaved persons who opened accounts at the Freedman's Savings Bank (1865–1874).
          29 branches. Every record linked to its FamilySearch ARK.
        </div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <Link to="/depositors" className="box" style={{
            padding: '8px 16px',
            textDecoration: 'none',
            color: 'inherit',
            fontSize: 13,
          }}>
            Search depositors →
          </Link>
          <Link to="/depositors" className="box" style={{
            padding: '8px 16px',
            textDecoration: 'none',
            color: 'inherit',
            fontSize: 13,
          }}>
            Browse by branch →
          </Link>
        </div>
      </section>

      {/* ── Three paths ── */}
      <section>
        <h2 className="upper" style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 16 }}>
          Who this is for
        </h2>
        <div className="grid-2" style={{ gap: 12 }}>

          <PathCard
            title="Descendants of enslaved people"
            body="Search the Freedmen's Bank. Trace ancestry through verified lineage graphs. View primary source documents with documented ARKs."
            links={[
              { to: '/depositors', label: 'Freedmen\'s Bank' },
              { to: '/lineage',    label: 'Lineage graphs' },
              { to: '/documents',  label: 'Documents' },
            ]}
          />

          <PathCard
            title="Descendants of slaveholders"
            body="Complete a Debt Acknowledgment Agreement. Submit payment toward reparations escrow via blockchain."
            links={[
              {
                href: 'https://docs.google.com/forms/d/e/1FAIpQLScIek-qQmGj7esA3spu6zclP2VvU8cZwWbLmDMJ0GJjSCX_BA/viewform?usp=dialog',
                label: 'Open intake form ↗',
                external: true,
              },
              { to: '/pay', label: 'Payment' },
            ]}
          />

          <PathCard
            title="Researchers and collaborators"
            body="Corporate debt chains. Legal framework spanning three jurisdictions. Primary sources. Every line of code is open."
            links={[
              { to: '/corporate', label: 'Corporate debts' },
              { to: '/legal',     label: 'Legal framework' },
              { to: '/documents', label: 'Primary sources' },
              {
                href: 'https://github.com/danyelajunebrown/Reparations-is-a-real-number',
                label: 'GitHub ↗',
                external: true,
              },
            ]}
          />

          <PathCard
            title="All verified data"
            body="Full-text search across canonical persons, enslaved individuals, corporate entities, and legal precedents. Verified-only by default."
            links={[
              { to: '/search',   label: 'Search' },
              { to: '/lineage',  label: 'Lineages' },
              { to: '/corporate',label: 'Corporate' },
            ]}
          />

        </div>
      </section>

    </div>
  );
}

function StatBox({ label, value, loading, error }) {
  let display;
  if (error)   display = <span className="dim">—</span>;
  else if (loading) display = <span className="dim blink">...</span>;
  else         display = formatNumber(value);
  return (
    <div className="box" style={{ padding: 12 }}>
      <div className="box-label" style={{ fontSize: 11 }}>{label}</div>
      <div style={{ fontSize: 20, marginTop: 4 }}>{display}</div>
    </div>
  );
}

function PathCard({ title, body, links }) {
  return (
    <div className="box" style={{ padding: 16 }}>
      <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>{title}</div>
      <div className="dim" style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>{body}</div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {links.map(({ to, href, label, external }) =>
          external ? (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 12, color: 'var(--dim)' }}
            >
              {label}
            </a>
          ) : (
            <Link
              key={label}
              to={to}
              style={{ fontSize: 12, color: 'var(--dim)', textDecoration: 'none' }}
            >
              {label}
            </Link>
          )
        )}
      </div>
    </div>
  );
}
