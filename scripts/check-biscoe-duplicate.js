#!/usr/bin/env node
require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

const STALE_ID = 141016;

(async () => {
  const [petitions, climbMatches, enslaved, relationships, extIds, personDocs] = await Promise.all([
    sql`SELECT petition_id, claimant_name FROM historical_reparations_petitions WHERE claimant_canonical_id = ${STALE_ID}`,
    sql`SELECT id FROM ancestor_climb_matches WHERE slaveholder_id = ${STALE_ID}`,
    sql`SELECT COUNT(*)::int as cnt FROM enslaved_individuals WHERE enslaved_by_individual_id = ${STALE_ID}`,
    sql`SELECT id, relationship_type FROM person_relationships_verified WHERE person_id = ${STALE_ID} OR related_person_id = ${STALE_ID}`,
    sql`SELECT id_system, external_id FROM person_external_ids WHERE canonical_person_id = ${STALE_ID}`,
    sql`SELECT document_type, title FROM person_documents WHERE canonical_person_id = ${STALE_ID}`,
  ]);

  console.log('=== FK audit for stale id=141016 ===');
  console.log('Petitions:', JSON.stringify(petitions));
  console.log('Climb matches:', JSON.stringify(climbMatches));
  console.log('Enslaved with enslaved_by=141016:', JSON.stringify(enslaved));
  console.log('Relationships:', JSON.stringify(relationships));
  console.log('External IDs:', JSON.stringify(extIds));
  console.log('Person docs:', JSON.stringify(personDocs));
})().catch(e => { console.error(e.message); process.exit(1); });
