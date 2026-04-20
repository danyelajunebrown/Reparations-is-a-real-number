// Download the 11 Philadelphia 2024 depository slavery-era disclosure PDFs
// (and any other publicly-available corporate slavery disclosures), archive
// to S3, and upsert corporate_slavery_disclosures rows.
//
// Source pages:
//   Philadelphia City Treasurer, 2024: https://www.phila.gov/documents/depository-slavery-era-disclosures/
//   California SEIR (Aetna, AIG, NYL, ACE): already ingested via ingest-ca-seir-csv.mjs
//   Chicago 2005 JPMC: there's also a Chicago version of JPMC's filing but
//                      the Philadelphia 2024 filing is the more recent/
//                      complete public version, so we use that.
//
// Each PDF is:
//   1. Downloaded from phila.gov (public)
//   2. Archived to S3 under corporate-disclosures/{slug}.pdf
//   3. Upserted into corporate_slavery_disclosures with metadata
//
// The corporate disclosure type + historical predecessor are inferred from
// the filer; additional metadata (involvement period, names list presence)
// is filled with TODO placeholders the human review workflow can update.
// We're NOT OCR'ing the PDFs in this pass — that's a separate step.
//
// Usage:
//   node scripts/ingest-corporate-disclosures.mjs                 # dry-run
//   node scripts/ingest-corporate-disclosures.mjs --apply         # live

import 'dotenv/config';
import axios from 'axios';
import pg from 'pg';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const S3Service = require('../src/services/storage/S3Service');

const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// The 11 Phila 2024 disclosures, plus reference notes for later enrichment
const DISCLOSURES = [
    {
        modern: 'Bank of America Corporation',
        historical: 'Various predecessor banks (Bank of America Chicago ordinance 2005 filing)',
        url: 'https://www.phila.gov/media/20250908142325/cto-slavery-era-disclosure-bank-of-america-2024.pdf',
        slug: 'bank-of-america',
    },
    {
        modern: 'BNY Mellon (Bank of New York Mellon)',
        historical: 'Bank of New York (founded 1784; predecessor institutions)',
        url: 'https://www.phila.gov/media/20250908142326/cto-slavery-era-disclosure-bny-mellon-2024.pdf',
        slug: 'bny-mellon',
    },
    {
        modern: 'Citizens Financial Group',
        historical: 'Citizens Bank (Rhode Island-based, NOT Citizens Bank of Louisiana)',
        url: 'https://www.phila.gov/media/20250908142328/cto-slavery-era-disclosure-citizens-bank-2024.pdf',
        slug: 'citizens-bank-ri',
    },
    {
        modern: 'Fulton Financial Corporation',
        historical: 'Fulton Bank / predecessor Pennsylvania institutions',
        url: 'https://www.phila.gov/media/20250908142329/cto-slavery-era-disclosure-fulton-bank-2024.pdf',
        slug: 'fulton-bank',
    },
    {
        modern: 'JPMorgan Chase & Co.',
        historical: 'Citizens Bank of Louisiana, Canal Bank of Louisiana',
        involvement_type: 'loan_collateral',
        enslaved_persons_count: 13000,
        enslaved_persons_direct_owned: 1250,
        involvement_period_start: 1831,
        involvement_period_end: 1865,
        formal_apology: true,
        remediation_funded: '$5M Smart Start Louisiana scholarship (2005, 5-year full tuition for Black LA students)',
        url: 'https://www.phila.gov/media/20250908142331/cto-slavery-era-disclosure-jp-morgan-2024.pdf',
        slug: 'jp-morgan-chase',
        triggered_by: 'Chicago 2003 ordinance (first disclosed 2005); Philadelphia 2024 refiling',
    },
    {
        modern: 'PNC Financial Services',
        historical: 'PNC Bank / various predecessor banks',
        url: 'https://www.phila.gov/media/20250908142332/cto-slavery-era-disclosure-pnc-2024.pdf',
        slug: 'pnc-bank',
    },
    {
        modern: 'Banco Santander, S.A.',
        historical: 'Santander Bank NA (US) / predecessor Sovereign Bancorp',
        url: 'https://www.phila.gov/media/20250908142333/cto-slavery-era-disclosure-santander-2024.pdf',
        slug: 'santander-bank',
    },
    {
        modern: 'Toronto-Dominion Bank (TD Bank)',
        historical: 'TD Bank US / predecessor Commerce Bancorp',
        url: 'https://www.phila.gov/media/20250908142335/cto-slavery-era-disclosure-td-bank-2024.pdf',
        slug: 'td-bank',
    },
    {
        modern: 'United Bank of Philadelphia',
        historical: 'United Bank of Philadelphia',
        url: 'https://www.phila.gov/media/20250908142336/cto-slavery-era-disclosure-united-bank-of-phila-2024.pdf',
        slug: 'united-bank-of-phila',
    },
    {
        modern: 'U.S. Bancorp',
        historical: 'U.S. Bank / predecessor Firstar Corporation',
        url: 'https://www.phila.gov/media/20250908142337/cto-slavery-era-disclosure-us-bank-2024.pdf',
        slug: 'us-bank',
    },
    {
        modern: 'Wells Fargo & Company',
        historical: 'Wachovia Corporation (absorbed 2008), Georgia Railroad & Banking Co (predecessor, enslaved ownership disclosed)',
        url: 'https://www.phila.gov/media/20250908142338/cto-slavery-era-disclosure-wells-fargo-2024.pdf',
        slug: 'wells-fargo',
        triggered_by: 'Chicago 2003 ordinance (Wachovia 2005); Philadelphia 2024 refiling',
        formal_apology: true,
    },
];

async function downloadAndUpload(url, s3Key) {
    if (!APPLY) return { s3Key, url, skipped: true };
    const existing = await S3Service.objectExists(s3Key).catch(() => ({ exists: false }));
    if (existing.exists) return { s3Key, url, already: true };
    const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
    const buf = Buffer.from(resp.data);
    await S3Service.upload(s3Key, buf, 'application/pdf', { 'source-url': url });
    return { s3Key, bytes: buf.length };
}

async function main() {
    console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
    let inserted = 0, updated = 0, uploaded = 0;

    for (const d of DISCLOSURES) {
        const s3Key = `corporate-disclosures/${d.slug}-2024.pdf`;
        console.log(`\n${d.slug}: ${d.modern}`);

        const dl = await downloadAndUpload(d.url, s3Key);
        if (dl.already) console.log(`  S3: already exists at ${dl.s3Key}`);
        else if (dl.skipped) console.log(`  S3: (dry-run) would upload → ${s3Key}`);
        else { console.log(`  S3: uploaded ${(dl.bytes / 1024).toFixed(0)} KB → ${dl.s3Key}`); uploaded++; }

        if (!APPLY) continue;

        const exists = await pool.query(
            `SELECT disclosure_id FROM corporate_slavery_disclosures
             WHERE LOWER(modern_entity_name) = LOWER($1)
               AND LOWER(historical_entity_name) = LOWER($2)
               AND disclosure_year = 2024`,
            [d.modern, d.historical]);

        const fields = {
            modern_entity_name: d.modern,
            historical_entity_name: d.historical,
            involvement_type: d.involvement_type || 'banking_loan_collateral_holding',
            involvement_period_start: d.involvement_period_start || 1800,
            involvement_period_end: d.involvement_period_end || 1865,
            enslaved_persons_count: d.enslaved_persons_count || null,
            enslaved_persons_direct_owned: d.enslaved_persons_direct_owned || null,
            disclosure_year: 2024,
            triggered_by: d.triggered_by || 'Philadelphia Ordinance (depository slavery-era disclosure filing)',
            disclosure_document_url: d.url,
            disclosure_document_s3_key: s3Key,
            has_names_list: !!d.enslaved_persons_count,  // presumed
            formal_apology: d.formal_apology || false,
            remediation_funded: d.remediation_funded || null,
            source_notes: `Filed with Philadelphia City Treasurer 2024. PDF archived to s3://${s3Key}. Original URL: ${d.url}. Additional enrichment (names list extraction, specific enslaved-person counts) pending PDF OCR pass.`,
            review_status: 'pending',
        };

        if (exists.rowCount) {
            await pool.query(
                `UPDATE corporate_slavery_disclosures SET
                    involvement_type=$3, involvement_period_start=$4, involvement_period_end=$5,
                    enslaved_persons_count=COALESCE($6, enslaved_persons_count),
                    enslaved_persons_direct_owned=COALESCE($7, enslaved_persons_direct_owned),
                    triggered_by=$8, disclosure_document_url=$9, disclosure_document_s3_key=$10,
                    has_names_list=$11, formal_apology=$12, remediation_funded=$13,
                    source_notes=$14, updated_at=NOW()
                 WHERE disclosure_id=$1`,
                [exists.rows[0].disclosure_id,
                 null, // placeholder to keep param indices aligned
                 fields.involvement_type, fields.involvement_period_start, fields.involvement_period_end,
                 fields.enslaved_persons_count, fields.enslaved_persons_direct_owned,
                 fields.triggered_by, fields.disclosure_document_url, fields.disclosure_document_s3_key,
                 fields.has_names_list, fields.formal_apology, fields.remediation_funded,
                 fields.source_notes]);
            updated++;
            console.log(`  DB: updated disclosure_id=${exists.rows[0].disclosure_id}`);
        } else {
            const r = await pool.query(
                `INSERT INTO corporate_slavery_disclosures (
                    modern_entity_name, historical_entity_name, involvement_type,
                    involvement_period_start, involvement_period_end,
                    enslaved_persons_count, enslaved_persons_direct_owned,
                    disclosure_year, triggered_by, disclosure_document_url, disclosure_document_s3_key,
                    has_names_list, formal_apology, remediation_funded, source_notes, review_status
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
                ) RETURNING disclosure_id`,
                [fields.modern_entity_name, fields.historical_entity_name, fields.involvement_type,
                 fields.involvement_period_start, fields.involvement_period_end,
                 fields.enslaved_persons_count, fields.enslaved_persons_direct_owned,
                 fields.disclosure_year, fields.triggered_by, fields.disclosure_document_url, fields.disclosure_document_s3_key,
                 fields.has_names_list, fields.formal_apology, fields.remediation_funded,
                 fields.source_notes, fields.review_status]);
            inserted++;
            console.log(`  DB: inserted disclosure_id=${r.rows[0].disclosure_id}`);
        }
    }

    console.log('\n━━━ Summary ━━━');
    console.log(`PDFs uploaded to S3: ${uploaded}`);
    console.log(`Disclosures inserted: ${inserted}`);
    console.log(`Disclosures updated:  ${updated}`);

    if (APPLY) {
        const total = await pool.query(`SELECT COUNT(*)::int c FROM corporate_slavery_disclosures`);
        console.log(`corporate_slavery_disclosures total rows: ${total.rows[0].c}`);
    }

    await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
