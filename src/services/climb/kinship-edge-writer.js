/**
 * kinship-edge-writer.js — persist a classified FamilySearch source as a kinship
 * edge under the genealogical edge-evidence standard.
 *
 * Standard: memory-bank/standard-genealogical-edge-evidence.md (§5 storage, D1/D3)
 * + plan-fs-source-harvest-for-kinship-edges.md §B.
 *
 * Given the classifier's verdict for one attached source + the archived document
 * reference, this:
 *   1. resolves child & parent FamilySearch IDs → canonical persons (person_
 *      external_ids, canonical-only today; unresolved ends cannot assert an edge);
 *   2. ensures a person_documents row for the source on the CHILD;
 *   3. D3 — flags contradictions with an existing tier-1 edge to a DIFFERENT
 *      parent, never overwriting (two tier-1 documents that disagree BOTH lose
 *      verified — GPS conflict resolution);
 *   4. writes/upgrades the canonical_family_edges row (SELECT-first, the project
 *      idiom), setting verified per D1 (document-STATED tier-1 + archived s3_key
 *      only; census co-residence and tier-2 stay verified=false for /review).
 *
 * person_a_id/person_b_id are written directly; the M103 trigger syncs the
 * polymorphic a_subject_table/a_subject_id (so the storage is lead-capable for
 * when the deferred lead-vs-canonical demotion lands — D2).
 *
 * DB-facing but transport-free: the caller (Mini harvest) has already archived
 * the image to S3 and passes the reference. No network, no DOM here.
 */

'use strict';

const PersonService = require('../PersonService');

const ID_SYSTEM = 'familysearch';

// Document types where the record STATES the kinship (D1 auto-verify eligible).
// Mirrors STATED_KIN_TYPES in the classifier; census/deed are excluded on purpose.
const STATED_KIN_DOC_TYPES = new Set([
    'will', 'death_certificate', 'birth_record', 'marriage_record', 'bible_record',
]);

/** Resolve a FamilySearch ID to a canonical person id, or null. */
async function resolveFs(personService, fsId, hint = {}) {
    if (!fsId) return null;
    const res = await personService.resolve({
        externalId: fsId, idSystem: ID_SYSTEM,
        name: hint.name || undefined, birthYear: hint.birthYear || undefined,
    });
    if (res.match && res.match.subject_table === 'canonical_persons') {
        return res.match.subject_id;
    }
    return null; // person_external_ids is canonical-only → unresolved = cannot assert
}

/** Find-or-create the source's person_documents row on the child. Returns its id. */
async function ensureSourceDocument(db, { childId, classification, source, createdBy }) {
    const sourceUrl = source.sourceUrl || source.arkUrl || null;
    const s3Url = source.s3Url || null;
    // person_documents' unique index is (canonical_person_id, unconfirmed_person_id, s3_url,
    // name_as_appears). Pre-archive, s3_url is null for every attached source, so name_as_appears
    // must carry the per-source identity or two distinct sources on the same child collide.
    const nameAsAppears = source.nameAsAppears
        || `kinship:${classification.documentType}:${sourceUrl || 'nourl'}`;

    const existing = await db.query(
        `SELECT id FROM person_documents
         WHERE canonical_person_id = $1
           AND COALESCE(s3_url, '') = COALESCE($2, '')
           AND name_as_appears = $3
         ORDER BY id LIMIT 1`,
        [childId, s3Url, nameAsAppears]);
    if (existing.rows[0]) return existing.rows[0].id;

    const ins = await db.query(
        `INSERT INTO person_documents
           (canonical_person_id, name_as_appears, document_type, source_url, source_type,
            s3_url, s3_key, evidence_strength, document_year, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id`,
        [childId, nameAsAppears, classification.documentType, sourceUrl,
         source.s3Key ? 'primary' : 'secondary',
         s3Url, source.s3Key || null,
         source.s3Key ? 'primary' : 'secondary_database',
         source.documentYear || null, createdBy]);
    return ins.rows[0].id;
}

/** Existing tier-1 'child_of'/'parent_of' edges asserting a DIFFERENT parent of this child. */
async function findConflictingTier1(db, childId, parentId) {
    const r = await db.query(
        `SELECT id,
                CASE WHEN relationship_type = 'child_of' THEN person_b_id ELSE person_a_id END AS other_parent_id,
                verified
         FROM canonical_family_edges
         WHERE evidence_tier = 1
           AND (
             (relationship_type = 'child_of'  AND person_a_id = $1 AND person_b_id <> $2)
             OR (relationship_type = 'parent_of' AND person_b_id = $1 AND person_a_id <> $2)
           )`,
        [childId, parentId]);
    return r.rows;
}

/** SELECT-first upsert of the child_of edge (child = a, parent = b). Returns edge id. */
async function upsertEdge(db, { childId, parentId, tier, sourceDocumentId, confidence, verified, notes, createdBy }) {
    const existing = await db.query(
        `SELECT id, evidence_tier, verified, notes FROM canonical_family_edges
         WHERE person_a_id = $1 AND person_b_id = $2 AND relationship_type = 'child_of'`,
        [childId, parentId]);

    if (existing.rows[0]) {
        const e = existing.rows[0];
        // Upgrade: keep the strongest tier (lower number), best confidence, sticky verified;
        // append (dedup) any conflict note.
        const r = await db.query(
            `UPDATE canonical_family_edges SET
               source_document_id = COALESCE($2, source_document_id),
               evidence_tier      = LEAST(evidence_tier, $3),
               confidence         = GREATEST(confidence, $4),
               verified           = verified OR $5,
               verified_by        = COALESCE(verified_by, CASE WHEN $5 THEN $6 END),
               verified_at        = COALESCE(verified_at, CASE WHEN $5 THEN now() END),
               notes = CASE
                         WHEN $7::text IS NOT NULL AND COALESCE(notes,'') NOT LIKE '%'||$7||'%'
                         THEN COALESCE(notes||'; ','')||$7 ELSE notes END,
               updated_at = now()
             WHERE id = $1 RETURNING id`,
            [e.id, sourceDocumentId, tier, confidence, verified, createdBy, notes]);
        return r.rows[0].id;
    }

    const ins = await db.query(
        `INSERT INTO canonical_family_edges
           (person_a_id, person_b_id, relationship_type, source_document_id,
            evidence_tier, confidence, verified, verified_by, verified_at, notes)
         VALUES ($1,$2,'child_of',$3,$4,$5,$6,
                 CASE WHEN $6 THEN $7 END, CASE WHEN $6 THEN now() END, $8)
         RETURNING id`,
        [childId, parentId, sourceDocumentId, tier, confidence, verified, createdBy, notes]);
    return ins.rows[0].id;
}

/**
 * writeKinshipEdge — persist one classified source as a kinship edge.
 *
 * @param {object} deps  — { db, personService? }
 * @param {object} input — {
 *     childFsId, parentFsId,
 *     classification,          // output of classifyKinshipSource (evidences='child_of')
 *     source = {},             // { sourceUrl, arkUrl, s3Key, s3Url, documentYear, nameAsAppears }
 *     childHint?, parentHint?, // { name, birthYear } to aid resolution
 *     createdBy = 'kinship_harvest'
 * }
 * @returns {object} { status: 'written'|'conflict'|'unresolved'|'skipped', edgeId?, verified?, ... }
 */
async function writeKinshipEdge(deps, input) {
    const db = deps.db;
    const personService = deps.personService || new PersonService(db);
    const {
        childFsId, parentFsId, classification, source = {},
        childHint, parentHint, createdBy = 'kinship_harvest',
    } = input;

    if (!classification || classification.evidences !== 'child_of' || !classification.evidenceTier) {
        return { status: 'skipped', reason: 'source carries no kinship proposition' };
    }

    const childId = await resolveFs(personService, childFsId, childHint);
    if (!childId) return { status: 'unresolved', end: 'child', fsId: childFsId };
    const parentId = await resolveFs(personService, parentFsId, parentHint || classification.parentHint || {});
    if (!parentId) return { status: 'unresolved', end: 'parent', fsId: parentFsId };
    if (childId === parentId) return { status: 'skipped', reason: 'self-edge' };

    const sourceDocumentId = await ensureSourceDocument(db, { childId, classification, source, createdBy });

    const conflicts = await findConflictingTier1(db, childId, parentId);
    const isConflict = conflicts.length > 0;
    const newTier = classification.evidenceTier;

    // D1: verify only a document-STATED tier-1 relationship with an archived file,
    // and never while contested.
    const verified = !!classification.verifiedEligible
        && STATED_KIN_DOC_TYPES.has(classification.documentType)
        && !!source.s3Key
        && !isConflict;

    const edgeId = await upsertEdge(db, {
        childId, parentId, tier: newTier, sourceDocumentId,
        confidence: classification.kinConfidence, verified,
        notes: isConflict ? 'kinship_conflict' : null, createdBy,
    });

    if (isConflict) {
        // D3 — flag, never overwrite. When BOTH sides are tier-1 (documents that
        // disagree), neither may assert: unverify the pre-existing tier-1 edge(s)
        // and flag them for /review. A weaker (tier-2) newcomer does NOT unseat a
        // documented tier-1 parent — only the newcomer is flagged.
        if (newTier === 1) {
            for (const c of conflicts) {
                await db.query(
                    `UPDATE canonical_family_edges SET verified = false,
                       notes = CASE WHEN COALESCE(notes,'') LIKE '%kinship_conflict%'
                                    THEN notes ELSE COALESCE(notes||'; ','')||'kinship_conflict' END,
                       updated_at = now()
                     WHERE id = $1`, [c.id]);
            }
        }
        return {
            status: 'conflict', edgeId, verified: false,
            conflictingParentIds: conflicts.map(c => c.other_parent_id),
        };
    }

    return { status: 'written', edgeId, verified };
}

module.exports = { writeKinshipEdge, resolveFs, STATED_KIN_DOC_TYPES };
