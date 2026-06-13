/**
 * Internet Archive upload — the ONLY archival path, and it is gated.
 *
 * Every call runs assertArchivable(record) FIRST; a denial throws before any
 * network activity, so PII can never reach IA. Uses the IAS3 (S3-compatible) API
 * with append-only versioning (x-archive-keep-old-version:1) so superseded
 * source documents and reconciliation/model checkpoints are retained forever —
 * the temporal provenance ledger the calibration claim depends on.
 *
 * Inert until IA_S3_ACCESS_KEY / IA_S3_SECRET are set (get them at
 * archive.org/account/s3.php); the gate + tests are the Phase-0 deliverable and
 * are exercised independently of any live upload.
 */
import { assertArchivable } from './allowlist.mjs';

const IA_S3 = 'https://s3.us.archive.org';

function keys() {
  const access = process.env.IA_S3_ACCESS_KEY, secret = process.env.IA_S3_SECRET;
  if (!access || !secret) {
    const e = new Error('IA_S3_ACCESS_KEY / IA_S3_SECRET not configured — archival is inert until keys are set');
    e.code = 'IA_NO_KEYS';
    throw e;
  }
  return { access, secret };
}

// IA maps a double-hyphen in a meta name to an underscore (HTTP forbids "_").
const metaHeader = (k, v) => [`x-archive-meta-${k.replace(/_/g, '--')}`, String(v)];

/**
 * Gate-checked upload of one historical artifact to a new/existing IA item.
 * @param {object} record  - passed to the allowlist gate (sourceTable, documentType, years, ...)
 * @param {string} identifier - IA item id (deterministic, e.g. `repram-doc-${person_document_id}`)
 * @param {string} filename
 * @param {Buffer|Uint8Array} body
 * @param {object} metadata - {collection, mediatype, title, source_url, external_identifier, ...}
 * @param {object} [opts] - {dryRun:boolean}
 * @returns {Promise<{identifier, item_url, download_url, dryRun?:boolean}>}
 */
export async function uploadHistoricalDocument(record, identifier, filename, body, metadata = {}, opts = {}) {
  assertArchivable(record); // FAIL CLOSED — throws on any PII/living/unknown record

  const item_url = `https://archive.org/details/${identifier}`;
  const download_url = `https://archive.org/download/${identifier}/${filename}`;
  if (opts.dryRun) return { identifier, item_url, download_url, dryRun: true };

  const { access, secret } = keys();
  const headers = {
    Authorization: `LOW ${access}:${secret}`,
    'x-archive-auto-make-bucket': '1',
    'x-archive-keep-old-version': '1', // append-only provenance ledger
    'x-archive-meta-mediatype': metadata.mediatype || 'texts',
    'x-archive-meta-collection': metadata.collection || 'opensource',
  };
  for (const k of ['title', 'source_url', 'external_identifier', 'date', 'creator', 'description', 'licenseurl']) {
    if (metadata[k] != null) { const [hk, hv] = metaHeader(k, metadata[k]); headers[hk] = hv; }
  }
  const res = await fetch(`${IA_S3}/${encodeURIComponent(identifier)}/${encodeURIComponent(filename)}`, {
    method: 'PUT', headers, body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`IA upload failed ${res.status}: ${t.slice(0, 300)}`);
  }
  return { identifier, item_url, download_url };
}

/** Pre-flight the IAS3 rate limit before a bulk run. */
export async function checkRateLimit(identifier) {
  const { access } = keys();
  const res = await fetch(`${IA_S3}/?check_limit=1&accesskey=${access}&bucket=${encodeURIComponent(identifier)}`);
  return res.json();
}

export { assertArchivable, checkArchivable } from './allowlist.mjs';
