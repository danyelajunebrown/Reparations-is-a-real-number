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
    // SPN returns the snapshot path in Content-Location, or a redirect Location.
    const loc = res.headers.get('content-location') || res.headers.get('location');
    if (loc) {
      return loc.startsWith('http') ? loc : `https://web.archive.org${loc}`;
    }
    // Some responses embed the snapshot in the body; try a /web/<ts>/ extraction.
    const body = await res.text().catch(() => '');
    const m = body.match(/\/web\/\d{14}\/[^\s"']+/);
    return m ? `https://web.archive.org${m[0]}` : null;
  } catch { return null; }
}

/** Best-effort: return a fresh capture, else the closest existing snapshot, else
 *  null. Never throws. */
export async function ensureSnapshot(url, opts = {}) {
  const fresh = await saveToWayback(url, opts);
  if (fresh) return fresh;
  return await getClosestSnapshot(url, opts);
}
