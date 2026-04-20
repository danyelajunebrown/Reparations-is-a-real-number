// Ingest civilwardc.org compensated-emancipation petitions end-to-end.
//
// For each petition this script:
//   1. Fetches document images (1200px JPGs) from civilwardc.org
//   2. Archives them to S3 under civilwardc/petitions/{petition_id}/
//   3. Inserts a row into historical_reparations_petitions (migration 041)
//      with claimant names, enslaved-persons-claimed JSONB, citation
//   4. Resolves each claimant to canonical_persons and links via
//      claimant_canonical_id; writes person_documents rows so the primary
//      source surfaces from the DAA pipeline
//
// Two target petitions are hardcoded for the Adrian Brown lineage:
//   - cww.00431: Angelica Chew (sole claimant)
//   - cww.00429: Ann M. Biscoe + Angelica Chew + Emma Biscoe (joint claim)
//
// This is the seed run; the same flow can be fanned out across the 42k
// civilwardc.org records already in unconfirmed_persons once the HTML
// parser is generalized.
//
// Usage:
//   node scripts/ingest-civilwardc-petitions.mjs                # dry-run
//   node scripts/ingest-civilwardc-petitions.mjs --apply        # live

import 'dotenv/config';
import pg from 'pg';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const S3Service = require('../src/services/storage/S3Service');

const APPLY = process.argv.includes('--apply');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

if (!S3Service.isEnabled()) {
    console.error('S3 not enabled — check S3_ENABLED + AWS_* env vars.');
    process.exit(1);
}

const CITATION =
    'National Archives and Records Administration, Microcopy 520, Reel 4; '
    + 'Record Group 217.6.5; ARC Identifier 4644616. '
    + 'Transcribed and hosted by civilwardc.org.';

const PETITIONS = [
    {
        petition_id: 'cww.00431',
        filing_date: '1862-05-26',
        claimants: [
            { name: 'Angelica Chew', role: 'sole_claimant', residence: 'Georgetown, District of Columbia' },
        ],
        enslaved_persons_claimed: [
            { name: 'Sallie Coates', age: 35, sex: 'F',
              description: 'chestnut color, medium height, stout',
              claimed_value_usd: 1000 },
        ],
        total_claimed_usd: 1000.00,
        image_urls: [
            'https://civilwardc.org/files/figures/petitions/1200px/cww.00431.001.jpg',
            'https://civilwardc.org/files/figures/petitions/1200px/cww.00431.002.jpg',
            'https://civilwardc.org/files/figures/petitions/1200px/cww.00431.003.jpg',
        ],
        html_url: 'https://civilwardc.org/texts/petitions/cww.00431.html',
    },
    {
        petition_id: 'cww.00429',
        filing_date: '1862-05-26',
        claimants: [
            { name: 'Ann M. Biscoe',  role: 'tenant_for_life' },
            { name: 'Angelica Chew',  role: 'tenant_in_remainder' },
            { name: 'Emma Biscoe',    role: 'tenant_in_remainder' },
        ],
        enslaved_persons_claimed: [
            { name: 'Ezekiel Biscoe',       age: 65,   sex: 'M', claimed_value_usd:  500 },
            { name: 'Samuel Wilson',        age: 52,   sex: 'M', claimed_value_usd:  800 },
            { name: 'John Bealle',          age: 32,   sex: 'M', claimed_value_usd:  600 },
            { name: 'Nancy Grey',           age: 42,   sex: 'F', claimed_value_usd:  800 },
            { name: 'John Grey',            age: 17,   sex: 'M', claimed_value_usd:  800 },
            { name: 'James Grey',           age: 14,   sex: 'M', claimed_value_usd:  600 },
            { name: 'Horace Grey',          age: 12,   sex: 'M', claimed_value_usd:  400 },
            { name: 'Eliza Ann Washington', age: 24,   sex: 'F', claimed_value_usd: 1000 },
            { name: 'Clara Washington',     age:  2,   sex: 'F', claimed_value_usd:  100 },
            { name: 'Ellen Waring',         age: 23,   sex: 'F', claimed_value_usd: 1000 },
            { name: 'Rebecca Herbert',      age: 35,   sex: 'F', claimed_value_usd: 1000 },
            { name: 'Martha Herbert',       age: 16,   sex: 'F', claimed_value_usd:  800 },
            { name: 'Henry Herbert',        age: 14,   sex: 'M', claimed_value_usd:  600 },
            { name: 'Levi Herbert',         age: 12,   sex: 'M', claimed_value_usd:  400 },
            { name: 'Margaret Coleman',     age: 28,   sex: 'F', claimed_value_usd: 1000 },
            { name: 'Sallie Coleman',       age: 15,   sex: 'F', claimed_value_usd:  800 },
            { name: 'Alice Coleman',        age: 13,   sex: 'F', claimed_value_usd:  500 },
            { name: 'Laura Coleman',        age:  8,   sex: 'F', claimed_value_usd:  400 },
            { name: 'Juliet Coleman',       age:  6,   sex: 'F', claimed_value_usd:  300 },
            { name: 'Frederick Coleman',    age:  2,   sex: 'M', claimed_value_usd:  150 },
            { name: 'William Coleman',      age_months: 1, sex: 'M', claimed_value_usd:   25 },
            { name: 'Maria Bealle',         age: 32,   sex: 'F', claimed_value_usd: 1000 },
            { name: 'Nicholas Bealle',      age:  9,   sex: 'M', claimed_value_usd:  400 },
            { name: 'George Bealle',        age:  3,   sex: 'M', claimed_value_usd:  200 },
            { name: 'Cecilia Bealle',       age: 23,   sex: 'F', claimed_value_usd: 1000 },
            { name: 'Ida Bealle',           age:  2,   sex: 'F', claimed_value_usd:  100 },
        ],
        total_claimed_usd: 15275.00,
        image_urls: [
            'https://civilwardc.org/files/figures/petitions/1200px/cww.00429.001.jpg',
            'https://civilwardc.org/files/figures/petitions/1200px/cww.00429.002.jpg',
            'https://civilwardc.org/files/figures/petitions/1200px/cww.00429.003.jpg',
            'https://civilwardc.org/files/figures/petitions/1200px/cww.00429.004.jpg',
        ],
        html_url: 'https://civilwardc.org/texts/petitions/cww.00429.html',
    },
];

async function downloadAndArchive(imageUrl, petitionId, pageIdx) {
    const fileName = imageUrl.split('/').pop();
    const key = `civilwardc/petitions/${petitionId}/${fileName}`;
    if (!APPLY) {
        return { key, url: `(dry-run) would fetch ${imageUrl} → s3://${key}` };
    }
    const resp = await fetch(imageUrl);
    if (!resp.ok) throw new Error(`fetch ${imageUrl}: ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    const { key: outKey, url } = await S3Service.upload(
        key, buf, 'image/jpeg',
        { 'source-url': imageUrl, 'petition-id': petitionId, 'page': String(pageIdx + 1) }
    );
    return { key: outKey, url };
}

async function resolveCanonical(name) {
    const r = await pool.query(
        `SELECT id FROM canonical_persons
         WHERE LOWER(canonical_name) = LOWER($1)
           AND person_type = 'enslaver'
         ORDER BY id LIMIT 1`,
        [name]
    );
    return r.rows[0]?.id ?? null;
}

async function ingest(p) {
    console.log(`\n━━━ ${p.petition_id} ━━━`);
    console.log(`Claimants: ${p.claimants.map(c => c.name).join(', ')}`);
    console.log(`Enslaved:  ${p.enslaved_persons_claimed.length} persons, total claimed $${p.total_claimed_usd.toLocaleString()}`);

    const s3Keys = [];
    const s3Urls = [];
    for (let i = 0; i < p.image_urls.length; i++) {
        const { key, url } = await downloadAndArchive(p.image_urls[i], p.petition_id, i);
        s3Keys.push(key);
        s3Urls.push(url);
        console.log(`  img[${i + 1}] → ${key}`);
    }

    const primaryClaimant = p.claimants[0];
    const primaryCanonicalId = await resolveCanonical(primaryClaimant.name);
    console.log(`  primary claimant "${primaryClaimant.name}" → cp=${primaryCanonicalId ?? '(unresolved)'}`);

    let petitionRowId = null;
    if (APPLY) {
        const r = await pool.query(
            `INSERT INTO historical_reparations_petitions (
                petition_type, jurisdiction, filed_date, filed_year, docket_number,
                petition_status, claimant_name, claimant_canonical_id, claimant_residence,
                enslaved_persons_claimed, total_claimed_usd,
                source_document_url, source_archive, source_citation, source_notes,
                confidence, verification_status
            ) VALUES (
                'dc_compensated_emancipation_1862',
                'District of Columbia',
                $1, EXTRACT(YEAR FROM $1::date)::int, $2,
                'filed', $3, $4, $5,
                $6::jsonb, $7,
                $8, 'National Archives RG 217.6.5 (via civilwardc.org)', $9, $10,
                0.95, 'verified'
            ) RETURNING petition_id`,
            [
                p.filing_date,
                p.petition_id,
                primaryClaimant.name,
                primaryCanonicalId,
                primaryClaimant.residence || null,
                JSON.stringify(p.enslaved_persons_claimed),
                p.total_claimed_usd,
                p.html_url,
                CITATION,
                `Claimants (${p.claimants.length}): ${p.claimants.map(c => `${c.name} [${c.role}]`).join('; ')}. S3 archive: ${s3Keys.join(', ')}`,
            ]
        );
        petitionRowId = r.rows[0].petition_id;
        console.log(`  → historical_reparations_petitions.petition_id = ${petitionRowId}`);
    }

    for (const claimant of p.claimants) {
        const cpId = await resolveCanonical(claimant.name);
        if (!cpId) {
            console.log(`  ⚠ claimant "${claimant.name}" has no canonical enslaver — skipping person_documents`);
            continue;
        }
        for (let i = 0; i < s3Keys.length; i++) {
            if (APPLY) {
                await pool.query(
                    `INSERT INTO person_documents (
                        canonical_person_id, person_type, document_type,
                        document_date, document_year,
                        name_as_appears, s3_key, s3_url, source_url, source_type,
                        collection_name, image_number, page_reference,
                        extraction_confidence, human_verified
                    ) VALUES (
                        $1, 'enslaver', 'compensated_emancipation_petition',
                        $2, EXTRACT(YEAR FROM $2::date)::int,
                        $3, $4, $5, $6, 'civilwardc_org',
                        'DC 1862 Compensated Emancipation Act petitions', $7, $8,
                        0.95, false
                    )`,
                    [
                        cpId,
                        p.filing_date,
                        claimant.name,
                        s3Keys[i],
                        s3Urls[i],
                        p.html_url,
                        i + 1,
                        `${p.petition_id} page ${i + 1} of ${s3Keys.length}`,
                    ]
                );
            }
        }
        console.log(`  cp=${cpId} "${claimant.name}" ← ${s3Keys.length} person_documents row${s3Keys.length === 1 ? '' : 's'}`);
    }

    return { petitionRowId, s3Keys };
}

async function main() {
    console.log(`Mode: ${APPLY ? 'APPLY (live writes)' : 'DRY-RUN'}`);
    for (const p of PETITIONS) {
        try {
            await ingest(p);
        } catch (e) {
            console.error(`  ❌ ${p.petition_id}: ${e.message}`);
        }
    }

    if (APPLY) {
        console.log('\n━━━ Recall verification ━━━');
        for (const p of PETITIONS) {
            const primary = p.claimants[0].name;
            const cpId = await resolveCanonical(primary);
            const docs = await pool.query(
                `SELECT document_type, source_url, s3_key, page_reference
                 FROM person_documents
                 WHERE canonical_person_id = $1
                   AND document_type = 'compensated_emancipation_petition'
                 ORDER BY image_number`,
                [cpId]
            );
            const pet = await pool.query(
                `SELECT petition_id, claimant_name, total_claimed_usd,
                        jsonb_array_length(enslaved_persons_claimed) AS n_enslaved
                 FROM historical_reparations_petitions
                 WHERE docket_number = $1`,
                [p.petition_id]
            );
            console.log(`\n${p.petition_id}:`);
            console.log(`  canonical "${primary}" → cp=${cpId}`);
            console.log(`  petition row: ${pet.rowCount ? 'yes' : 'NO'} (claimed $${pet.rows[0]?.total_claimed_usd}, ${pet.rows[0]?.n_enslaved} enslaved)`);
            console.log(`  person_documents from cp=${cpId}: ${docs.rowCount}`);
            for (const d of docs.rows) {
                console.log(`    p${d.page_reference?.split(' ')[2] || '?'} → ${d.s3_key}`);
            }
        }
    } else {
        console.log('\nDRY-RUN — re-run with --apply to perform writes.');
    }

    await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
