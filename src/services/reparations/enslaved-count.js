/**
 * enslavedCountFor(db, canonicalId) — the ONE reconciled per-slaveholder enslaved count (issue #142,
 * build 2). Before this, two consumers disagreed:
 *   - DAAOrchestrator counted NAMED rows only (aggregateEnslavedData) and carried a DEAD
 *     `dbSlaveholder.enslaved_count` reference (the documentedSlaveholders query never SELECTed it).
 *   - contribute.js:1741 was the ONLY reader of person_documents.enslaved_count, doing max(named, docs).
 * Both now call this, so the documented COUNT (slave-schedule walk / probate) is never ignored again.
 *
 * Reconciliation = MAX of the documented sources, NOT a sum. The sources measure the SAME underlying
 * holding at different completeness levels (a walked schedule's 1,100 SUPERSETs its 71 indexed leads),
 * so summing double-counts. MAX is a conservative, defensible documented FLOOR — audit-grade: we never
 * claim more than a source shows, and we never double-count overlapping evidence.
 *
 * Sources:
 *   documented_docs — SUM(person_documents.enslaved_count): the walk/OCR completeness layer (Ward=1,100).
 *   named           — named enslaved rows (caller passes its aggregate; else enslaved_owner_relationships).
 *   indexed_leads   — owner-referenced enslaved leads (the 1.4M unconfirmed_persons index; PARTIAL —
 *                     Ward="Joshua J Ward"=71). Opt-in (JSONB scan); location-scoped to guard namesakes.
 */

// Normalize an owner name for equality: drop generational suffixes (Jr/Sr/II–IV) and honorifics
// (Col./Mrs./Est.) so "William Aiken Jr." matches lead owner "William Aiken", then strip to letters.
const norm = (s) => (s || '')
  .toLowerCase()
  .replace(/\b(jr|sr|ii|iii|iv|col|colonel|capt|captain|gen|dr|mr|mrs|miss|est|estate|of)\b/g, '')
  .replace(/[^a-z]/g, '')
  .trim();

async function enslavedCountFor(db, canonicalId, { namedCount = null, includeIndexLeads = false } = {}) {
  const out = { count: 0, sources: { documented_docs: 0, named: 0, indexed_leads: 0 }, partial: false, method: 'max-of-documented', canonicalId };
  if (!canonicalId) return out;

  // 1. Documented docs (schedule walk / probate) — completeness layer, keyed on the canonical.
  const docsQ = await db.query(
    `SELECT COALESCE(SUM(enslaved_count), 0)::int c, BOOL_OR(enslaved_count_partial) p
       FROM person_documents WHERE canonical_person_id = $1 AND enslaved_count IS NOT NULL`,
    [canonicalId]);
  const documented_docs = docsQ.rows[0].c || 0;
  const docsPartial = !!docsQ.rows[0].p;

  // 2. Named enslaved. Callers with their own aggregate (DAA's aggregateEnslavedData, contribute's
  //    enslavedPersons) pass namedCount; otherwise fall back to the verified owner edge.
  let named = namedCount;
  if (named == null) {
    named = (await db.query(
      `SELECT COUNT(*)::int c FROM enslaved_owner_relationships WHERE owner_canonical_id = $1`,
      [canonicalId])).rows[0].c || 0;
  }

  // 3. Owner-referenced index leads (opt-in). For un-walked enslavers this is the only documented floor.
  //    Normalized owner-name equality + state-scope so a same-name owner in another state doesn't inflate.
  let indexed_leads = 0;
  if (includeIndexLeads) {
    const cp = (await db.query('SELECT canonical_name, primary_state FROM canonical_persons WHERE id = $1', [canonicalId])).rows[0];
    if (cp && cp.canonical_name) {
      const nameNorm = norm(cp.canonical_name);
      const last = cp.canonical_name.trim().split(/\s+/).pop();
      if (last && last.length >= 3) {
        const rows = (await db.query(
          `SELECT relationships->>'owner' owner, relationships->>'state' st
             FROM unconfirmed_persons
            WHERE person_type = 'enslaved' AND relationships->>'owner' ILIKE $1
            LIMIT 5000`, ['%' + last + '%'])).rows;
        indexed_leads = rows.filter((r) =>
          norm(r.owner) === nameNorm &&
          (!cp.primary_state || !r.st || norm(r.st) === norm(cp.primary_state))
        ).length;
      }
    }
  }

  const count = Math.max(documented_docs, named, indexed_leads);
  out.count = count;
  out.sources = { documented_docs, named, indexed_leads };
  // Partial when the winning documented count is itself flagged partial, or when it came only from the
  // (always-incomplete) index. A single named exact source is treated as complete.
  out.partial = count > 0 && (docsPartial || (count === indexed_leads && count > named && count > documented_docs));
  return out;
}

module.exports = { enslavedCountFor };
