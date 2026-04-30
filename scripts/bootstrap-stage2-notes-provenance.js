#!/usr/bin/env node
/**
 * Stage 2.5 backfill: extract primary-source citations from
 * canonical_persons.notes into enslaver_evidence_compendium.
 *
 * Stage 2 left 128,001 enslavers without a compendium row. Investigation
 * (2026-04-29) showed all 128,001 carry structured citations in their
 * notes column, populated by past bulk-import scripts. This script
 * extracts them via deterministic ILIKE pattern matching.
 *
 * Also bootstraps three smaller, structured sources that Stage 2 didn't
 * cover:
 *   - person_external_ids (50,574 expected to ground)
 *   - slave_era_insurance_policies (48 expected to ground)
 *   - debt_acknowledgment_agreements (1 expected to ground)
 *
 * All operations are idempotent via M053 unique index.
 *
 * Usage:
 *   node scripts/bootstrap-stage2-notes-provenance.js --dry-run
 *   node scripts/bootstrap-stage2-notes-provenance.js --apply
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
    if (r.length === 0) throw new Error(`methodology not found: ${name} — apply migration 062`);
    return r[0].id;
}

// Pattern -> {evidence_source_table, evidence_strength, ilike_pattern}
// Patterns are matched IN ORDER; first match wins for a given canonical_person.
const NOTES_PATTERNS = [
    { source: 'slavevoyages_transatlantic_ship_captain', strength: 'indirect_primary',
      ilike: 'SlaveVoyages transatlantic slave trade. Role: ship_captain%' },
    { source: 'slavevoyages_transatlantic_ship_owner', strength: 'direct_primary',
      ilike: 'SlaveVoyages transatlantic slave trade. Role: ship_owner%' },
    { source: 'slavevoyages_intraamerican_ship_captain', strength: 'indirect_primary',
      ilike: 'SlaveVoyages intraamerican slave trade. Role: ship_captain%' },
    { source: 'slavevoyages_intraamerican_ship_owner', strength: 'direct_primary',
      ilike: 'SlaveVoyages intraamerican slave trade. Role: ship_owner%' },
    { source: 'louisiana_slave_db_1860_schedule_promotion', strength: 'direct_primary',
      ilike: 'Promoted from unconfirmed_persons (1860 Slave Schedule). louisiana_slave_db_import%' },
    { source: 'census_1860_slave_schedule_ocr', strength: 'direct_primary',
      ilike: 'Promoted from unconfirmed_persons (1860 Slave Schedule). census_ocr_extraction%' },
    { source: 'santos_brazil_enslaved_census', strength: 'direct_primary',
      ilike: 'Santos, Brazil enslaved census%' },
    { source: 'slavevoyages_other_role', strength: 'indirect_primary',
      ilike: 'SlaveVoyages%' },  // catch-all for slavevoyages with other roles
    { source: 'civilwardc_petitions_notes_direct', strength: 'direct_primary',
      ilike: 'DC Compensated Emancipation petition. Source: https://civilwardc.org%' },
    { source: 'louisiana_slave_db_transactions', strength: 'direct_primary',
      ilike: 'Role: buyer | %| Source: Louisiana Slave Database%' },
    { source: 'louisiana_slave_db_transactions', strength: 'direct_primary',
      ilike: 'Role: seller | %| Source: Louisiana Slave Database%' },
    { source: 'natchez_district_probate', strength: 'direct_primary',
      ilike: 'Natchez District probate records%' },
    { source: 'mdsa_sc2908_vol812', strength: 'direct_primary',
      ilike: 'Slaveholder identified from Maryland State Archives SC 2908 Vol. 812%' },
    { source: 'book_of_negroes_1783_lac_carleton', strength: 'direct_primary',
      ilike: 'Slaveholder documented in Book of Negroes (1783)%LAC Carleton Papers%' },
    { source: 'thomas_porcher_ravenel_papers', strength: 'direct_primary',
      ilike: 'Slaveholder from Thomas Porcher Ravenel papers%' },
    { source: 'colonial_estate_inventory', strength: 'direct_primary',
      ilike: '%estate inventory dated%' },
    { source: 'colonial_estate_inventory', strength: 'direct_primary',
      ilike: 'Deceased slaveholder. Estate inventory%' },
    // Catch-all: any ungrounded enslaver whose notes describe slaveholding
    // gets a generic pointer to canonical_persons.notes itself. Strength is
    // secondary because we haven't verified the specific citation.
    { source: 'canonical_persons_notes_generic', strength: 'secondary',
      ilike: '%' },
];

async function bootstrapNotesPattern(pattern, methodologyId) {
    const summary = `notes-extract: ${pattern.source}`;
    if (DRY_RUN) {
        const r = await sql`
            SELECT COUNT(*)::int AS n
            FROM canonical_persons cp
            WHERE cp.person_type = 'enslaver'
              AND cp.notes ILIKE ${pattern.ilike}
              AND NOT EXISTS (
                  SELECT 1 FROM enslaver_evidence_compendium eec
                  WHERE eec.canonical_person_id = cp.id
              )
        `;
        return { source: pattern.source, would_insert: r[0].n, applied: 0 };
    }

    const r = await sql`
        INSERT INTO enslaver_evidence_compendium
            (canonical_person_id, evidence_source_table, evidence_source_id,
             evidence_strength, claim_summary, methodology_id, ingested_by)
        SELECT
            cp.id,
            ${pattern.source},
            cp.id::text,
            ${pattern.strength},
            'Notes-extracted citation: ' || SUBSTRING(cp.notes FROM 1 FOR 240),
            ${methodologyId}::uuid,
            'bootstrap-stage2.5-notes'
        FROM canonical_persons cp
        WHERE cp.person_type = 'enslaver'
          AND cp.notes ILIKE ${pattern.ilike}
          AND NOT EXISTS (
              SELECT 1 FROM enslaver_evidence_compendium eec
              WHERE eec.canonical_person_id = cp.id
          )
        ON CONFLICT (canonical_person_id, evidence_source_table, evidence_source_id,
                     COALESCE(methodology_id::text, '__null__'))
            DO NOTHING
        RETURNING id
    `;
    return { source: pattern.source, would_insert: null, applied: r.length };
}

async function bootstrapPersonExternalIds(methodologyId) {
    if (DRY_RUN) {
        const r = await sql`
            SELECT COUNT(*)::int AS n
            FROM person_external_ids pei
            INNER JOIN canonical_persons cp
                ON cp.id = pei.canonical_person_id AND cp.person_type = 'enslaver'
            WHERE pei.canonical_person_id IS NOT NULL
        `;
        return { source: 'person_external_ids', would_insert: r[0].n, applied: 0 };
    }

    const r = await sql`
        INSERT INTO enslaver_evidence_compendium
            (canonical_person_id, evidence_source_table, evidence_source_id,
             evidence_strength, claim_summary, methodology_id, ingested_by)
        SELECT
            pei.canonical_person_id,
            'person_external_ids',
            pei.id::text,
            'indirect_primary',
            'External ID linkage: ' || COALESCE(pei.id_system, 'unknown')
                || COALESCE(' / ' || pei.external_id, ''),
            ${methodologyId}::uuid,
            'bootstrap-stage2.5'
        FROM person_external_ids pei
        INNER JOIN canonical_persons cp
            ON cp.id = pei.canonical_person_id AND cp.person_type = 'enslaver'
        WHERE pei.canonical_person_id IS NOT NULL
        ON CONFLICT (canonical_person_id, evidence_source_table, evidence_source_id,
                     COALESCE(methodology_id::text, '__null__'))
            DO NOTHING
        RETURNING id
    `;
    return { source: 'person_external_ids', would_insert: null, applied: r.length };
}

async function bootstrapInsurancePolicies() {
    if (DRY_RUN) {
        const r = await sql`
            SELECT COUNT(*)::int AS n
            FROM slave_era_insurance_policies sip
            INNER JOIN canonical_persons cp
                ON cp.id = sip.slaveholder_canonical_id AND cp.person_type = 'enslaver'
            WHERE sip.slaveholder_canonical_id IS NOT NULL
        `;
        return { source: 'slave_era_insurance_policies', would_insert: r[0].n, applied: 0 };
    }

    const r = await sql`
        INSERT INTO enslaver_evidence_compendium
            (canonical_person_id, evidence_source_table, evidence_source_id,
             evidence_strength, claim_summary, ingested_by)
        SELECT
            sip.slaveholder_canonical_id,
            'slave_era_insurance_policies',
            sip.policy_id::text,
            'direct_primary',
            'Slave-era insurance policy registered to slaveholder',
            'bootstrap-stage2.5'
        FROM slave_era_insurance_policies sip
        INNER JOIN canonical_persons cp
            ON cp.id = sip.slaveholder_canonical_id AND cp.person_type = 'enslaver'
        WHERE sip.slaveholder_canonical_id IS NOT NULL
        ON CONFLICT (canonical_person_id, evidence_source_table, evidence_source_id,
                     COALESCE(methodology_id::text, '__null__'))
            DO NOTHING
        RETURNING id
    `;
    return { source: 'slave_era_insurance_policies', would_insert: null, applied: r.length };
}

async function bootstrapDebtAcknowledgments() {
    if (DRY_RUN) {
        const r = await sql`
            SELECT COUNT(*)::int AS n
            FROM debt_acknowledgment_agreements daa
            INNER JOIN canonical_persons cp
                ON cp.id = daa.slaveholder_canonical_id AND cp.person_type = 'enslaver'
            WHERE daa.slaveholder_canonical_id IS NOT NULL
        `;
        return { source: 'debt_acknowledgment_agreements', would_insert: r[0].n, applied: 0 };
    }

    const r = await sql`
        INSERT INTO enslaver_evidence_compendium
            (canonical_person_id, evidence_source_table, evidence_source_id,
             evidence_strength, claim_summary, ingested_by)
        SELECT
            daa.slaveholder_canonical_id,
            'debt_acknowledgment_agreements',
            daa.daa_id::text,
            'direct_primary',
            'Corporate debt acknowledgment agreement',
            'bootstrap-stage2.5'
        FROM debt_acknowledgment_agreements daa
        INNER JOIN canonical_persons cp
            ON cp.id = daa.slaveholder_canonical_id AND cp.person_type = 'enslaver'
        WHERE daa.slaveholder_canonical_id IS NOT NULL
        ON CONFLICT (canonical_person_id, evidence_source_table, evidence_source_id,
                     COALESCE(methodology_id::text, '__null__'))
            DO NOTHING
        RETURNING id
    `;
    return { source: 'debt_acknowledgment_agreements', would_insert: null, applied: r.length };
}

(async () => {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  Stage 2.5: notes-provenance extraction + small sources');
    console.log(`  Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    const notesMethodId = await getMethodologyId('canonical_persons_notes_provenance_parser');
    const peiMethodId = await getMethodologyId('person_external_ids_pointer');

    console.log(`notes-parser methodology: ${notesMethodId}`);
    console.log(`pei methodology:          ${peiMethodId}\n`);

    const before = await sql`SELECT COUNT(*)::int AS n FROM enslaver_evidence_compendium`;
    const beforeUngrounded = await sql`
        SELECT COUNT(*)::int AS n FROM canonical_persons cp
        WHERE cp.person_type = 'enslaver'
          AND NOT EXISTS (
              SELECT 1 FROM enslaver_evidence_compendium eec
              WHERE eec.canonical_person_id = cp.id
          )
    `;
    console.log(`Compendium rows before:    ${before[0].n}`);
    console.log(`Ungrounded enslavers before: ${beforeUngrounded[0].n}\n`);

    let totalInserted = 0;

    // Phase 1: notes-pattern extraction
    console.log('Phase 1/2  notes-pattern extraction');
    for (const p of NOTES_PATTERNS) {
        const r = await bootstrapNotesPattern(p, notesMethodId);
        const v = r.would_insert ?? r.applied;
        console.log(`  ${p.source.padEnd(50)} ${DRY_RUN ? 'would' : 'inserted'}=${v}`);
        if (!DRY_RUN) totalInserted += r.applied;
    }

    // Phase 2: small structured sources
    console.log('\nPhase 2/2  small structured sources');
    const r2a = await bootstrapPersonExternalIds(peiMethodId);
    console.log(`  ${'person_external_ids'.padEnd(50)} ${DRY_RUN ? 'would' : 'inserted'}=${r2a.would_insert ?? r2a.applied}`);
    if (!DRY_RUN) totalInserted += r2a.applied;

    const r2b = await bootstrapInsurancePolicies();
    console.log(`  ${'slave_era_insurance_policies'.padEnd(50)} ${DRY_RUN ? 'would' : 'inserted'}=${r2b.would_insert ?? r2b.applied}`);
    if (!DRY_RUN) totalInserted += r2b.applied;

    const r2c = await bootstrapDebtAcknowledgments();
    console.log(`  ${'debt_acknowledgment_agreements'.padEnd(50)} ${DRY_RUN ? 'would' : 'inserted'}=${r2c.would_insert ?? r2c.applied}`);
    if (!DRY_RUN) totalInserted += r2c.applied;

    if (!DRY_RUN) {
        const after = await sql`SELECT COUNT(*)::int AS n FROM enslaver_evidence_compendium`;
        const afterUngrounded = await sql`
            SELECT COUNT(*)::int AS n FROM canonical_persons cp
            WHERE cp.person_type = 'enslaver'
              AND NOT EXISTS (
                  SELECT 1 FROM enslaver_evidence_compendium eec
                  WHERE eec.canonical_person_id = cp.id
              )
        `;
        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log(`Total inserted this run:     ${totalInserted}`);
        console.log(`Compendium rows after:       ${after[0].n}`);
        console.log(`Ungrounded enslavers after:  ${afterUngrounded[0].n}`);
        console.log(`Reduction:                   ${beforeUngrounded[0].n - afterUngrounded[0].n}`);
        if (afterUngrounded[0].n > 0) {
            console.log(`\n⚠  ${afterUngrounded[0].n} enslavers remain ungrounded — investigate residual.`);
        }
        console.log('═══════════════════════════════════════════════════════════════');
    } else {
        console.log('\nDry run complete. Run with --apply to insert.');
    }
})().catch(e => {
    console.error('FATAL:', e.message);
    console.error(e.stack);
    process.exit(1);
});
