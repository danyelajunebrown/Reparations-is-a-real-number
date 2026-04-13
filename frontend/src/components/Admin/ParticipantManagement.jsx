import React from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';

/**
 * ParticipantManagement — view all intake-form participants with their
 * climb sessions, match counts, DAA status, and payment status.
 *
 * Depends on the `participants` table (migration 036). The /api/participants
 * endpoint does not exist yet in server.js — this component is stubbed against
 * /api/ancestor-climb/sessions and degrades gracefully if a dedicated
 * participants endpoint is missing.
 */
export function ParticipantManagement() {
  const { data, loading, error } = useApi(() => api.listClimbSessions(), []);

  if (loading) return <div className="state">Loading<span className="blink">_</span></div>;
  if (error) return <div className="state err">{error.message}</div>;

  // /api/ancestor-climb/sessions returns { success, count, sessions: [...] }
  // with rows from ancestor_climb_sessions including:
  //   id, modern_person_name, modern_person_fs_id, status,
  //   started_at, last_activity, ancestors_visited, matches_found
  const sessions = data?.sessions || [];

  // Group sessions by participant (fs_id or name)
  const byParticipant = {};
  for (const s of sessions) {
    const key = s.modern_person_fs_id || s.modern_person_name || s.id;
    if (!byParticipant[key]) byParticipant[key] = { key, name: s.modern_person_name, sessions: [] };
    byParticipant[key].sessions.push(s);
  }

  const participants = Object.values(byParticipant);

  return (
    <div className="stack-xl">
      <header>
        <h1 style={{ fontSize: 20, fontWeight: 'normal' }}>Participants ({participants.length})</h1>
        <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
          Grouped by participant identity where available. Multiple climbs per
          participant (e.g., 4 grandparent climbs) appear together.
        </div>
      </header>

      <div className="stack">
        {participants.map(p => (
          <div key={p.key} className="box">
            <div>{p.name || p.key}</div>
            <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
              {p.sessions.length} climb {p.sessions.length === 1 ? 'session' : 'sessions'}
            </div>
            <div className="stack" style={{ marginTop: 8 }}>
              {p.sessions.map(s => (
                <div key={s.id} className="row" style={{ fontSize: 12, gap: 12 }}>
                  <Link to={`/lineage/${s.id}`}>{String(s.id).slice(0, 8)}</Link>
                  <span className="dim">
                    {s.ancestors_visited || 0} visited · {s.matches_found || 0} matches ·
                    status: {s.status || '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
