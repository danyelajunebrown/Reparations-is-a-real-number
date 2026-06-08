// API client. Single source of truth for base URL + fetch wrapper.
// Backend lives on Render (production) or localhost:3000 (dev).
// In dev, Vite proxies /api to localhost:3000 (see vite.config.js).

const API_URL = import.meta.env.VITE_API_URL || '';

// Admin token management — stored in localStorage, sent as X-Admin-Token header.
// Set via useAdminAuth hook's login(); cleared on logout or verify failure.
const ADMIN_TOKEN_KEY = 'reparations.admin_token';

export function getAdminToken() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(ADMIN_TOKEN_KEY) : null;
  } catch {
    return null;
  }
}

export function setAdminToken(token) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ADMIN_TOKEN_KEY, token);
    }
  } catch {}
}

export function clearAdminToken() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
    }
  } catch {}
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request(path, { method = 'GET', body, signal, headers = {}, admin = false } = {}) {
  const url = `${API_URL}${path}`;
  const opts = {
    method,
    headers: { 'Accept': 'application/json', ...headers },
    signal,
  };
  // Attach admin token if requested (admin endpoints) or if one exists (belt+suspenders).
  // The backend only checks the header on gated paths, so sending it on public
  // paths is harmless.
  const adminToken = getAdminToken();
  if (adminToken) {
    opts.headers['X-Admin-Token'] = adminToken;
  }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(`Network error: ${err.message}`, 0, null);
  }
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    throw new ApiError(
      data?.error || data?.message || `HTTP ${res.status}`,
      res.status,
      data
    );
  }
  return data;
}

export const api = {
  // System
  health: () => request('/api/health'),
  stats: () => request('/api/contribute/stats'),

  // Search — frontend policy: verified data only.
  // The backend filter is applied in useSearch hook before rendering.
  searchPersons: (query, signal) =>
    request(`/api/contribute/search/${encodeURIComponent(query)}`, { signal }),
  searchDocuments: (query, signal) =>
    request(`/api/documents/owner/${encodeURIComponent(query)}`, { signal }),

  // Person detail
  getPerson: (id, tableSource, signal) =>
    request(`/api/contribute/person/${id}${tableSource ? `?table=${tableSource}` : ''}`, { signal }),

  // Browse
  browsePersons: ({ limit = 50, offset = 0, type, source, minConfidence } = {}) => {
    const params = new URLSearchParams();
    params.set('limit', limit);
    params.set('offset', offset);
    if (type) params.set('type', type);
    if (source) params.set('source', source);
    if (minConfidence != null) params.set('minConfidence', minConfidence);
    return request(`/api/contribute/browse?${params}`);
  },

  // Freedmen's Bank depositors
  getDepositorBranches: () => request('/api/contribute/depositors/branches'),
  searchDepositors: ({ q, branch, limit = 50, offset = 0 } = {}, signal) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (branch) params.set('branch', branch);
    params.set('limit', limit);
    params.set('offset', offset);
    return request(`/api/contribute/depositors/search?${params}`, { signal });
  },

  // Ancestor climb sessions (for lineage graph + participant profiles)
  listClimbSessions: () => request('/api/ancestor-climb/sessions'),
  getClimbSession: (id) => request(`/api/ancestor-climb/session/${id}`),

  // Documents
  getDocument: (id) => request(`/api/documents/${id}`),
  getDocumentAccess: (id, signal) => request(`/api/documents/${id}/access`, { signal }),
  // person_documents presigned URL (used by DocCollectionOverlay for S3 images/PDFs)
  getPersonDocAccess: (pdId, signal) => request(`/api/documents/person-doc/${pdId}/access`, { signal }),

  // Global reparations indicator targets (Brattle / Darity-Mullen / Craemer …)
  // — population-level context for the line-item DAA breakdown.
  getGlobalIndicators: (signal) => request('/api/daa/global-indicators', { signal }),

  // Corporate debts
  listFarmerPaellmann: () => request('/api/corporate-debts/farmer-paellmann'),
  getFarmerPaellmannBySector: () => request('/api/corporate-debts/farmer-paellmann/by-sector'),
  getCorporateLeaderboard: () => request('/api/corporate-debts/leaderboard'),
  getCorporateEntity: (id) => request(`/api/corporate-debts/entity/${id}`),

  // Legal framework
  listLegalPrecedents: () => request('/api/legal/precedents'),
  getFrameworkSummary: () => request('/api/legal/framework-summary'),
  listJurisdictions: () => request('/api/legal/jurisdictions'),
  getJurisdiction: (country) => request(`/api/legal/jurisdictions/${encodeURIComponent(country)}`),
  getUK1833: () => request('/api/legal/uk-1833'),
  getHaitiDebt: () => request('/api/legal/haiti'),
  getFarmerPaellmannLegal: () => request('/api/legal/farmer-paellmann'),
  listLegalDoctrines: () => request('/api/legal/doctrines'),

  // Blockchain
  getBlockchainConfig: () => request('/api/blockchain/config'),
  getBlockchainStatus: () => request('/api/blockchain/status'),
  getBlockchainRecord: (id) => request(`/api/blockchain/record/${id}`),
  getRemainingDebt: (id) => request(`/api/blockchain/debt/${id}`),

  // Admin — gated by X-Admin-Token header on the backend.
  // See useAdminAuth hook + src/middleware/admin-auth.js
  verifyAdmin: () => request('/api/admin/verify'),
  getReviewQueue: () => request('/api/contribute/review-queue'),
  approveReview: (id, full_name) =>
    request(`/api/contribute/review-queue/${id}/approve`, { method: 'POST', body: { full_name } }),
  rejectReview: (id, reason) =>
    request(`/api/contribute/review-queue/${id}/reject`, { method: 'POST', body: { reason } }),
  getDataQualityMetrics: () => request('/api/contribute/data-quality-metrics'),
  getPendingVerification: () => request('/api/ancestor-climb/pending-verification'),
};

/**
 * Strict verification filter.
 * Premiere policy: NOTHING unverified reaches the UI. A record is displayed iff:
 *   - canonical_persons / enslaved_individuals / individuals row (promoted), OR
 *   - status === 'confirmed', OR
 *   - ancestor_climb match with verification_status OR classification in VERIFIED_CLASSES
 *
 * Keeps: confirmed_slaveholder, enslaved_ancestor, free_poc, free_poc_slaveholder
 * Excludes: temporal_impossible, common_name_suspect, ambiguous_needs_review, unverified
 *
 * Note on field names: the ancestor_climb_matches table has BOTH `classification`
 * (written by MatchVerifier in src/services/match-verification.js) and
 * `verification_status` (added in migration 034). They're synonymous. We check
 * both so we're resilient to either schema.
 *
 * Admin views override with adminOverride: true.
 */
export const VERIFIED_CLASSES = new Set([
  'confirmed_slaveholder',
  'enslaved_ancestor',
  'free_poc',
  'free_poc_slaveholder',
]);

export function isVerified(item) {
  if (!item) return false;
  // Any record from a promoted/confirmed table is verified.
  if (item.table_source === 'canonical_persons') return true;
  if (item.table_source === 'enslaved_individuals') return true;
  if (item.table_source === 'individuals') return true;
  // Explicit confirmed status (e.g. documents table)
  if (item.status === 'confirmed') return true;
  if (item.verification_status === 'confirmed') return true;
  // Match verification taxonomy (check both column names)
  if (item.verification_status && VERIFIED_CLASSES.has(item.verification_status)) return true;
  if (item.classification && VERIFIED_CLASSES.has(item.classification)) return true;
  return false;
}

export function filterVerified(items) {
  if (!Array.isArray(items)) return [];
  return items.filter(isVerified);
}
