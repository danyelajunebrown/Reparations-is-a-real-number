// Clean up unconfirmed_persons rows flagged "Incorrectly auto-confirmed.
// ML person_type unreliable." by an old classifier. These are dictionary
// words, petition vocabulary, and phrase fragments that got labeled as
// enslaved persons or enslavers.
//
// Strategy (conservative — reject only clearly-non-person strings, leave
// ambiguous given-name lookalikes for human review):
//
//   REJECT (status='rejected', reason='ml_misclassified_ocr_noise'):
//     1. Single-word lowercase strings ("widow", "petitioner")
//     2. Single-word capitalized strings that are petition vocabulary
//        (curated blacklist: Here, Note, Petition, Columbia, etc.)
//     3. Multi-word strings that start with function words
//        ("was my", "under the", "of Henry") or end in incomplete syntax
//     4. Numbered prefixes that indicate parser artifact rather than name
//        (these need re-parsing, mark with a different reason)
//
//   LEAVE FOR HUMAN REVIEW:
//     • Single-word capitalized strings that resemble given names
//       ("Mary", "John", "Charlotte") — could be real
//     • Multi-word strings that parse cleanly (First Last)
//
// Retains audit trail — soft-delete via status='rejected' rather than
// DELETE so the rejection decisions are reversible.
//
// Usage:
//   node scripts/cleanup-civilwardc-ml-misclassified.mjs                # dry-run
//   node scripts/cleanup-civilwardc-ml-misclassified.mjs --apply        # execute

import 'dotenv/config';
import pg from 'pg';
const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Single-cap-word strings that are petition vocabulary, NOT given names.
// Curated from the top-30 most-frequent flagged single-cap words.
const PETITION_VOCAB = new Set([
    'Here', 'Note', 'Petition', 'State', 'Slave', 'Signed', 'Columbia',
    'District', 'Petitioner', 'Congress', 'Maryland', 'Washington', 'Peace',
    'Item', 'Name', 'March', 'January', 'February', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
    'Filed', 'Court', 'County', 'City', 'Ward', 'Street', 'Avenue',
    'Commissioner', 'Commissioners', 'Justice', 'Circuit', 'Supreme',
    'Government', 'Secretary', 'President', 'General', 'Army', 'Navy',
    'Emancipation', 'Act', 'Section', 'Clause', 'Article', 'Exhibit',
    'Schedule', 'Oath', 'Sworn', 'Affidavit', 'Valuation', 'Appraisal',
    'Value', 'Dollars', 'Hundred', 'Thousand', 'Million',
    'Black', 'White', 'Mulatto', 'Copper', 'Colored', 'Negro', 'Brown',
    'Born', 'Deceased', 'Widow', 'Orphan', 'Heirs', 'Estate', 'Will',
    'Deed', 'Land', 'Property', 'Chattel', 'Owner', 'Master', 'Mistress',
    'Male', 'Female', 'Height', 'Age', 'Year', 'Years',
    'Testimony', 'Witness', 'Witnessed', 'Subscribed',
    'Mrs', 'Mr', 'Miss', 'Dr', 'Rev', 'Col', 'Capt', 'Hon',
    'Officers', 'Trustees', 'Administrators', 'Executors', 'Agents',
    'Descendants', 'Ancestors', 'Children', 'Siblings', 'Family',
    'Loyal', 'Disloyal', 'Rebel', 'Union', 'Faithful', 'Loyalty',
    'Deponent', 'Complainant', 'Respondent', 'Claimant', 'Claimants',
    'Property', 'Chattels', 'Items', 'Subject', 'Object',
]);

// Function words that, if a multi-word string STARTS with them, indicate
// a phrase fragment rather than a proper name.
const LEADING_FUNCTION_WORD_RE = /^(of |the |a |an |in |on |at |by |to |was |is |are |were |have |has |had |under |over |before |after |during |who |which |that |my |his |her |their |our |your |its |and |or |but )/i;

// Trailing function-word endings that indicate fragment
const TRAILING_FRAGMENT_RE = /( of| the| a| an| in| on| at| by| to| was| is| were| have| my| his| her| their| our| and| or)$/i;

const flagged = await pool.query(`
    SELECT lead_id, full_name, person_type, status
    FROM unconfirmed_persons
    WHERE review_notes ILIKE '%ML person_type unreliable%'
      AND status != 'rejected'
`);

console.log(`Non-rejected flagged rows: ${flagged.rowCount}`);

const toReject = [];    // { lead_id, reason }
const toReparse = [];   // likely-person-with-parser-artifact (numbered prefix)
const leaveAlone = [];

for (const r of flagged.rows) {
    const name = (r.full_name || '').trim();
    let bucket = null;

    if (!name) {
        bucket = { action: 'reject', reason: 'empty_name' };
    } else if (/^\d+[ .]+/.test(name)) {
        bucket = { action: 'reparse', reason: 'numbered_prefix_parser_artifact' };
    } else if (!/ /.test(name)) {
        // single-word string
        if (/^[a-z]/.test(name)) {
            bucket = { action: 'reject', reason: 'single_lowercase_word' };
        } else if (PETITION_VOCAB.has(name)) {
            bucket = { action: 'reject', reason: 'petition_vocabulary' };
        } else if (name.length <= 2) {
            bucket = { action: 'reject', reason: 'too_short' };
        } else {
            bucket = { action: 'leave', reason: 'single_cap_possible_given_name' };
        }
    } else {
        // multi-word
        if (LEADING_FUNCTION_WORD_RE.test(name)) {
            bucket = { action: 'reject', reason: 'starts_with_function_word' };
        } else if (TRAILING_FRAGMENT_RE.test(name)) {
            bucket = { action: 'reject', reason: 'ends_with_function_word' };
        } else if (/^[a-z]/.test(name)) {
            bucket = { action: 'reject', reason: 'lowercase_start_multi_word' };
        } else {
            bucket = { action: 'leave', reason: 'multi_word_capitalized' };
        }
    }

    if (bucket.action === 'reject') toReject.push({ lead_id: r.lead_id, reason: bucket.reason, name });
    else if (bucket.action === 'reparse') toReparse.push({ lead_id: r.lead_id, reason: bucket.reason, name });
    else leaveAlone.push({ lead_id: r.lead_id, reason: bucket.reason, name });
}

console.log(`\nProposed action counts:`);
console.log(`  reject  : ${toReject.length}`);
console.log(`  reparse : ${toReparse.length}   (keep status, flag for re-parse)`);
console.log(`  leave   : ${leaveAlone.length}  (ambiguous — human review)`);

// Reason distribution for rejections
const rejCount = new Map();
for (const r of toReject) rejCount.set(r.reason, (rejCount.get(r.reason) || 0) + 1);
console.log('\nReject reason breakdown:');
for (const [reason, c] of [...rejCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${c}`);
}

console.log('\nSample rejections:');
for (const r of toReject.slice(0, 15)) console.log(`  [${r.reason}] "${r.name}"`);
console.log('\nSample reparse candidates:');
for (const r of toReparse.slice(0, 10)) console.log(`  "${r.name}"`);
console.log('\nSample leave-alone:');
for (const r of leaveAlone.slice(0, 10)) console.log(`  "${r.name}"`);

if (APPLY) {
    console.log('\nApplying rejections…');
    // Batch update in chunks of 1000
    for (let i = 0; i < toReject.length; i += 1000) {
        const chunk = toReject.slice(i, i + 1000);
        const ids = chunk.map(r => r.lead_id);
        // Update status + append reason to review_notes; group by reason for logging
        await pool.query(
            `UPDATE unconfirmed_persons
             SET status = 'rejected',
                 rejection_reason = 'ml_misclassified_ocr_noise',
                 review_notes = COALESCE(review_notes, '') ||
                   ' | Cleaned ` + new Date().toISOString().slice(0,10) + `: reject reason=' ||
                   $2::text,
                 updated_at = NOW()
             WHERE lead_id = ANY($1::int[])`,
            [ids, '(see cleanup script categories)']
        );
        process.stdout.write(`  rejected ${Math.min(i + 1000, toReject.length)}/${toReject.length}\r`);
    }
    console.log();

    console.log('\nFlagging re-parse candidates…');
    for (let i = 0; i < toReparse.length; i += 500) {
        const chunk = toReparse.slice(i, i + 500);
        const ids = chunk.map(r => r.lead_id);
        await pool.query(
            `UPDATE unconfirmed_persons
             SET review_notes = COALESCE(review_notes, '') || ' | needs_reparse_numbered_prefix',
                 updated_at = NOW()
             WHERE lead_id = ANY($1::int[])`,
            [ids]
        );
    }
    console.log(`  flagged ${toReparse.length} for re-parse`);

    // Final count
    const after = await pool.query(`
        SELECT status, COUNT(*)::int c FROM unconfirmed_persons
        WHERE review_notes ILIKE '%ML person_type unreliable%'
        GROUP BY status ORDER BY c DESC
    `);
    console.log('\nPost-cleanup status distribution:');
    for (const r of after.rows) console.log(`  ${r.status}: ${r.c}`);
} else {
    console.log('\nDRY-RUN — re-run with --apply to execute.');
}

await pool.end();
