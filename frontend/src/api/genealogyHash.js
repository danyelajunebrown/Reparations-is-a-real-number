/**
 * genealogyHash — content hash for ReparationsEscrow.submitAncestryRecord
 *
 * The contract takes a `bytes32 _genealogyHash` parameter intended to commit
 * to the off-chain genealogy proof (the lineage tree, source documents, match
 * verification evidence). The original design called for IPFS: pin the proof
 * JSON, take the IPFS CID, and store its hash on-chain.
 *
 * Premiere decision (Apr 13, 2026): we don't run an IPFS pinning service yet,
 * and depending on Pinata/web3.storage adds a third-party dependency that
 * could fail at the worst possible moment. Instead, we compute a deterministic
 * SHA-256 of a canonical JSON of the submission payload using Web Crypto.
 *
 * Properties:
 *   - Same content always produces the same hash → idempotent for re-submits
 *   - On-chain hash commits to the exact genealogy data shown to the participant
 *   - Forward-compatible: when IPFS pinning is wired later, the pinned content
 *     can include this hash, and the hash itself remains valid evidence
 *   - No network dependency → no flaky failures during a live demo
 *
 * Format: "0x" + 64 hex chars (32 bytes), suitable for a Solidity bytes32.
 */

const ZERO_HASH = '0x' + '0'.repeat(64);

/**
 * Canonicalize an object for hashing: stable key ordering, consistent
 * stringification. Two equivalent payloads MUST produce the same canonical
 * JSON. Arrays preserve order (order is meaningful for lineage chains).
 */
function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}

/**
 * Compute the genealogy hash for a submission payload.
 *
 * @param {object} payload — must contain at least:
 *   - ancestorName: string
 *   - familySearchId: string
 *   - notes: string
 *   - submitter: string (wallet address, lowercased)
 * Optional:
 *   - lineage: array of {name, fsId, generation, classification, ...}
 *   - documents: array of {ark, title}
 *   - matches: array of {slaveholder_name, classification, ...}
 *   - timestamp: ISO date string (omit if you want the hash to be re-computable)
 *
 * @returns {Promise<string>} 0x-prefixed 64-hex-char bytes32 string
 */
export async function computeGenealogyHash(payload) {
  if (!payload) return ZERO_HASH;
  // Canonicalize and hash with Web Crypto (available in all modern browsers
  // and Node 18+). The output is 32 bytes — exactly bytes32.
  const canonical = canonicalize(payload);
  const data = new TextEncoder().encode(canonical);
  let digest;
  try {
    digest = await crypto.subtle.digest('SHA-256', data);
  } catch (err) {
    // crypto.subtle is unavailable on insecure origins (http://). Fail loud
    // rather than silently using ZERO_HASH — payment provenance matters.
    throw new Error(
      'Web Crypto unavailable. genealogyHash requires HTTPS or localhost. ' +
      'Original error: ' + err.message
    );
  }
  // Convert ArrayBuffer to 0x-prefixed hex string
  const bytes = new Uint8Array(digest);
  let hex = '0x';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

export const ZERO_BYTES32 = ZERO_HASH;
