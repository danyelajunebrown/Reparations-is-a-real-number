// Backfill `match_tier`, `match_confidence`, `requires_human_review` fields
// onto `unconfirmed_persons` rows that were enhanced by the Vision extractor
// BEFORE the four-tier match-classification fix landed.
//
// What it does per row:
//   - Reads DB depositor name + extracted record header from review_notes
//   - Classifies the match into one of:
//       acct_and_name            (1.0 confidence, likely right)
//       name_only                (0.8)    — no acct# anchor but name aligned
//       acct_only_name_mismatch  (0.45)   — acct# matched but name did not;
//                                           likely FS index↔ledger inconsistency
//       acct_only_no_header      (0.65)   — acct# matched; no header was
//                                           extracted so we can't verify name;
//                                           moderate confidence, not flagged
//                                           for review by default
//   - Writes match_tier, match_confidence, requires_human_review, review_reason
//     into review_notes. Also adds match_tier to each relationships entry.
//
// Safe to re-run — idempotent.
//
// Usage:
//   node scripts/backfill-match-tier.mjs               # dry-run (print only)
//   node scripts/backfill-match-tier.mjs --apply       # write to DB

import 'dotenv/config';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const normalizeName = (s) => (s || '').toLowerCase()
    .replace(/[.,:;'"()]/g, ' ')
    .split(/\s+/).filter(t => t.length >= 3);
const nameMatch = (a, b) => {
    const ta = normalizeName(a), tb = normalizeName(b);
    if (!ta.length || !tb.length) return false;
    return ta.some(x => tb.some(y => x === y || (x.length >= 4 && (y.startsWith(x.slice(0, 4)) || x.startsWith(y.slice(0, 4))))));
};

function classify(depName, headerName, hasAcctInContext) {
    // "hasAcctInContext" indicates whether this depositor record had an account#
    // in its context_text (as the OCR extractor uses to match). If we can't
    // tell, fall back to conservative.
    if (!headerName) {
        // No header extracted from the ledger → acct-only match path.
        // Moderate confidence, no auto-flag (the original extraction worked
        // fine for Charleston R21 which legitimately has no "Record for"
        // header in the same position as multi-record branches).
        return { tier: 'acct_only_no_header', confidence: 0.65, review: false, reason: null };
    }
    const matched = nameMatch(depName, headerName);
    if (matched && hasAcctInContext) {
        return { tier: 'acct_and_name', confidence: 0.95, review: false, reason: null };
    }
    if (matched) {
        return { tier: 'name_only', confidence: 0.80, review: false, reason: null };
    }
    if (hasAcctInContext) {
        return {
            tier: 'acct_only_name_mismatch',
            confidence: 0.45,
            review: true,
            reason: `acct# matched but extracted header "${headerName}" does not share tokens with DB depositor "${depName}" — likely FS index↔ledger inconsistency`,
        };
    }
    // No acct and name doesn't match. Shouldn't happen (how did we write this?)
    return { tier: 'unknown', confidence: 0.30, review: true, reason: 'no acct#, name did not match — investigate' };
}

const q = await pool.query(`
    SELECT
        lead_id,
        full_name                                             AS db_depositor_name,
        context_text,
        relationships::jsonb                                  AS relationships,
        review_notes::jsonb                                   AS review_notes,
        (review_notes::jsonb)->'ledger_extraction'->>'record_header_name' AS extracted_header
    FROM unconfirmed_persons
    WHERE extraction_method='freedmens_bank_index'
      AND review_notes::text LIKE '%google_vision_spatial_parser_v2%'
    ORDER BY lead_id
`);

console.log(`Found ${q.rowCount} rows enhanced by v2 parser.`);
console.log(`Mode: ${APPLY ? 'APPLY (writing to DB)' : 'DRY-RUN (no writes)'}`);
console.log();

const counts = {};
const transitions = [];
let updates = 0;

for (const row of q.rows) {
    const hasAcct = row.context_text && /account\s*#\d+/i.test(row.context_text);
    const existingTier = row.review_notes?.match_tier;
    if (existingTier) {
        // Already backfilled — skip
        counts['already_tagged'] = (counts['already_tagged'] || 0) + 1;
        continue;
    }

    const cls = classify(row.db_depositor_name, row.extracted_header, hasAcct);
    counts[cls.tier] = (counts[cls.tier] || 0) + 1;
    if (cls.tier === 'acct_only_name_mismatch' || cls.tier === 'unknown') {
        transitions.push({
            lead_id: row.lead_id,
            db_name: row.db_depositor_name,
            header: row.extracted_header,
            tier: cls.tier,
        });
    }

    if (APPLY) {
        const updatedNotes = {
            ...row.review_notes,
            match_tier: cls.tier,
            match_confidence: cls.confidence,
            requires_human_review: cls.review,
            review_reason: cls.reason,
            backfilled_at: new Date().toISOString(),
        };
        const rels = Array.isArray(row.relationships) ? row.relationships.map(r => {
            // Only tag relationships that came from vision ledger extraction
            if (r && r.match_source === 'google_vision_ledger_extraction' && !r.match_tier) {
                return {
                    ...r,
                    match_tier: cls.tier,
                    confidence: Math.min(r.confidence ?? 0.70, cls.confidence),
                };
            }
            return r;
        }) : row.relationships;

        await pool.query(
            `UPDATE unconfirmed_persons
             SET review_notes = $1::jsonb,
                 relationships = $2::jsonb
             WHERE lead_id = $3`,
            [JSON.stringify(updatedNotes), JSON.stringify(rels), row.lead_id]
        );
        updates++;
    }
}

console.log('Classification distribution:');
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(32)} ${v}`);
}
console.log();
if (transitions.length) {
    console.log(`Rows flagged for human review (${transitions.length}):`);
    for (const t of transitions) {
        console.log(`  lead_id=${t.lead_id} "${t.db_name}" → header="${t.header}" [${t.tier}]`);
    }
}
console.log();
console.log(APPLY ? `DB updates written: ${updates}` : 'DRY-RUN: re-run with --apply to write');

await pool.end();
