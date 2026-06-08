// scripts/backfill-middle-passage-line-items.mjs

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
});

async function backfillMiddlePassageLineItems(dryRun = true) {
    const client = await pool.connect();
    let totalProcessed = 0;
    let totalInserted = 0;

    try {
        console.log(`Starting Middle Passage Line Items Backfill (Dry Run: ${dryRun})...`);

        // Cache lookups
        const middlePassageResult = await client.query(
            "SELECT id FROM reparations_harm_categories WHERE category_key = 'middle_passage_extraction'"
        );
        const middlePassageId = middlePassageResult.rows[0]?.id;
        if (!middlePassageId) {
            throw new Error('Middle Passage harm category not found.');
        }

        const jusCogensResult = await client.query(
            "SELECT id FROM legal_theory_registry WHERE theory_key = 'international_jus_cogens'"
        );
        const jusCogensId = jusCogensResult.rows[0]?.id;
        if (!jusCogensId) {
            throw new Error('International Jus Cogens legal theory not found.');
        }

        const crimeAgainstHumanityResult = await client.query(
            "SELECT id FROM legal_theory_registry WHERE theory_key = 'international_crime_against_humanity'"
        );
        const crimeAgainstHumanityId = crimeAgainstHumanityResult.rows[0]?.id;
        if (!crimeAgainstHumanityId) {
            throw new Error('International Crime Against Humanity legal theory not found.');
        }

        console.log('Cached IDs:', { middlePassageId, jusCogensId, crimeAgainstHumanityId });

        const batchSize = 1000;
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            const personsResult = await client.query(`
                SELECT
                    id,
                    birth_year_estimate,
                    death_year_estimate
                FROM canonical_persons
                WHERE
                    person_type IN ('enslaved', 'enslaved_individual', 'enslaved_person')
                    AND birth_year_estimate IS NOT NULL
                    AND death_year_estimate IS NOT NULL
                    AND death_year_estimate > birth_year_estimate
                ORDER BY id
                LIMIT $1 OFFSET $2
            `, [batchSize, offset]);

            if (personsResult.rows.length === 0) {
                hasMore = false;
                break;
            }

            const insertValues = [];
            for (const person of personsResult.rows) {
                const personYears = person.death_year_estimate - person.birth_year_estimate;
                const baseAmount = personYears * 96000;

                insertValues.push(`(
                    'individual',
                    '${person.id}',
                    '${middlePassageId}',
                    1,
                    'canonical_persons',
                    '${person.id}',
                    ${baseAmount},
                    ${person.birth_year_estimate},
                    0,
                    2023,
                    ${baseAmount},
                    'loss_of_life_and_labour',
                    'USA',
                    ARRAY['${jusCogensId}', '${crimeAgainstHumanityId}']::uuid[],
                    'brattle_802m_person_years',
                    'Brattle Group 2023 (ASIL/UWI); UNGA Resolution A/80/L.48 (2026)'
                )`);
            }

            if (insertValues.length > 0) {
                const insertQuery = `
                    INSERT INTO reparations_line_items (
                        beneficiary_type, canonical_person_id, harm_category_id,
                        evidence_tier, evidence_source_table, evidence_source_id,
                        base_amount_usd, base_year, compound_rate, compound_to_year,
                        compounded_amount_usd, brattle_head, perpetrating_nation,
                        legal_theory_ids, calculation_method_key, citation
                    ) VALUES ${insertValues.join(',')}
                    ON CONFLICT DO NOTHING;
                `;

                if (!dryRun) {
                    const res = await client.query(insertQuery);
                    totalInserted += res.rowCount;
                }
            }

            totalProcessed += personsResult.rows.length;
            console.log(`Processed ${totalProcessed} rows, inserted ${totalInserted} new line items in this batch.`);

            offset += batchSize;
        }

        console.log(`Backfill complete. Total processed: ${totalProcessed}, Total inserted: ${totalInserted}.`);
    } catch (error) {
        console.error('Error during backfill:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

// Check for --apply argument
const args = process.argv.slice(2);
const applyChanges = args.includes('--apply');

backfillMiddlePassageLineItems(applyChanges ? false : true).catch(console.error);
