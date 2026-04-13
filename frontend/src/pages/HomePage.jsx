import React from 'react';
import { Link } from 'react-router-dom';
import { SearchBar } from '../components/Search/SearchBar.jsx';

export default function HomePage() {
  return (
    <div className="stack-xl">
      <section>
        <SearchBar autoFocus />
        <div className="dim" style={{ marginTop: 8, fontSize: 12 }}>
          Search across verified slaveholders, enslaved persons, corporate debtors, and legal precedents.
          Unverified data is never displayed here — human review is required before any record appears.
        </div>
      </section>

      <section className="grid-2">
        <Tile
          to="/lineage"
          title="Lineage visualization"
          body="Zoomable graph of all verified ownership lineages, side by side. Each lineage is a participant's traced ancestry from a confirmed slaveholder down to the present."
        />
        <Tile
          to="/documents"
          title="Historical documents"
          body="Primary sources — wills, bills of sale, slave schedules, freedmen's bureau records, plantation papers. Every record here has a documented ARK."
        />
        <Tile
          to="/corporate"
          title="Corporate debts"
          body="17 Farmer-Paellmann defendants and their succession chains. Insurance underwriters, banks, railroads whose wealth traces directly to slave labor."
        />
        <Tile
          to="/legal"
          title="Legal framework"
          body="Triangle Trade jurisdictions. UK 1833 compensation loan (repaid 2015 — 182-year debt enforcement). Haiti independence debt as counter-precedent. Farmer-Paellmann strategic lessons."
        />
        <Tile
          to="/search"
          title="Search"
          body="Full-text search across canonical persons, enslaved individuals, corporate entities, and legal precedents. Verified-only by default."
        />
        <Tile
          to="/pay"
          title="Payment"
          body="Connect MetaMask. Submit a Debt Acknowledgment Agreement on-chain. Make a USDC or ETH payment toward reparations escrow."
        />
      </section>

      <section>
        <h2 className="upper" style={{ fontSize: 14, marginBottom: 8 }}>The three audiences</h2>
        <div className="stack dim" style={{ fontSize: 13 }}>
          <div><span className="fg" style={{ color: 'var(--fg)' }}>Descendants of slaveholders</span> who completed intake: receive a DAA and payment page (via admin).</div>
          <div><span style={{ color: 'var(--fg)' }}>Descendants of enslaved people</span> who want to clearly traverse all verified data: this page is for you.</div>
          <div><span style={{ color: 'var(--fg)' }}>Expert collaborators</span> — genealogists, economists, lawyers, historians: the source is on GitHub. Collaborate line by line.</div>
        </div>
      </section>
    </div>
  );
}

function Tile({ to, title, body }) {
  return (
    <Link to={to} className="box" style={{
      textDecoration: 'none',
      color: 'inherit',
      display: 'block',
      padding: 16,
    }}>
      <div className="upper" style={{ fontSize: 12, color: 'var(--dim)' }}>{title}</div>
      <div style={{ marginTop: 6, fontSize: 13 }}>{body}</div>
    </Link>
  );
}
