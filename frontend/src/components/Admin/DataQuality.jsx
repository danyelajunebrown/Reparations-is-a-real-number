import React from 'react';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { formatInt, formatPct } from '../../api/format.js';

export function DataQuality() {
  const { data, loading, error } = useApi(() => api.getDataQualityMetrics(), []);

  if (loading) return <div className="state">Loading<span className="blink">_</span></div>;
  if (error) return <div className="state err">{error.message}</div>;

  const m = data?.metrics || data || {};

  return (
    <div className="stack-xl">
      <h1 style={{ fontSize: 20, fontWeight: 'normal' }}>Data quality</h1>
      <div className="grid-4">
        <Metric label="Clean records" value={formatInt(m.clean_records)} />
        <Metric label="Garbage rate" value={formatPct(m.garbage_rate)} target="<5%" />
        <Metric label="Avg confidence" value={formatPct(m.avg_confidence)} target=">70%" />
        <Metric label="Owner linkage" value={formatPct(m.owner_linkage_rate)} />
      </div>
      <pre className="box" style={{ fontSize: 11, whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: '60vh' }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

function Metric({ label, value, target }) {
  return (
    <div className="box">
      <div className="box-label">{label}</div>
      <div style={{ fontSize: 18 }}>{value}</div>
      {target && <div className="dim" style={{ fontSize: 11 }}>target: {target}</div>}
    </div>
  );
}
