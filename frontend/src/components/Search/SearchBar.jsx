import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

// onSearch: optional callback. When provided, calls onSearch(query) instead of navigating.
// Used by HomePage for inline results. SearchPage and header omit it (defaults to navigate).
export function SearchBar({ autoFocus = false, onSearch = null }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') || '');

  function onSubmit(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    if (onSearch) {
      onSearch(q);
    } else {
      navigate(`/search?q=${encodeURIComponent(q)}`);
    }
  }

  return (
    <form onSubmit={onSubmit} className="row">
      <input
        type="text"
        placeholder="search by name, person ID (#1170), location, source..."
        value={query}
        onChange={e => setQuery(e.target.value)}
        autoFocus={autoFocus}
        style={{ flex: 1 }}
      />
      <button type="submit" disabled={!query.trim()}>Search</button>
    </form>
  );
}
