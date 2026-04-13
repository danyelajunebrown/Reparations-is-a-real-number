import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export function SearchBar({ autoFocus = false }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') || '');

  function onSubmit(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    navigate(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <form onSubmit={onSubmit} className="row">
      <input
        type="text"
        placeholder="search by name, location, source, entity..."
        value={query}
        onChange={e => setQuery(e.target.value)}
        autoFocus={autoFocus}
        style={{ flex: 1 }}
      />
      <button type="submit" disabled={!query.trim()}>Search</button>
    </form>
  );
}
