import React from 'react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { formatNumber } from '../../api/format.js';

export function StatsRibbon() {
  const { data, loading, error } = useApi(() => api.stats(), []);

  const stats = data?.stats || {};

  return (
    <div className="stats-ribbon" style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: 12,
      marginTop: 16,
      paddingTop: 12,
      borderTop: '1px solid var(--border)',
    }}>
      <Stat label="Total records" value={stats.total_records} loading={loading} error={error} />
      <Stat label="Slaveholders" value={stats.slaveholders} loading={loading} error={error} />
      <Stat label="Enslaved persons" value={stats.enslaved} loading={loading} error={error} />
      <Stat label="Unique sources" value={stats.unique_sources} loading={loading} error={error} />
    </div>
  );
}

function Stat({ label, value, loading, error }) {
  let display;
  if (error) display = <span className="err">ERR</span>;
  else if (loading) display = <span className="dim blink">...</span>;
  else display = formatNumber(value);
  return (
    <div className="box" style={{ padding: 8 }}>
      <div className="box-label">{label}</div>
      <div style={{ fontSize: 18 }}>{display}</div>
    </div>
  );
}
