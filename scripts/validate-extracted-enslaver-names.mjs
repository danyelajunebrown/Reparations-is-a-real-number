// Apply the enslaver-name validator to every row enhanced by the Vision
// extractor. Purpose: flag rows whose extracted master/mistress/employer/
// old_title strings look like OCR garbage or catchment bleed, WITHOUT
// deleting the strings (a human reviewer still needs to see what OCR
// captured).
//
// Per row, rechecks each `relationships` entry with
// match_source='google_vision_ledger_extraction' and sets:
//   - relationships[i].name_quality = 'plausible' | 'needs_review'
//   - relationships[i].name_quality_reasons = string[]
// And on the row as a whole:
//   - review_notes.name_quality_summary = { total, plausible, flagged }
//   - if ANY relationship fails validation AND the row wasn't already
//     requires_human_review, set requires_human_review=true and append
//     to review_reason.
//
// Usage:
//   node scripts/validate-extracted-enslaver-names.mjs            # dry-run
//   node scripts/validate-extracted-enslaver-names.mjs --apply    # write to DB

import 'dotenv/config';
import pg from 'pg';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { validateEnslaverName } = require('../src/services/enslaver-name-validator');

const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const q = await pool.query(`
    SELECT
        lead_id,
        full_name                        AS db_depositor_name,
        relationships::jsonb             AS relationships,
        review_notes::jsonb              AS review_notes,
        locations[1]                     AS branch
    FROM unconfirmed_persons
    WHERE extraction_method='freedmens_bank_index'
      AND review_notes::text LIKE '%google_vision_spatial_parser_v2%'
    ORDER BY lead_id
`);

console.log(`Validating ${q.rowCount} extracted rows.`);
console.log(`Mode: ${APPLY ? 'APPLY (writing to DB)' : 'DRY-RUN'}`);
console.log();

const counts = {
    all_plausible: 0,
    some_flagged: 0,
    all_flagged: 0,
    no_vision_rels: 0,
};
let totalPlausible = 0, totalFlagged = 0;
const samples = { flagged: [], plausible: [] };
let updates = 0;

for (const row of q.rows) {
    const rels = Array.isArray(row.relationships) ? [...row.relationships] : [];
    const visionRels = rels.filter(r => r && r.match_source === 'google_vision_ledger_extraction');
    if (visionRels.length === 0) {
        counts.no_vision_rels++;
        continue;
    }

    // Also validate old_title / enslaved_name entries
    const namedEntries = rels.filter(r => r && r.match_source === 'google_vision_ledger_extraction' && typeof r.name === 'string');
    let anyFlagged = false, allFlagged = true;
    const flagReasons = [];

    for (const rel of namedEntries) {
        const { plausible, reasons } = validateEnslaverName(rel.name);
        rel.name_quality = plausible ? 'plausible' : 'needs_review';
        rel.name_quality_reasons = plausible ? [] : reasons;
        if (plausible) {
            totalPlausible++;
            allFlagged = false;
            if (samples.plausible.length < 5) samples.plausible.push({ lead: row.lead_id, name: rel.name, role: rel.role });
        } else {
            totalFlagged++;
            anyFlagged = true;
            flagReasons.push(`${rel.type}${rel.role ? ':' + rel.role : ''} "${rel.name}" — ${reasons.join(', ')}`);
            if (samples.flagged.length < 15) samples.flagged.push({ lead: row.lead_id, name: rel.name, reasons });
        }
    }

    if (allFlagged) counts.all_flagged++;
    else if (anyFlagged) counts.some_flagged++;
    else counts.all_plausible++;

    // Update review_notes
    const currentNotes = row.review_notes || {};
    const newNotes = {
        ...currentNotes,
        name_quality_summary: {
            total: namedEntries.length,
            plausible: namedEntries.filter(r => r.name_quality === 'plausible').length,
            flagged: namedEntries.filter(r => r.name_quality === 'needs_review').length,
            checked_at: new Date().toISOString(),
        },
    };
    if (anyFlagged) {
        newNotes.requires_human_review = true;
        const existingReason = currentNotes.review_reason || '';
        const qualityReason = `name quality failed: ${flagReasons.slice(0, 3).join(' | ')}${flagReasons.length > 3 ? ` (and ${flagReasons.length - 3} more)` : ''}`;
        newNotes.review_reason = existingReason && !existingReason.includes('name quality failed')
            ? `${existingReason}; ${qualityReason}`
            : qualityReason;
    }

    if (APPLY) {
        await pool.query(
            `UPDATE unconfirmed_persons
             SET relationships = $1::jsonb, review_notes = $2::jsonb
             WHERE lead_id = $3`,
            [JSON.stringify(rels), JSON.stringify(newNotes), row.lead_id]
        );
        updates++;
    }
}

console.log('Row-level classification:');
console.log(`  all_plausible:   ${counts.all_plausible}  (every vision-extracted name on this row passed)`);
console.log(`  some_flagged:    ${counts.some_flagged}  (mix of good + bad)`);
console.log(`  all_flagged:     ${counts.all_flagged}  (every vision-extracted name failed)`);
console.log(`  no_vision_rels:  ${counts.no_vision_rels}  (row has no vision-source relationships — e.g., Charleston R23 where form has no master field)`);
console.log();
console.log('Relationship-level counts:');
console.log(`  total vision-extracted named entries: ${totalPlausible + totalFlagged}`);
console.log(`  plausible:                             ${totalPlausible}`);
console.log(`  flagged for review:                    ${totalFlagged}`);
console.log();
console.log('Sample FLAGGED strings (first 15):');
for (const s of samples.flagged) {
    console.log(`  lead_id=${s.lead} "${(s.name||'').slice(0, 45)}" → ${s.reasons.slice(0, 2).join('; ')}`);
}
console.log();
console.log('Sample PLAUSIBLE strings (first 5):');
for (const s of samples.plausible) {
    console.log(`  lead_id=${s.lead} "${s.name}" role=${s.role || '-'}`);
}
console.log();
console.log(APPLY ? `DB updates written: ${updates}` : 'DRY-RUN — re-run with --apply to persist');

await pool.end();
