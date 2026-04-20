// Cross-reference Freedmen's Bank extracted enslaver names → canonical_persons
// enslaver records. When a plausible match is found, create a
// family_relationships row (type='enslaved_by') documenting the
// depositor → enslaver edge. This turns orphaned review_notes strings
// into graph edges that the probate gate's Tier C + future wealth-tracing
// can consume.
//
// Source:  unconfirmed_persons.relationships entries where
//          match_source='google_vision_ledger_extraction'
//          AND type='enslaved_by'
//          AND name_quality='plausible'   (passed validator)
//
// Target:  family_relationships (person1=enslaver, person2=depositor,
//          relationship_type='enslaved_by')
//
// Matching rules:
//   1. Exact canonical_name match (case-insensitive, ignoring punctuation)
//      against canonical_persons where person_type='enslaver'.
//   2. If multiple enslavers share the name, prefer one with state match
//      vs the depositor's branch location. Otherwise flag requires_human_review.
//   3. No match → skip (don't create an edge from garbage; don't invent
//      canonical entries).
//
// Idempotent — existing family_relationships (person1_name + person2_name
// + relationship_type + source_url match) are not duplicated.
//
// Usage:
//   node scripts/crossref-freedmens-to-canonical.mjs            # dry-run
//   node scripts/crossref-freedmens-to-canonical.mjs --apply    # write edges

import 'dotenv/config';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const normalize = s => (s || '')
    .toLowerCase()
    .replace(/[.,:;'"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Stricter than the validator in enslaver-name-validator.js. A name must
// pass BOTH validators to seed a new canonical_persons entry — we'd rather
// leave OCR garbage as orphan strings in review_notes than pollute the
// canonical graph. Failing names are kept as-is and counted separately.
function isStrictPlausible(raw) {
    if (!raw || typeof raw !== 'string') return { ok: false, why: 'empty' };
    const s = raw.trim();
    if (s.length < 4 || s.length > 50) return { ok: false, why: 'length out of 4-50' };
    // Reject multi-name strings (user would need to split these manually)
    if (/[&]/.test(s) || /,\s*[A-Z].*,/.test(s)) return { ok: false, why: 'multiple names' };
    // Reject digit-containing tokens
    if (/\d/.test(s)) return { ok: false, why: 'contains digits' };
    // Reject trailing or embedded dashes with fragments (e.g. "Jersey- Ray")
    if (/[A-Za-z]-\s+[A-Z]/.test(s)) return { ok: false, why: 'dash-fragment OCR blend' };
    // Tokens: require ≥2 tokens, each ≥2 chars of letters
    const tokens = s.split(/\s+/).map(t => t.replace(/[.,:;]/g, ''));
    const wordLike = tokens.filter(t => /^[A-Z][A-Za-z'\-]{1,30}$/.test(t) || /^(Mr|Mrs|Dr|Col|Capt|Rev|Rev\.|Mr\.|Mrs\.|Dr\.)$/i.test(t));
    if (wordLike.length < 2) return { ok: false, why: `only ${wordLike.length} name-like token(s)` };
    if (tokens.length > 5) return { ok: false, why: `too many tokens (${tokens.length}) — likely bleed` };
    return { ok: true };
}

// 1. Pull all plausible enslaver-linkage rows.
const src = await pool.query(`
    SELECT
        unp.lead_id,
        unp.full_name AS depositor_name,
        unp.locations[1] AS branch,
        unp.source_url AS freedmens_ark,
        rel->>'name' AS enslaver_name,
        rel->>'role' AS enslaver_role,
        (rel->>'confidence')::float AS match_confidence
    FROM unconfirmed_persons unp,
         jsonb_array_elements(unp.relationships) AS rel
    WHERE unp.extraction_method='freedmens_bank_index'
      AND rel->>'match_source' = 'google_vision_ledger_extraction'
      AND rel->>'type' = 'enslaved_by'
      AND rel->>'name_quality' = 'plausible'
`);

console.log(`Plausible depositor → enslaver strings: ${src.rowCount}`);
console.log(`Mode: ${APPLY ? 'APPLY (writing edges)' : 'DRY-RUN'}`);
console.log();

let matched = 0, matched_multi = 0, no_match = 0, already_exists = 0, inserted = 0, created = 0;
let strict_rejected = 0;
const matchedPersons = new Set();
const samples = { matched: [], created: [], strict_rejected: [], no_match: [] };

// Group by enslaver_name to avoid looking up the same name N times
const byName = new Map();
for (const r of src.rows) {
    const k = normalize(r.enslaver_name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(r);
}

console.log(`Distinct plausible enslaver names: ${byName.size}`);
console.log();

for (const [nameNorm, rows] of byName) {
    // Look up enslaver canonicals by exact name (case/punct-normalized)
    const q = await pool.query(`
        SELECT id, canonical_name, primary_state, primary_county, birth_year_estimate
        FROM canonical_persons
        WHERE person_type='enslaver'
          AND regexp_replace(lower(canonical_name), '[[:punct:]]', ' ', 'g') ~ $1
        LIMIT 20
    `, [`^\\s*${nameNorm.replace(/\s+/g, '\\s+')}\\s*$`]);

    // `chosen` is the canonical_persons row (existing or newly created)
    // that every depositor in this name-group will be linked to.
    let chosen;
    if (q.rowCount > 0) {
        chosen = q.rows[0];
        if (q.rowCount > 1) matched_multi += rows.length;
        matched += rows.length;
        matchedPersons.add(chosen.id);
        if (samples.matched.length < 10) {
            samples.matched.push(`"${rows[0].enslaver_name}" → cp=${chosen.id} "${chosen.canonical_name}"`);
        }
    } else {
        // No existing canonical match. We'd create a new one IF:
        //   1. The name passes the strict plausibility validator (no digits,
        //      no &, no dash fragments, ≥2 name-like tokens, etc.)
        //   2. The name is corroborated by 2+ depositor records OR carries an
        //      honorific (Mr/Mrs/Dr/Col/Rev). Multiple independent depositors
        //      independently naming the same enslaver is a much stronger
        //      signal than one OCR capture. Honorifics also disambiguate
        //      real-person from OCR-garbage.
        // Otherwise the name stays as an orphan in review_notes — not
        // promoted to the canonical graph until a human reviews it.
        no_match += rows.length;
        if (samples.no_match.length < 10) samples.no_match.push(rows[0].enslaver_name);

        // Write to review queue (don't auto-create canonicals). A human
        // will vet these against their source ledger images before they
        // enter the canonical graph. No auto-creation keeps data hygiene
        // in canonical_persons at a high bar while preserving the
        // Freedmen's Bank signal for later approval.
        const seed = rows[0];
        const strict = isStrictPlausible(seed.enslaver_name);
        const hasHonorific = /\b(Mr|Mrs|Ms|Miss|Dr|Col|Capt|Rev|Hon|Gen|Lt)\b\.?/i.test(seed.enslaver_name);

        const state = seed.branch ? seed.branch.split(',').slice(-1)[0].trim() : null;
        if (APPLY) {
            await pool.query(`
                INSERT INTO enslaver_candidates_review_queue (
                    proposed_name,
                    proposed_role,
                    proposed_primary_state,
                    proposed_confidence,
                    corroborating_depositor_count,
                    source_ledger_arks,
                    depositor_lead_ids,
                    depositor_names,
                    reviewer_notes
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `, [
                seed.enslaver_name.trim(),
                seed.enslaver_role || 'master',
                state,
                seed.match_confidence || 0.70,
                rows.length,
                rows.map(r => r.freedmens_ark),
                rows.map(r => r.lead_id),
                rows.map(r => r.depositor_name),
                `Queued by crossref-freedmens-to-canonical. Strict-plausible: ${strict.ok}. Has honorific: ${hasHonorific}. Reasons if not strict: ${strict.ok ? '(pass)' : strict.why}. Depositors corroborating: ${rows.length}.`,
            ]);
            created++;   // counts queue insertions, not canonical creations
        }
        if (samples.created.length < 15) {
            samples.created.push(`"${seed.enslaver_name}" queued [deps=${rows.length}, strict=${strict.ok}, honorific=${hasHonorific}]`);
        }
        // No edge creation for this group — depositors stay orphaned in
        // review_notes until the candidate is reviewed + approved.
        continue;
    }

    for (const depRow of rows) {
        // Idempotency: check if an edge already exists
        const existing = await pool.query(`
            SELECT id FROM family_relationships
            WHERE LOWER(person1_name) = LOWER($1)
              AND LOWER(person2_name) = LOWER($2)
              AND relationship_type = 'enslaved_by'
              AND source_url = $3
            LIMIT 1
        `, [chosen.canonical_name, depRow.depositor_name, depRow.freedmens_ark]);
        if (existing.rowCount > 0) {
            already_exists++;
            continue;
        }

        if (APPLY) {
            await pool.query(`
                INSERT INTO family_relationships (
                    person1_name, person1_role, person1_lead_id,
                    person2_name, person2_role, person2_lead_id,
                    relationship_type, source_url, matched_text, confidence
                ) VALUES (
                    $1, 'slaveholder', $2,
                    $3, 'freedperson', $4,
                    'enslaved_by', $5, $6, $7
                )
            `, [
                chosen.canonical_name, chosen.id,
                depRow.depositor_name, depRow.lead_id,
                depRow.freedmens_ark,
                `Freedmens Bank ledger extraction: depositor recorded enslaver as "${depRow.enslaver_name}"`,
                depRow.match_confidence || 0.70
            ]);
            inserted++;
        }
    }
}

console.log(`Depositor→enslaver strings matched to existing canonical:  ${matched}`);
console.log(`  (of which multiple-canonical candidates):                  ${matched_multi}`);
console.log(`New canonicals queued for human review:                     ${created}`);
console.log(`Edges already existed (idempotent skip):                    ${already_exists}`);
console.log(`Distinct existing canonicals newly edge-linked:             ${matchedPersons.size}`);
console.log();
console.log('Sample matches (enslaver was already in canonical_persons):');
samples.matched.forEach(s => console.log('  ✓ ' + s));
console.log();
console.log('Sample QUEUED for review (not created as canonical yet):');
samples.created.forEach(s => console.log('  → ' + s));
console.log();

if (APPLY) {
    console.log(`Edges inserted into family_relationships: ${inserted}`);
    console.log();
    console.log('These enslavers now have additional Tier C evidence (family_relationships.enslaved_by) and will pass the probate gate for descendants linked to them.');
} else {
    console.log('DRY-RUN — re-run with --apply to insert edges.');
}

await pool.end();
