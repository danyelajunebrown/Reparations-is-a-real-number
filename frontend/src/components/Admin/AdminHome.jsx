import React from 'react';
import { Link } from 'react-router-dom';

export function AdminHome() {
  return (
    <div className="stack-lg">
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 'normal' }}>Admin</h1>
        <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
          Every match on the public site has been human-reviewed here first.
          This is also where DAA generation and payment hand-off to participants happens.
        </div>
      </div>
      <div className="grid-2">
        <Tile to="/admin/review" title="Review queue" body="Approve or reject pending match candidates. The public site shows only items that pass through here." />
        <Tile to="/admin/quality" title="Data quality" body="Garbage rate, confidence distribution, source breakdown. Bulk fix operations for low-confidence records." />
        <Tile to="/admin/participants" title="Participants" body="View all participants from intake, their climb sessions, match counts, DAA status, payment status." />
      </div>
      <div className="box warn" style={{ fontSize: 12 }}>
        <strong>Pre-premiere checklist:</strong>
        <ul style={{ marginTop: 8, paddingLeft: 20 }}>
          <li>Admin must be behind an auth gate before May 8.</li>
          <li>Review queue must be emptied of unverified data before the public site launches.</li>
          <li>DAA documents must be generated and reviewed for all intake participants.</li>
          <li>Blockchain wiring must accept at least one USDC payment on Base mainnet.</li>
        </ul>
      </div>
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
