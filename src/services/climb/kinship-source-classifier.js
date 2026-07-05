/**
 * kinship-source-classifier.js — PURE classification of a FamilySearch attached
 * source into the kinship-edge evidence model.
 *
 * Standard: memory-bank/standard-genealogical-edge-evidence.md (§3 tiers, §4 doc
 * types) + plan-fs-source-harvest-for-kinship-edges.md (§A, decisions D1/D3).
 *
 * This module answers ONE question about ONE attached source: does it substantiate
 * a parent→child link for the person it is attached to, and if so at what tier /
 * confidence, and is it strong enough to auto-verify (D1)?
 *
 * It is DELIBERATELY pure — no DB, no network, no DOM. The messy work (visiting the
 * Sources tab, parsing the record ARK page into `relationships`) lives in the
 * Mini-side harvest layer; identity resolution + archiving + the edge write live in
 * the edge writer. Keeping this a pure function is what makes the tiering reviewable
 * and unit-testable in isolation, which is the whole point of the standard.
 *
 * ── Input contract (a normalized attached source) ──────────────────────────────
 *   {
 *     collectionTitle: string,     // e.g. "United States Census, 1860"
 *     recordType?: string|null,    // explicit type if FS provides one
 *     arkUrl?: string|null,
 *     eventYear?: number|null,     // year of the record event (census pre/post-1850)
 *     subject: { name, fsId },     // the climbed person this source is attached to
 *     relationships?: [            // parsed from the record ARK page (reuse climber :1236/:1500)
 *       { role: 'father'|'mother'|'parent'|'head'|'self'|'spouse'|'child'|..., name, fsId }
 *     ],
 *     householdCoResidence?: bool  // census: subject shares a household with a parent role
 *   }
 *
 * ── Output ─────────────────────────────────────────────────────────────────────
 *   {
 *     documentType: string|null,   // person_documents.document_type, null if non-kin
 *     evidenceTier: 1|2|null,      // canonical_family_edges.evidence_tier (M066)
 *     evidences: 'child_of'|null,  // the proposition this source supports (subject→parent)
 *     parentHint: { role, name, fsId }|null,  // which named person is the parent
 *     kinConfidence: number,       // 0..1 confidence WITHIN the tier
 *     verifiedEligible: boolean,   // D1: true only for document-STATED kinship
 *     reason: string               // audit string — why this classification
 *   }
 */

'use strict';

// D1: kinship the document explicitly STATES (auto-verify eligible) vs infers.
const STATED_KIN_TYPES = new Set([
    'will', 'death_certificate', 'birth_record', 'marriage_record', 'bible_record',
]);

// Roles on a record that identify a PARENT of the subject.
const PARENT_ROLES = new Set(['father', 'mother', 'parent']);

// Collection/record-type keyword → document_type. Order matters (first hit wins);
// more specific phrases first so "death" doesn't swallow "marriage", etc.
const TYPE_KEYWORDS = [
    [/\b(will|probate|estate|administration|testament|heir)\b/i, 'will'],
    [/\b(death|burial|died|cemetery|grave|interment)\b/i, 'death_certificate'],
    [/\b(birth|baptism|christening|baptismal)\b/i, 'birth_record'],
    [/\b(marriage|married|matrimon|nuptial)\b/i, 'marriage_record'],
    [/\bbible\b/i, 'bible_record'],
    [/\bcensus\b/i, 'census'],
    [/\b(deed|land|grantor|grantee|conveyance)\b/i, 'deed'],
];

function EMPTY(reason) {
    return {
        documentType: null, evidenceTier: null, evidences: null,
        parentHint: null, kinConfidence: 0, verifiedEligible: false, reason,
    };
}

function detectType(source) {
    const rt = (source.recordType || '').trim();
    const haystack = `${source.collectionTitle || ''} ${rt}`.trim();
    if (!haystack) return null;
    for (const [re, type] of TYPE_KEYWORDS) {
        if (re.test(haystack)) return type;
    }
    return null;
}

function findParent(relationships) {
    if (!Array.isArray(relationships)) return null;
    for (const r of relationships) {
        const role = String(r.role || '').toLowerCase();
        if (PARENT_ROLES.has(role) && (r.name || r.fsId)) {
            return { role, name: r.name || null, fsId: r.fsId || null };
        }
    }
    return null;
}

/**
 * Classify one attached FamilySearch source.
 * @param {object} source — see input contract above.
 * @returns {object} classification — see output contract above.
 */
function classifyKinshipSource(source) {
    if (!source || !source.subject) return EMPTY('no source/subject');

    const documentType = detectType(source);
    if (!documentType) return EMPTY('collection matched no kinship document type');

    const parent = findParent(source.relationships);

    // ── Document-STATED kinship (will / death / birth / marriage / bible) ──
    // The record itself names a parent of the subject → tier-1 direct, auto-verify (D1).
    if (STATED_KIN_TYPES.has(documentType)) {
        if (!parent) {
            return EMPTY(`${documentType} attached but names no parent of the subject`);
        }
        return {
            documentType,
            evidenceTier: 1,
            evidences: 'child_of',            // subject is the child_of `parent`
            parentHint: parent,
            kinConfidence: 0.96,
            verifiedEligible: true,           // D1: document STATES the relationship
            reason: `${documentType} names ${parent.role} "${parent.name || parent.fsId}"`,
        };
    }

    // ── Census: co-residence, inferential (D1 → verified=false, needs sign-off) ──
    if (documentType === 'census') {
        const year = Number(source.eventYear) || null;
        // Pre-1850 US censuses name only the household head — a named child cannot be
        // placed, so co-residence evidence structurally does not exist (standard §8).
        if (year && year < 1850) {
            return EMPTY(`pre-1850 census (${year}) — head-of-household only, no named child`);
        }
        if (source.householdCoResidence && parent) {
            return {
                documentType: 'census',
                evidenceTier: 1,              // primary document…
                evidences: 'child_of',
                parentHint: parent,
                kinConfidence: 0.87,          // …but inferential within tier 1
                verifiedEligible: false,      // D1: co-residence is inferred, needs review
                reason: `post-1850 census co-residence with ${parent.role} `
                      + `"${parent.name || parent.fsId}"`,
            };
        }
        return EMPTY('census does not co-locate the subject with a parent');
    }

    // ── Deed / land: only counts if it names a kin relationship → tier-2 correlated ──
    if (documentType === 'deed') {
        if (parent) {
            return {
                documentType: 'deed',
                evidenceTier: 2,
                evidences: 'child_of',
                parentHint: parent,
                kinConfidence: 0.75,
                verifiedEligible: false,      // tier-2 always needs review
                reason: `deed names ${parent.role} "${parent.name || parent.fsId}" `
                      + `(indirect/correlated)`,
            };
        }
        return EMPTY('deed names no kin relationship');
    }

    return EMPTY(`document type "${documentType}" carries no kinship proposition`);
}

module.exports = { classifyKinshipSource, STATED_KIN_TYPES, PARENT_ROLES };
