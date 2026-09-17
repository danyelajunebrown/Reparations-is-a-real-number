/**
 * Internet Archive / Wayback Machine helper — snapshot a source URL for durable
 * provenance backup, and look up the closest existing snapshot.
 *
 * Used by bulk-source ingest (e.g. scripts/ingest-slavevoyages-past.mjs) to record
 * a wayback_url in source_artifacts alongside our own S3 re-host. For files we are
 * licensed to host, our S3 is primary and this is the backup; for link/Wayback-only
 * sources (third-party rights), this snapshot is the canonical reference.
 *
 * Unauthenticated Save-Page-Now (https://web.archive.org/save/<url>) is rate-limited
 * (~a handful/min) — fine at our per-dataset volume. Everything fails SOFT: a null
 * return must never block an ingest, since archiving is provenance, not business logic.
 *
 *   import { saveToWayback, getClosestSnapshot, ensureSnapshot } from './lib/wayback.mjs';
 *   const snap = await ensureSnapshot('https://www.slavevoyages.org/past/database');
 */

const UA = 'reparations-is-a-real-number/archive-bot (provenance snapshot)';

/** Look up the closest existing Wayback snapshot for a URL. Returns the snapshot
 *  URL string, or null if none / on error. */
export async function getClosestSnapshot(url, { timeoutMs = 15000 } = {}) {
  try {
    const api = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
    const res = await fetch(api, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const j = await res.json();
    const snap = j?.archived_snapshots?.closest;
    return snap?.available && snap.url ? snap.url.replace(/^http:/, 'https:') : null;
  } catch { return null; }
}

/** Trigger a fresh Save-Page-Now capture. Returns the snapshot URL (from the
 *  Content-Location / redirect Location header), or null on failure/timeout. */
export async function saveToWayback(url, { timeoutMs = 60000 } = {}) {
  try {
    const res = await fetch(`https://web.archive.org/save/${url}`, {
      method: 'GET',
      headers: { 'User-Agent': UA },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    // THROTTLING IS NOT ABSENCE. Save Page Now rate-limits anonymous callers to roughly one capture per
    // minute and answers with HTTP 500 (not 429) plus `x-location: save-sync` when you exceed it. This
    // function used to swallow that and return null, so a throttled call and "this page cannot be
    // archived" were indistinguishable — which is how 4,560 archived scans ended up with no Wayback URL
    // while every log said the run succeeded. Same family as the caught 403 that let an OCR pass
    // transcribe a login form. Throttling now THROWS so callers can back off instead of burning the
    // backlog against a closed door.
    if (res.status === 429 || (res.status >= 500 && res.headers.get('x-location') === 'save-sync')) {
      const e = new Error(`wayback throttled (http ${res.status}, x-rl=${res.headers.get('x-rl')})`);
      e.throttled = true;
      throw e;
    }
    const loc = res.headers.get('content-location') || res.headers.get('location');
    if (loc) return loc.startsWith('http') ? loc : `https://web.archive.org${loc}`;
    const body = await res.text().catch(() => '');
    const m = body.match(/\/web\/\d{14}\/[^\s"']+/);
    return m ? `https://web.archive.org${m[0]}` : null;
  } catch (e) {
    if (e && e.throttled) throw e;      // propagate throttling; swallow only genuine failures
    return null;
  }
}

/** Best-effort: return a fresh capture, else the closest existing snapshot, else
 *  null. Never throws. */
export async function ensureSnapshot(url, opts = {}) {
  // Prefer an EXISTING snapshot before asking for a new capture: the CDX lookup is cheap and unthrottled,
  // while SPN is ~1/minute. Checking first means a backlog of already-archived URLs costs nothing.
  const existing = await getClosestSnapshot(url, opts).catch(() => null);
  if (existing) return existing;
  return await saveToWayback(url, opts);   // may THROW {throttled:true} — callers should back off
}
