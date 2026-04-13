import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { useNavigate } from 'react-router-dom';
import { api, isVerified, VERIFIED_CLASSES } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { CLASS_LABELS } from '../../api/format.js';

/**
 * LineageGraph — the primary data visualization.
 *
 * Vision: every ancestor_climb_session that produced verified matches becomes
 * one lineage "column". Zoom out = all lineages visible side by side. Zoom in
 * = individual chain from a confirmed slaveholder down through generations.
 *
 * Data sources (verified-only):
 *   - /api/ancestor-climb/sessions → list of sessions
 *   - /api/ancestor-climb/session/:id → session detail with matches
 * Each match is filtered through isVerified() before rendering — unverified
 * classifications (temporal_impossible, common_name_suspect, ambiguous) are
 * excluded entirely from this view.
 *
 * Rendered as SVG with d3-zoom. Columns are stacked horizontally; each
 * column is a simple top-down tree of generations with the participant at
 * the bottom and confirmed slaveholders at the top.
 */
export function LineageGraph({ focusSessionId }) {
  const { data: sessionsData, loading, error } = useApi(() => api.listClimbSessions(), []);
  const sessions = sessionsData?.sessions || sessionsData || [];

  // Fetch detail for each session (limit to avoid hammering the API)
  const [details, setDetails] = useState({});
  const [detailErrors, setDetailErrors] = useState({});

  useEffect(() => {
    if (!Array.isArray(sessions) || sessions.length === 0) return;
    let cancelled = false;
    const toFetch = sessions.slice(0, 30);
    (async () => {
      for (const s of toFetch) {
        if (cancelled) return;
        const id = s.id || s.session_id;
        if (!id || details[id]) continue;
        try {
          const d = await api.getClimbSession(id);
          if (!cancelled) setDetails(prev => ({ ...prev, [id]: d }));
        } catch (err) {
          if (!cancelled) setDetailErrors(prev => ({ ...prev, [id]: err.message }));
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.length]);

  const lineages = useMemo(() => buildLineages(sessions, details), [sessions, details]);

  if (loading) return <div className="state">Loading sessions<span className="blink">_</span></div>;
  if (error) return <div className="state err">Error: {error.message}</div>;
  if (!lineages.length) {
    return (
      <div className="state">
        No verified lineages to display yet. Lineages appear here once an
        ancestor climb produces at least one human-reviewed, confirmed match.
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <div className="box">
        <div className="box-label">Lineage graph</div>
        <div style={{ fontSize: 12 }}>
          {lineages.length} verified {lineages.length === 1 ? 'lineage' : 'lineages'}.
          Scroll to zoom. Click and drag to pan. Click any node to view the person.
        </div>
      </div>

      <LineageSVG lineages={lineages} focusSessionId={focusSessionId} />

      <Legend />
    </div>
  );
}

// --- Data shaping -----------------------------------------------------------

function buildLineages(sessions, details) {
  const out = [];
  for (const s of sessions || []) {
    const id = s.id || s.session_id;
    const detail = details[id];
    if (!detail) continue;
    // Per src/api/routes/ancestor-climb.js, /session/:id returns
    //   { success, session: {...}, matches: [...] }
    // with matches at the TOP level (not nested under session).
    const rawMatches = detail.matches || [];
    const matches = rawMatches.filter(m => isVerified(m));
    if (matches.length === 0) continue;
    out.push({
      id,
      participant:
        detail.session?.modern_person_name ||
        s.modern_person_name ||
        detail.modern_person_name ||
        id,
      matches,
    });
  }
  return out;
}

// --- SVG rendering ----------------------------------------------------------

const COL_WIDTH = 180;
const ROW_HEIGHT = 60;
const NODE_R = 6;

function LineageSVG({ lineages, focusSessionId }) {
  const svgRef = useRef(null);
  const gRef = useRef(null);
  const navigate = useNavigate();

  // Layout
  const layout = useMemo(() => {
    const positioned = lineages.map((lin, colIdx) => {
      const sorted = [...lin.matches].sort(
        (a, b) => (a.generation_distance || 0) - (b.generation_distance || 0)
      );
      const nodes = sorted.map((m, rowIdx) => ({
        id: `${lin.id}-${m.id || rowIdx}`,
        lineageId: lin.id,
        x: colIdx * COL_WIDTH + COL_WIDTH / 2,
        y: rowIdx * ROW_HEIGHT + ROW_HEIGHT,
        match: m,
      }));
      // Participant node at bottom
      const participantNode = {
        id: `${lin.id}-participant`,
        lineageId: lin.id,
        x: colIdx * COL_WIDTH + COL_WIDTH / 2,
        y: (sorted.length + 1) * ROW_HEIGHT,
        isParticipant: true,
        label: lin.participant,
      };
      return { lineage: lin, nodes, participantNode };
    });
    const width = Math.max(positioned.length * COL_WIDTH, 800);
    const height = Math.max(
      ...positioned.map(p => (p.nodes.length + 2) * ROW_HEIGHT),
      400
    );
    return { positioned, width, height };
  }, [lineages]);

  // Zoom + pan
  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;
    const svg = d3.select(svgRef.current);
    const g = d3.select(gRef.current);
    const zoom = d3.zoom()
      .scaleExtent([0.05, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });
    svg.call(zoom);

    // Initial view: fit content
    const bbox = gRef.current.getBBox();
    const padding = 40;
    const clientW = svgRef.current.clientWidth || 1000;
    const clientH = svgRef.current.clientHeight || 600;
    const scale = Math.min(
      (clientW - padding * 2) / bbox.width,
      (clientH - padding * 2) / bbox.height,
      1
    );
    const tx = (clientW - bbox.width * scale) / 2 - bbox.x * scale;
    const ty = (clientH - bbox.height * scale) / 2 - bbox.y * scale;
    svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));

    return () => svg.on('.zoom', null);
  }, [layout]);

  return (
    <svg
      ref={svgRef}
      style={{
        width: '100%',
        height: '70vh',
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        cursor: 'grab',
      }}
    >
      <g ref={gRef}>
        {layout.positioned.map(col => (
          <LineageColumn
            key={col.lineage.id}
            col={col}
            focused={focusSessionId === col.lineage.id}
            onNodeClick={(node) => {
              if (node.isParticipant) return;
              const src = node.match.table_source || 'canonical_persons';
              navigate(`/person/${src}/${node.match.id}`);
            }}
          />
        ))}
      </g>
    </svg>
  );
}

function LineageColumn({ col, focused, onNodeClick }) {
  const { nodes, participantNode, lineage } = col;
  return (
    <g opacity={focused || !focused ? 1 : 0.4}>
      {/* Chain lines */}
      {nodes.map((n, i) => {
        const next = i < nodes.length - 1 ? nodes[i + 1] : participantNode;
        return (
          <line
            key={`line-${n.id}`}
            x1={n.x} y1={n.y}
            x2={next.x} y2={next.y}
            stroke="var(--border)"
            strokeWidth={1}
          />
        );
      })}

      {/* Column label (participant name) at the top */}
      <text
        x={nodes[0]?.x || participantNode.x}
        y={20}
        fill="var(--dim)"
        fontFamily="var(--font-mono)"
        fontSize="11"
        textAnchor="middle"
      >
        {lineage.participant}
      </text>

      {/* Match nodes */}
      {nodes.map(n => {
        // ancestor_climb_matches column names from src/api/routes/ancestor-climb.js
        //   verification_status | classification — either may be populated
        //   slaveholder_name, slaveholder_birth_year, generation_distance
        const cls = n.match.verification_status || n.match.classification;
        const color = classColor(cls);
        const name = n.match.slaveholder_name || n.match.full_name || 'unknown';
        const birth = n.match.slaveholder_birth_year || n.match.birth_year;
        return (
          <g
            key={n.id}
            transform={`translate(${n.x},${n.y})`}
            style={{ cursor: 'pointer' }}
            onClick={() => onNodeClick(n)}
          >
            <circle r={NODE_R} fill={color} />
            <text
              x={NODE_R + 4}
              y={3}
              fill="var(--fg)"
              fontFamily="var(--font-mono)"
              fontSize="10"
            >
              {truncate(name, 18)}
            </text>
            {birth && (
              <text
                x={NODE_R + 4}
                y={14}
                fill="var(--dim)"
                fontFamily="var(--font-mono)"
                fontSize="9"
              >
                b.{birth} · gen {n.match.generation_distance || '?'}
              </text>
            )}
          </g>
        );
      })}

      {/* Participant at bottom */}
      <g transform={`translate(${participantNode.x},${participantNode.y})`}>
        <rect x={-NODE_R} y={-NODE_R} width={NODE_R * 2} height={NODE_R * 2} fill="var(--fg)" />
        <text
          x={NODE_R + 4}
          y={3}
          fill="var(--fg)"
          fontFamily="var(--font-mono)"
          fontSize="10"
        >
          {truncate(participantNode.label, 18)}
        </text>
      </g>
    </g>
  );
}

function classColor(cls) {
  switch (cls) {
    case 'confirmed_slaveholder': return 'var(--cls-confirmed)';
    case 'enslaved_ancestor': return 'var(--cls-enslaved-ancestor)';
    case 'free_poc': return 'var(--cls-free-poc)';
    case 'free_poc_slaveholder': return 'var(--cls-free-poc-slaveholder)';
    default: return 'var(--dim)';
  }
}

function truncate(str, n) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function Legend() {
  const classes = [...VERIFIED_CLASSES];
  return (
    <div className="box">
      <div className="box-label">Legend</div>
      <div className="row-wrap" style={{ fontSize: 11 }}>
        {classes.map(cls => (
          <div key={cls} className="row" style={{ gap: 6 }}>
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                background: classColor(cls),
              }}
            />
            <span>{CLASS_LABELS[cls]}</span>
          </div>
        ))}
        <div className="row" style={{ gap: 6 }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--fg)' }} />
          <span>Participant (present day)</span>
        </div>
      </div>
    </div>
  );
}
