// scripts/backfill-freedmans-line-items.mjs

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
});

async function backfillFreedmansLineItems(dryRun = true) {
    const client = await pool.connect();
    let totalProcessed = 0;
    let totalInserted = 0;
    let totalSkippedUnlinked = 0;

    try {
        console.log(`Starting Freedman's Bank Line Items Backfill (Dry Run: ${dryRun})...`);

        // Cache lookups
        const freedmansCategoryResult = await client.query(
            "SELECT id FROM reparations_harm_categories WHERE category_key = 'freedmans_bank_collapse'"
        );
        const freedmansCategoryId = freedmansCategoryResult.rows[0]?.id;
        if (!freedmansCategoryId) {
            throw new Error('Freedman\'s Bank harm category not found.');
        }

        const federalPerpetratorResult = await client.query(
            "SELECT id FROM harm_perpetrator_entities WHERE entity_key = 'us_federal_government'"
        );
        const federalPerpetratorId = federalPerpetratorResult.rows[0]?.id;
        if (!federalPerpetratorId) {
            throw new Error('US Federal Government perpetrator entity not found.');
        }

        const domesticTheoryResult = await client.query(
            "SELECT id FROM legal_theory_registry WHERE theory_key = 'domestic_breach_government_duty'"
        );
        const domesticTheoryId = domesticTheoryResult.rows[0]?.id;
        if (!domesticTheoryId) {
            throw new Error('Domestic Breach of Government Duty legal theory not found.');
        }

        console.log('Cached IDs:', { freedmansCategoryId, federalPerpetratorId, domesticTheoryId });

        const batchSize = 1000;
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            const personsResult = await client.query(`
                SELECT
                    up.lead_id,
                    up.confirmed_individual_id,
                    up.relationships->'docai_fields' as docai_fields
                FROM unconfirmed_persons up
                WHERE up.extraction_method IN ('freedmens_bank_index', 'freedmens_bank_ocr')
                  -- Only depositors resolved to an EXISTING canonical_persons row:
                  -- confirmed_individual_id is varchar and may be non-numeric or
                  -- reference a since-deleted id, which would violate the
                  -- canonical_person_id FK. Filter both out here.
                  AND up.confirmed_individual_id ~ '^[0-9]+$'
                  AND EXISTS (
                      SELECT 1 FROM canonical_persons cp
                      WHERE cp.id = up.confirmed_individual_id::int
                  )
                ORDER BY up.lead_id
                LIMIT $1 OFFSET $2
            `, [batchSize, offset]);

            if (personsResult.rows.length === 0) {
                hasMore = false;
                break;
            }

            const insertValues = [];
            for (const person of personsResult.rows) {
                // Only attributable depositors get a line item: confirmed_individual_id
                // is the canonical_persons.id this loss flows to. Depositors not yet
                // resolved to a canonical person are skipped (counted, not silently
                // dropped) — they can be backfilled once identity resolution links them.
                if (!person.confirmed_individual_id) { totalSkippedUnlinked++; continue; }
                const docaiFields = person.docai_fields;
                let baseAmount = 42.00; // Median estimate

                if (docaiFields && docaiFields.account_balance) {
                    // Attempt to extract account balance from docai_fields
                    const balanceStr = String(docaiFields.account_balance).replace(/[^\d.]/g, '');
                    const parsedBalance = parseFloat(balanceStr);
                    if (!isNaN(parsedBalance)) {
                        baseAmount = parsedBalance;
                    }
                }

                // Apply recovery rate and compound interest
                const adjustedBaseAmount = baseAmount * (1 - 0.25); // 25% recovery rate
                const compoundedAmount = adjustedBaseAmount * Math.pow(1.05, 2024 - 1874);

                insertValues.push(`(
                    'individual',
                    ${person.confirmed_individual_id ? `'${person.confirmed_individual_id}'` : 'NULL'},
                    '${freedmansCategoryId}',
                    1,
                    'unconfirmed_persons',
                    '${person.lead_id}',
                    ${adjustedBaseAmount},
                    1874,
                    0.05,
                    2024,
                    ${compoundedAmount},
                    '${federalPerpetratorId}',
                    ARRAY['${domesticTheoryId}']::uuid[],
                    'freedmans_bank_direct_loss',
                    'Freedman''s Savings and Trust Co. depositor record; Hill Edwards 2024 (Savings and Trust); National Archives'
                )`);
            }

            if (insertValues.length > 0) {
                const insertQuery = `
                    INSERT INTO reparations_line_items (
                        beneficiary_type, canonical_person_id, harm_category_id,
                        evidence_tier, evidence_source_table, evidence_source_id,
                        base_amount_usd, base_year, compound_rate, compound_to_year,
                        compounded_amount_usd, perpetrator_entity_id, legal_theory_ids,
                        calculation_method_key, citation
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

        console.log(`Backfill complete. Total processed: ${totalProcessed}, Total inserted: ${totalInserted}, Skipped (no canonical link): ${totalSkippedUnlinked}.`);
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

backfillFreedmansLineItems(applyChanges ? false : true).catch(console.error);
