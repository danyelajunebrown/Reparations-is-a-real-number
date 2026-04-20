// Ingest the California Slavery Era Insurance Registry CSV.
//
// Source: Enslaved.org / Harvard Dataverse publication of the CA Department
// of Insurance's SB 2199 (2000) registry. Original government dataset is a
// PDF; Harvard's structured CSV is at https://doi.org/10.7910/DVN/BP6JHQ.
//
// 687 rows × 7 columns:
//   Slaveholder Last, First Name
//   Slaveholder County (or Parish), State
//   Enslaved Person Name
//   Enslaved Person County (or Parish), State
//   Other Identifying Information (policy number, age, occupation)
//   Submitted By (the modern insurer: Aetna Life, AIG, NY Life, ACE)
//   Source (Davidson Library archive pointer)
//
// This script:
//   1. Upserts 4 corporate_slavery_disclosures rows — one per modern insurer
//      — as the class-obligation anchor for every policy that insurer wrote.
//   2. For each CSV row, inserts a slave_era_insurance_policies row with
//      policy #, occupation, age parsed out of the "Other" text.
//   3. Attempts to link slaveholder + enslaved names to existing
//      canonical_persons rows (exact name match only; soft-fail on miss
//      to avoid polluting the canonical graph with first-name-only OCR).
//
// Usage:
//   node scripts/ingest-ca-seir-csv.mjs                              # dry-run
//   node scripts/ingest-ca-seir-csv.mjs --apply                      # live
//   node scripts/ingest-ca-seir-csv.mjs --apply --csv=/path/to/file  # custom path

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const csvArg = process.argv.find(a => a.startsWith('--csv='));
const CSV_PATH = csvArg ? csvArg.split('=')[1]
    : '/Users/danyelabrown/Downloads/dataverse_files/CSEIR_Data_30340805.csv';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Proper CSV parser (handles quoted fields + embedded newlines)
function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i], next = text[i + 1];
        if (inQuotes) {
            if (c === '"' && next === '"') { cell += '"'; i++; }
            else if (c === '"') inQuotes = false;
            else cell += c;
        } else {
            if (c === '"') inQuotes = true;
            else if (c === ',') { row.push(cell); cell = ''; }
            else if (c === '\n' || c === '\r') {
                if (cell || row.length) { row.push(cell); rows.push(row); row = []; cell = ''; }
                if (c === '\r' && next === '\n') i++;
            }
            else cell += c;
        }
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
}

// Parse "Other Identifying Information" for structured data
function parseOtherInfo(s) {
    if (!s) return {};
    const r = { raw: s };
    const policyMatch = s.match(/Policy\s*Number\(s\)[:\s]+([\d,\s&]+)/i);
    if (policyMatch) r.policy_number = policyMatch[1].trim().replace(/\s+/g, '').replace(/&/g, ',');
    const ageMatch = s.match(/\bAge\s*:?\s*(\d{1,3})/i);
    if (ageMatch) r.age = ageMatch[1];
    const occMatch = s.match(/Occupation\s*:?\s*([A-Z][A-Za-z \-]+?)(?:;|\.|,|$|\n|Policy)/i);
    if (occMatch) r.occupation = occMatch[1].trim();
    // The majority of rows use "Waiter", "House servant", "Carpenter" as
    // free text preceding "Policy Number(s):". Try that pattern too.
    if (!r.occupation) {
        const preP = s.split(/Policy\s*Number/i)[0].trim();
        if (preP && preP.length < 80 && /^[A-Z][A-Za-z ]{2,30}/.test(preP)) r.occupation = preP.split(/[;.,\n]/)[0].trim();
    }
    // Some rows have a year like "1857", "1854", "1859"
    const yearMatch = s.match(/\b(18[4-6]\d)\b/);
    if (yearMatch) r.year = parseInt(yearMatch[1]);
    return r;
}

// Map insurer → modern successor
const INSURER_SUCCESSOR = {
    'Aetna Life Insurance Company':                   'CVS Health Corporation',
    'American International Group, Inc.':             'Corebridge Financial (spin-off of AIG, 2022)',
    'New York Life Insurance Company':                'New York Life Insurance Company',
    'ACE Property and Casualty Insurance Company':    'Chubb Limited (ACE merged into Chubb, 2016)',
};

async function resolveCanonical(name, personType) {
    if (!name || name.trim().length < 3) return null;
    // Normalize "Adams, George" → "George Adams"
    const parts = name.split(',').map(s => s.trim());
    const names = [name];
    if (parts.length === 2) names.push(`${parts[1]} ${parts[0]}`);
    for (const n of names) {
        const r = await pool.query(
            `SELECT id FROM canonical_persons
             WHERE LOWER(canonical_name) = LOWER($1)
               ${personType ? `AND person_type = '${personType}'` : ''}
             ORDER BY id LIMIT 1`, [n]);
        if (r.rowCount) return r.rows[0].id;
    }
    return null;
}

async function main() {
    console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
    console.log(`CSV:  ${CSV_PATH}`);
    if (!fs.existsSync(CSV_PATH)) { console.error('CSV not found'); process.exit(1); }

    const text = fs.readFileSync(CSV_PATH, 'utf8');
    const rows = parseCsv(text);
    const header = rows[0];
    const data = rows.slice(1).filter(r => r.length >= 7 && r[0]?.trim());
    console.log(`Rows: ${data.length}`);

    // Seed corporate_slavery_disclosures parent rows
    const insurers = new Set(data.map(r => r[5].trim()).filter(Boolean));
    console.log(`Distinct insurers: ${insurers.size}`);
    const disclosureByInsurer = new Map();
    for (const ins of insurers) {
        const successor = INSURER_SUCCESSOR[ins] || ins;
        if (APPLY) {
            const check = await pool.query(
                `SELECT disclosure_id FROM corporate_slavery_disclosures
                 WHERE LOWER(historical_entity_name) = LOWER($1) AND involvement_type='insurance_underwriting'
                 LIMIT 1`, [ins]);
            let dId;
            if (check.rowCount) {
                dId = check.rows[0].disclosure_id;
            } else {
                const r = await pool.query(`
                    INSERT INTO corporate_slavery_disclosures (
                        modern_entity_name, historical_entity_name,
                        involvement_type, involvement_period_start, involvement_period_end,
                        enslaved_persons_count,
                        disclosure_year, triggered_by, disclosure_document_url,
                        has_names_list, formal_apology, source_notes
                    ) VALUES (
                        $1, $2, 'insurance_underwriting', 1840, 1865,
                        (SELECT COUNT(*)::int FROM (SELECT $2::text) x) * 0, -- placeholder; update after insert
                        2000, 'CA SB 2199 (2000) — California Slavery Era Insurance Registry',
                        'https://www.insurance.ca.gov/01-consumers/150-other-prog/10-seir/',
                        TRUE, $3, $4
                    ) RETURNING disclosure_id
                `, [
                    successor, ins, ins === 'Aetna Life Insurance Company',
                    `Disclosed as part of CA SB 2199 compliance. Insurer submitted policies written on enslaved persons' lives 1840-1865. Harvard Dataverse CSV: https://doi.org/10.7910/DVN/BP6JHQ`,
                ]);
                dId = r.rows[0].disclosure_id;
            }
            disclosureByInsurer.set(ins, dId);
        } else {
            disclosureByInsurer.set(ins, '(dry-run)');
        }
        const count = data.filter(r => r[5].trim() === ins).length;
        console.log(`  ${ins}: ${count} policies → ${successor}${APPLY ? ` (disclosure_id=${disclosureByInsurer.get(ins)})` : ''}`);
    }

    // Update enslaved counts on the disclosures
    if (APPLY) {
        for (const [ins, dId] of disclosureByInsurer) {
            const count = data.filter(r => r[5].trim() === ins).length;
            await pool.query(
                `UPDATE corporate_slavery_disclosures SET enslaved_persons_count = $1 WHERE disclosure_id = $2`,
                [count, dId]);
        }
    }

    let inserted = 0, skipped_dup = 0, linked_sh = 0, linked_en = 0;
    for (const row of data) {
        const [slHolderRaw, slHolderLoc, enRaw, enLoc, otherInfo, submittedBy, source] = row;
        const info = parseOtherInfo(otherInfo);

        const [slHolderState, slHolderCounty] = (() => {
            const m = (slHolderLoc || '').split(',');
            if (m.length >= 2) return [m[m.length - 1].trim(), m[0].trim()];
            return [(slHolderLoc || '').trim(), null];
        })();
        const [enState, enCounty] = (() => {
            const m = (enLoc || '').split(',');
            if (m.length >= 2) return [m[m.length - 1].trim(), m[0].trim()];
            return [(enLoc || '').trim(), null];
        })();

        const insurer = submittedBy.trim();
        const successor = INSURER_SUCCESSOR[insurer] || insurer;

        const slholdCpId = APPLY ? await resolveCanonical(slHolderRaw, 'enslaver') : null;
        const enslCpId = APPLY ? await resolveCanonical(enRaw, 'enslaved') : null;
        if (slholdCpId) linked_sh++;
        if (enslCpId) linked_en++;

        if (!APPLY) { inserted++; continue; }

        try {
            await pool.query(`
                INSERT INTO slave_era_insurance_policies (
                    policy_number, underwriter_name, modern_successor,
                    policy_year,
                    slaveholder_name, slaveholder_state, slaveholder_county, slaveholder_canonical_id,
                    enslaved_name, enslaved_state, enslaved_county, enslaved_age, enslaved_occupation,
                    enslaved_canonical_id,
                    registry_source, source_archive, source_citation,
                    submission_year, raw_data
                ) VALUES (
                    $1, $2, $3, $4,
                    $5, $6, $7, $8,
                    $9, $10, $11, $12, $13, $14,
                    'california_seir_2000', $15, $16, 2002, $17::jsonb
                )
            `, [
                info.policy_number || null, insurer, successor, info.year || null,
                slHolderRaw, slHolderState, slHolderCounty, slholdCpId,
                enRaw, enState, enCounty, info.age || null, info.occupation || null,
                enslCpId,
                source, source, JSON.stringify({ other_info_raw: otherInfo, ...info }),
            ]);
            inserted++;
        } catch (e) {
            if (/duplicate key/.test(e.message)) skipped_dup++;
            else console.log(`  row error: ${e.message.slice(0, 80)}  slaveholder="${slHolderRaw}"`);
        }

        if (inserted % 100 === 0 && APPLY) process.stdout.write(`  inserted ${inserted}/${data.length}\r`);
    }

    console.log('\n━━━ Summary ━━━');
    console.log(`Inserted: ${inserted}`);
    console.log(`Skipped (duplicates): ${skipped_dup}`);
    console.log(`Slaveholder names linked to canonical: ${linked_sh}`);
    console.log(`Enslaved names linked to canonical: ${linked_en}`);

    if (APPLY) {
        const total = await pool.query(`SELECT COUNT(*)::int c FROM slave_era_insurance_policies`);
        console.log(`slave_era_insurance_policies total rows: ${total.rows[0].c}`);
    }
    await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
