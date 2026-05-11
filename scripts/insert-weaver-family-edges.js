#!/usr/bin/env node
/**
 * insert-weaver-family-edges.js
 *
 * Creates Mary Ann Weaver in canonical_persons (she's missing entirely)
 * and inserts the bidirectional Henry ↔ Mary Ann spouse edge.
 *
 * Evidence:
 *  - Henry Weaver will (1884): "spouse: Mary Ann Weaver"
 *  - Mary Ann Weaver will (1883): "spouse: Henry Weaver"
 *  - Both: Washington DC Orphans Court, cross-will accounting link delta=98 cents
 */

require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log('=== Weaver Family Edges Fix ===\n');

  // --- Step 1: Check if Mary Ann Weaver already exists ---
  const existing = await sql`
    SELECT id, canonical_name, person_type, death_year_estimate
    FROM canonical_persons
    WHERE canonical_name ILIKE '%mary ann weaver%'
       OR (first_name ILIKE '%mary%' AND last_name ILIKE '%weaver%' AND primary_state = 'DC')
    LIMIT 5
  `;
  console.log('Existing Mary Ann Weaver records:', existing);

  let maryAnnId;

  if (existing.length > 0) {
    maryAnnId = existing[0].id;
    console.log(`✓ Found existing record: id=${maryAnnId} name="${existing[0].canonical_name}"`);
  } else {
    // --- Step 2: Create Mary Ann Weaver ---
    console.log('Creating Mary Ann Weaver in canonical_persons...');
    const inserted = await sql`
      INSERT INTO canonical_persons (
        canonical_name, first_name, middle_name, last_name,
        death_year_estimate,
        person_type, confidence_score, verification_status,
        primary_state, primary_county,
        notes, created_by
      )
      VALUES (
        'Mary Ann Weaver',
        'Mary Ann', NULL, 'Weaver',
        1883,
        'enslaver', 0.95, 'verified',
        'DC', 'Washington',
        'Washington DC. Signed will 1883-05-10, died 1883-06-15. Spouse of Henry Weaver (id=196747). Prior marriage to Barnes (deceased). Properties: Drover''s Rest, Harlem Farm. Separate property held by husband: $12,250.34. Source: DC Orphans Court will cross-linked with Henry Weaver 1884 will (delta 98 cents).',
        'insert-weaver-family-edges.js'
      )
      RETURNING id, canonical_name
    `;
    maryAnnId = inserted[0].id;
    console.log(`✓ Created Mary Ann Weaver: id=${maryAnnId}`);
  }

  // --- Step 3: Check for existing spouse edge ---
  const existingEdge = await sql`
    SELECT id FROM canonical_family_edges
    WHERE relationship_type = 'spouse'
      AND (
        (person_a_id = 196747 AND person_b_id = ${maryAnnId})
        OR (person_a_id = ${maryAnnId} AND person_b_id = 196747)
      )
  `;

  if (existingEdge.length > 0) {
    console.log(`✓ Spouse edge already exists: id=${existingEdge[0].id}`);
  } else {
    // --- Step 4: Insert spouse edge ---
    const edge = await sql`
      INSERT INTO canonical_family_edges (
        person_a_id, person_b_id, relationship_type,
        evidence_tier, verified, confidence,
        notes, source_url
      )
      VALUES (
        196747, ${maryAnnId}, 'spouse',
        1, true, 1.0,
        'Primary source: Henry Weaver will (1884, DC Orphans Court) names Mary Ann Weaver as spouse. Mary Ann Weaver will (1883) names Henry Weaver as spouse. Cross-will accounting delta = 98 cents. Properties: Drover''s Rest, Harlem Farm.',
        'tests/fixtures/wills/henry-weaver-1884-ground-truth.json'
      )
      RETURNING id
    `;
    console.log(`✓ Inserted spouse edge: id=${edge[0].id}`);
  }

  // --- Step 5: Verify via family edge query ---
  const familyCheck = await sql`
    SELECT
      cfe.id, cfe.relationship_type, cfe.evidence_tier, cfe.verified,
      a.canonical_name AS person_a,
      b.canonical_name AS person_b
    FROM canonical_family_edges cfe
    JOIN canonical_persons a ON a.id = cfe.person_a_id
    JOIN canonical_persons b ON b.id = cfe.person_b_id
    WHERE 196747 IN (cfe.person_a_id, cfe.person_b_id)
       OR ${maryAnnId} IN (cfe.person_a_id, cfe.person_b_id)
  `;
  console.log('\nFamily edges for Weavers:');
  familyCheck.forEach(e => {
    console.log(`  [${e.id}] ${e.person_a} ↔ ${e.person_b} (${e.relationship_type}, tier=${e.evidence_tier}, verified=${e.verified})`);
  });

  // --- Step 6: Confirm Mary Ann is now searchable ---
  const searchCheck = await sql`
    SELECT id, canonical_name, person_type, death_year_estimate
    FROM canonical_persons
    WHERE id = ${maryAnnId}
  `;
  console.log('\nMary Ann Weaver canonical record:');
  console.log(JSON.stringify(searchCheck[0], null, 2));

  console.log('\n✅ Done. Henry Weaver (196747) ↔ Mary Ann Weaver now linked.');
  console.log(`   Visit: https://danyelajunebrown.github.io/Reparations-is-a-real-number/person/canonical_persons/196747`);
  console.log(`   Mary Ann: https://danyelajunebrown.github.io/Reparations-is-a-real-number/person/canonical_persons/${maryAnnId}`);
}

main().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
