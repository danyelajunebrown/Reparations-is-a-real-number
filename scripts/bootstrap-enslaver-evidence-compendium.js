#!/usr/bin/env node
/**
 * Stage 2 (revised) bootstrap of enslaver_evidence_compendium (M053).
 *
 * Per memory-bank/plan-apr29-will-source-registry-dual-ledger-daa.md §7,
 * with the architectural revision filed 2026-04-29: we do NOT bulk-
 * backfill family_relationships into M052. We DO retroactively populate
 * the evidence compendium for every canonical_person currently classified
 * as person_type='enslaver' so that the new "compendium-rollup drives
 * classification" rule has the audit trail it requires.
 *
 * Three source streams handled here. Each runs as a single bulk
 * INSERT-FROM-SELECT, idempotent via the UNIQUE INDEX on
 * (canonical_person_id, evidence_source_table, evidence_source_id,
 *  COALESCE(methodology_id::text, '__null__')).
 *
 *   1. person_documents — Tier B (indirect_primary). Cites the
 *      legacy_person_documents_pointer methodology. ~4,179 rows expected
 *      against current data.
 *
 *   2. historical_reparations_petitions (M041) — Tier A (direct_primary).
 *      Cites historical_reparations_petitions_direct methodology. ~947
 *      rows expected against current data.
 *
 *   3. family_relationships(enslaved_by) — Tier C (secondary). Joined
 *      to canonical_persons by name (LOWER) since family_relationships
 *      predates the identity system. Cites
 *      legacy_family_relationships_pointer methodology. ~2M legacy rows
 *      will be examined; only those whose person1_name (slaveholder)
 *      matches a current enslaver canonical_person become compendium
 *      rows.
 *
 * Sources NOT included in this bootstrap:
 *   - corporate_slaveholding (1 row, no canonical link)
 *   - corporate_slavery_disclosures (15 rows, no canonical link)
 *   - corporate_debt_acknowledgments (0 rows)
 *   - land_transfer_events (1 row with enslaver_person_id non-null)
 *   - corporate_slavery_evidence (table does not exist in DB; M043 was
 *     marked applied via backfill but the actual schema differs)
 * These either lack the canonical_person_id linkage required to attribute
 * evidence, or have so few rows that special-casing them costs more than
 * it earns. They will be picked up by the going-forward compiler service
 * once those tables are populated by future ingestion.
 *
 * Usage:
 *   node scripts/bootstrap-enslaver-evidence-compendium.js --dry-run
 *   node scripts/bootstrap-enslaver-evidence-compendium.js --apply
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DRY_RUN = args.includes('--dry-run') || !APPLY;

async function getMethodologyId(name) {
    const r = await sql`
        SELECT id FROM estimation_methodology_registry
        WHERE name = ${name} AND deprecated_at IS NULL
        ORDER BY version DESC LIMIT 1
    `;
    if (r.length === 0) {
        throw new Error(`methodology row not found: ${name} — apply migration 061 first`);
    }
    return r[0].id;
}

async function bootstrapPersonDocuments(methodologyId) {
    // Tier B (indirect_primary). Each person_documents row attributing a
    // document to a canonical_person whose person_type is 'enslaver'
    // becomes one compendium row.
    if (DRY_RUN) {
        const r = await sql`
            SELECT COUNT(*)::int AS n
            FROM person_documents pd
            INNER JOIN canonical_persons cp
                ON cp.id = pd.canonical_person_id AND cp.person_type = 'enslaver'
            WHERE pd.canonical_person_id IS NOT NULL
        `;
        return { source: 'person_documents', would_insert: r[0].n, applied: 0 };
    }

    const r = await sql`
        INSERT INTO enslaver_evidence_compendium
            (canonical_person_id, evidence_source_table, evidence_source_id,
             evidence_strength, claim_summary, methodology_id, ingested_by)
        SELECT
            pd.canonical_person_id,
            'person_documents',
            pd.id::text,
            'indirect_primary',
            'Document linkage: ' || COALESCE(pd.document_type, 'unspecified')
                || COALESCE(' (' || pd.document_year || ')', '')
                || COALESCE(', source: ' || pd.source_type, ''),
            ${methodologyId}::uuid,
            'bootstrap-stage2'
        FROM person_documents pd
        INNER JOIN canonical_persons cp
            ON cp.id = pd.canonical_person_id AND cp.person_type = 'enslaver'
        WHERE pd.canonical_person_id IS NOT NULL
        ON CONFLICT (canonical_person_id, evidence_source_table, evidence_source_id,
                     COALESCE(methodology_id::text, '__null__'))
            DO NOTHING
        RETURNING id
    `;
    return { source: 'person_documents', would_insert: null, applied: r.length };
}

async function bootstrapHistoricalReparationsPetitions(methodologyId) {
    // Tier A (direct_primary). Government compensation petition is a
    // direct primary document; the claimant is the enslaver by document
    // definition.
    if (DRY_RUN) {
        const r = await sql`
            SELECT COUNT(*)::int AS n
            FROM historical_reparations_petitions hrp
            INNER JOIN canonical_persons cp
                ON cp.id = hrp.claimant_canonical_id AND cp.person_type = 'enslaver'
            WHERE hrp.claimant_canonical_id IS NOT NULL
        `;
        return { source: 'historical_reparations_petitions', would_insert: r[0].n, applied: 0 };
    }

    const r = await sql`
        INSERT INTO enslaver_evidence_compendium
            (canonical_person_id, evidence_source_table, evidence_source_id,
             evidence_strength, claim_summary, methodology_id, ingested_by)
        SELECT
            hrp.claimant_canonical_id,
            'historical_reparations_petitions',
            hrp.petition_id::text,
            'direct_primary',
            'Government compensation petition by claimant '
                || COALESCE(hrp.claimant_name, '(unnamed)')
                || COALESCE(' of ' || hrp.claimant_residence, ''),
            ${methodologyId}::uuid,
            'bootstrap-stage2'
        FROM historical_reparations_petitions hrp
        INNER JOIN canonical_persons cp
            ON cp.id = hrp.claimant_canonical_id AND cp.person_type = 'enslaver'
        WHERE hrp.claimant_canonical_id IS NOT NULL
        ON CONFLICT (canonical_person_id, evidence_source_table, evidence_source_id,
                     COALESCE(methodology_id::text, '__null__'))
            DO NOTHING
        RETURNING id
    `;
    return { source: 'historical_reparations_petitions', would_insert: null, applied: r.length };
}

async function bootstrapFamilyRelationships(methodologyId) {
    // Tier C (secondary). Name-based join from family_relationships
    // person1_name (the slaveholder side) to canonical_persons.canonical_name
    // where person_type='enslaver'. The name match produces false positives
    // for common names; the methodology row documents this limitation and
    // assigns the secondary tier accordingly.
    //
    // NOTE: we attribute to the FIRST matching canonical_persons row by
    // canonical_name (case-insensitive). Multiple canonical_persons may
    // share a name; this is a known limitation of the legacy data and is
    // surfaced via the methodology citation.
    if (DRY_RUN) {
        const r = await sql`
            SELECT COUNT(*)::int AS n
            FROM family_relationships fr
            INNER JOIN canonical_persons cp
                ON LOWER(TRIM(fr.person1_name)) = LOWER(TRIM(cp.canonical_name))
                AND cp.person_type = 'enslaver'
            WHERE fr.relationship_type = 'enslaved_by'
              AND fr.person1_role = 'slaveholder'
              AND fr.person1_name IS NOT NULL
              AND LENGTH(TRIM(fr.person1_name)) >= 5
        `;
        return { source: 'family_relationships', would_insert: r[0].n, applied: 0 };
    }

    // Apply in batches to avoid loading 2M rows into a single statement
    // result. We process in 50K-row chunks keyed on family_relationships.id.
    const BATCH = 50000;
    let totalApplied = 0;
    let lastId = 0;
    while (true) {
        const r = await sql`
            INSERT INTO enslaver_evidence_compendium
                (canonical_person_id, evidence_source_table, evidence_source_id,
                 evidence_strength, claim_summary, methodology_id, ingested_by)
            SELECT
                cp.id,
                'family_relationships',
                fr.id::text,
                'secondary',
                'Legacy family_relationships(enslaved_by): "'
                    || fr.person1_name || '" enslaver of "'
                    || COALESCE(fr.person2_name, '(unnamed enslaved)') || '"',
                ${methodologyId}::uuid,
                'bootstrap-stage2'
            FROM family_relationships fr
            INNER JOIN canonical_persons cp
                ON LOWER(TRIM(fr.person1_name)) = LOWER(TRIM(cp.canonical_name))
                AND cp.person_type = 'enslaver'
            WHERE fr.relationship_type = 'enslaved_by'
              AND fr.person1_role = 'slaveholder'
              AND fr.person1_name IS NOT NULL
              AND LENGTH(TRIM(fr.person1_name)) >= 5
              AND fr.id > ${lastId}
              AND fr.id <= ${lastId + BATCH}
            ON CONFLICT (canonical_person_id, evidence_source_table, evidence_source_id,
                         COALESCE(methodology_id::text, '__null__'))
                DO NOTHING
            RETURNING id
        `;
        const inserted = r.length;
        totalApplied += inserted;

        // Track high-water mark of family_relationships.id we've processed
        const maxR = await sql`
            SELECT MAX(id)::int AS m FROM family_relationships
            WHERE id > ${lastId} AND id <= ${lastId + BATCH}
        `;
        if (maxR[0].m === null) break;
        lastId += BATCH;

        const overall = await sql`SELECT MAX(id)::int AS m FROM family_relationships`;
        if (lastId >= (overall[0].m || 0)) break;

        process.stdout.write(`    family_relationships batch through id ${lastId}: +${inserted} this batch, total ${totalApplied}\n`);
    }

    return { source: 'family_relationships', would_insert: null, applied: totalApplied };
}

(async () => {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  Stage 2 (revised): enslaver_evidence_compendium bootstrap');
    console.log(`  Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Pre-flight: methodology rows must exist (M060 + M061).
    const personDocsMethodId = await getMethodologyId('legacy_person_documents_pointer');
    const hrpMethodId = await getMethodologyId('historical_reparations_petitions_direct');
    const frMethodId = await getMethodologyId('legacy_family_relationships_pointer');

    console.log('Methodology rows resolved:');
    console.log(`  legacy_person_documents_pointer        : ${personDocsMethodId}`);
    console.log(`  historical_reparations_petitions_direct: ${hrpMethodId}`);
    console.log(`  legacy_family_relationships_pointer    : ${frMethodId}\n`);

    // Pre-bootstrap state
    const before = await sql`SELECT COUNT(*)::int AS n FROM enslaver_evidence_compendium`;
    console.log(`Compendium rows before: ${before[0].n}\n`);

    const results = [];

    console.log('1/3  person_documents → compendium');
    results.push(await bootstrapPersonDocuments(personDocsMethodId));
    console.log(`     ${DRY_RUN ? 'would insert' : 'inserted'}: ${results[0].would_insert ?? results[0].applied}\n`);

    console.log('2/3  historical_reparations_petitions → compendium');
    results.push(await bootstrapHistoricalReparationsPetitions(hrpMethodId));
    console.log(`     ${DRY_RUN ? 'would insert' : 'inserted'}: ${results[1].would_insert ?? results[1].applied}\n`);

    console.log('3/3  family_relationships → compendium (legacy, name-matched)');
    results.push(await bootstrapFamilyRelationships(frMethodId));
    console.log(`     ${DRY_RUN ? 'would insert' : 'inserted'}: ${results[2].would_insert ?? results[2].applied}\n`);

    if (!DRY_RUN) {
        const after = await sql`SELECT COUNT(*)::int AS n FROM enslaver_evidence_compendium`;
        const enslavers = await sql`
            SELECT COUNT(DISTINCT canonical_person_id)::int AS n FROM enslaver_evidence_compendium
        `;
        const groundedEnslavers = await sql`
            SELECT COUNT(*)::int AS n FROM canonical_persons cp
            WHERE cp.person_type = 'enslaver'
              AND EXISTS (
                  SELECT 1 FROM enslaver_evidence_compendium eec
                  WHERE eec.canonical_person_id = cp.id
              )
        `;
        const totalEnslavers = await sql`
            SELECT COUNT(*)::int AS n FROM canonical_persons WHERE person_type = 'enslaver'
        `;
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(`Compendium rows after:           ${after[0].n}`);
        console.log(`Distinct enslavers in compendium: ${enslavers[0].n}`);
        console.log(`Enslaver classifications grounded by ≥1 compendium row: ${groundedEnslavers[0].n} / ${totalEnslavers[0].n}`);
        const ungrounded = totalEnslavers[0].n - groundedEnslavers[0].n;
        if (ungrounded > 0) {
            console.log(`⚠  ${ungrounded} enslaver-classified canonical_persons still have NO compendium evidence. These will need attention via the going-forward compiler.`);
        }
        console.log('═══════════════════════════════════════════════════════════════');
    } else {
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('Dry run complete. Run with --apply to insert.');
        console.log('═══════════════════════════════════════════════════════════════');
    }
})().catch(e => {
    console.error('FATAL:', e.message);
    console.error(e.stack);
    process.exit(1);
});
