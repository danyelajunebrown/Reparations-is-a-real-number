import React, { useState } from 'react';
import { api } from '../../api/client.js';
import { useApi, useAsyncAction } from '../../hooks/useApi.js';
import { formatClass, CLASS_LABELS, CLASS_DESCRIPTIONS } from '../../api/format.js';

/**
 * ReviewQueue — human review workflow for match candidates.
 * Admin sees ALL items including unverified/suspect ones. The public site
 * only shows items approved here.
 */
export function ReviewQueue() {
  const [refreshKey, setRefreshKey] = useState(0);
  const reviewState = useApi(() => api.getReviewQueue(), [refreshKey]);
  const pendingState = useApi(() => api.getPendingVerification(), [refreshKey]);

  const [approve, approveState] = useAsyncAction(async (id, full_name) => {
    const result = await api.approveReview(id, full_name);
    setRefreshKey(k => k + 1);
    return result;
  });

  const [reject, rejectState] = useAsyncAction(async (id, reason) => {
    const result = await api.rejectReview(id, reason);
    setRefreshKey(k => k + 1);
    return result;
  });

  const items = reviewState.data?.items || reviewState.data?.queue || [];
  const pending = pendingState.data?.matches || [];

  return (
    <div className="stack-xl">
      <header>
        <h1 style={{ fontSize: 20, fontWeight: 'normal' }}>Review queue</h1>
        <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
          Everything here is blocked from the public site until it's approved.
        </div>
      </header>

      <section>
        <h2 className="upper" style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>
          Name review queue ({items.length})
        </h2>
        {reviewState.loading && <div className="state">Loading<span className="blink">_</span></div>}
        {reviewState.error && <div className="state err">{reviewState.error.message}</div>}
        <div className="stack">
          {items.map(item => (
            <ReviewItem
              key={item.id}
              item={item}
              onApprove={(fullName) => approve(item.id, fullName)}
              onReject={(reason) => reject(item.id, reason)}
              busy={approveState.loading || rejectState.loading}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="upper" style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>
          Match verification pending ({pending.length})
        </h2>
        <div className="dim" style={{ fontSize: 11, marginBottom: 8 }}>
          Matches from ancestor climbs awaiting human classification. These are
          the records that appear on the public lineage graph once approved.
        </div>
        {pendingState.loading && <div className="state">Loading<span className="blink">_</span></div>}
        {pendingState.error && <div className="state err">{pendingState.error.message}</div>}
        <div className="stack">
          {pending.map(m => <PendingMatch key={m.id} match={m} />)}
        </div>
      </section>
    </div>
  );
}

function ReviewItem({ item, onApprove, onReject, busy }) {
  const [editedName, setEditedName] = useState(item.full_name || item.name || '');
  const [reason, setReason] = useState('');

  return (
    <div className="box stack">
      <div>
        <div>{item.full_name || item.name}</div>
        <div className="dim" style={{ fontSize: 12 }}>
          {item.source_url && <a href={item.source_url} target="_blank" rel="noopener noreferrer">source</a>}
          {item.context_text && ` · ${item.context_text.slice(0, 120)}...`}
        </div>
      </div>
      <input
        type="text"
        value={editedName}
        onChange={e => setEditedName(e.target.value)}
      />
      <div className="row-wrap">
        <button type="button" onClick={() => onApprove(editedName)} disabled={busy}>
          Approve
        </button>
        <input
          type="text"
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="rejection reason"
          style={{ flex: 1 }}
        />
        <button type="button" onClick={() => onReject(reason)} disabled={busy || !reason}>
          Reject
        </button>
      </div>
    </div>
  );
}

function PendingMatch({ match }) {
  const cls = match.verification_status;
  return (
    <div className="box">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>{match.slaveholder_name || match.full_name}</div>
        {cls && <span className={`badge ${cls}`}>{formatClass(cls)}</span>}
      </div>
      <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
        {CLASS_DESCRIPTIONS[cls] || 'No classification'}
        {match.confidence_adjusted != null && ` · confidence ${(match.confidence_adjusted * 100).toFixed(0)}%`}
      </div>
      {match.review_reason && (
        <div className="warn" style={{ fontSize: 11, marginTop: 4 }}>
          Review reason: {match.review_reason}
        </div>
      )}
    </div>
  );
}
