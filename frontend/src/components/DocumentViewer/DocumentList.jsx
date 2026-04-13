import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { SearchBar } from '../Search/SearchBar.jsx';

/**
 * DocumentList — landing for /documents. Since we don't have a "browse all
 * documents" endpoint (search is owner-based), this primarily points users
 * at the search bar.
 */
export function DocumentList() {
  return (
    <div className="stack-xl">
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 'normal' }}>Historical documents</h1>
        <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
          Wills, bills of sale, slave schedules, freedmen's bureau records, plantation papers.
          Every record displayed has a documented ARK identifier or primary source URL.
        </div>
      </div>

      <SearchBar />

      <div className="box dim" style={{ fontSize: 12 }}>
        Enter an owner name above to find all documents associated with them.
        A full browse view is admin-only (see <Link to="/admin/quality">Data quality</Link>).
      </div>
    </div>
  );
}
