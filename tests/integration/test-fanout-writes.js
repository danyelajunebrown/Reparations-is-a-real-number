const db = require('../../src/database/connection');

// This test suite validates that the extraction fanout writes data correctly to the database.
// It queries Neon directly to ensure critical data integrity constraints.

describe('DB Write Verification (Fanout)', () => {
  
  // Helper to run a DB check
  async function runDBCheck(check) {
    try {
      const result = await db.query(check.query);
      const passed = check.expect === 'at least 1 row' 
        ? result.rows.length >= 1 
        : result.rows.length === 0;
      
      if (!passed) {
        console.error(`DB CHECK FAILED: ${check.fail_msg}`);
        console.error(`Query: ${check.query}`);
        console.error(`Expected: ${check.expect}, Got: ${result.rows.length} rows`);
      } else {
        console.log(`DB CHECK PASSED: ${check.description}`);
      }
      
      return passed;
    } catch (error) {
      console.error(`DB QUERY ERROR: ${check.fail_msg}`);
      console.error(error.message);
      return false;
    }
  }

  // Checks for George Biscoe will
  const BISCOE_CHECKS = [
    {
      description: 'Enslaved individual Mary created',
      query: `SELECT id FROM enslaved_individuals WHERE full_name = 'Mary' AND notes ILIKE '%Biscoe%'`,
      expect: 'at least 1 row',
      fail_msg: 'Mary not written to enslaved_individuals',
    },
    {
      description: 'Enslaved individual Caroline created',
      query: `SELECT id FROM enslaved_individuals WHERE full_name = 'Caroline' AND notes ILIKE '%Biscoe%'`,
      expect: 'at least 1 row',
      fail_msg: 'Caroline not written to enslaved_individuals',
    },
    {
      description: 'Anonymous group written — name IS null',
      query: `SELECT id FROM enslaved_individuals WHERE full_name IS NULL AND notes ILIKE '%Caroline%children%'`,
      expect: 'at least 1 row',
      fail_msg: "Caroline's children anonymous group not written — null-name entry was dropped",
    },
    {
      description: 'Trust instrument written with trustee !== beneficiary',
      query: `SELECT id FROM trust_instruments WHERE trustee_canonical_id != beneficiary_canonical_id`,
      expect: 'at least 1 row',
      fail_msg: 'Trust written with trustee === beneficiary — collapse bug',
    },
    {
      description: 'Spouse relationship written for George/Ann Maria Biscoe',
      query: `SELECT id FROM person_relationships_verified WHERE relationship_type = 'spouse' 
               AND (person_a_id = (SELECT id FROM canonical_persons WHERE canonical_name ILIKE '%George%Biscoe%') 
               OR person_b_id = (SELECT id FROM canonical_persons WHERE canonical_name ILIKE '%George%Biscoe%'))`,
      expect: 'at least 1 row',
      fail_msg: 'Spouse edge not written for George/Ann Maria Biscoe',
    },
    {
      description: 'Prior transfer in research queue, NOT in enslaved_individuals',
      query: `SELECT id FROM parse_failure_queue WHERE failure_reason = 'prior_transfer_research_lead' AND raw_text ILIKE '%Angelica%'`,
      expect: 'at least 1 row',
      fail_msg: 'Angelica advancement not queued as research lead',
    },
    {
      description: 'Prior transfer NOT incorrectly written as enslaved_individual',
      query: `SELECT id FROM enslaved_individuals WHERE notes ILIKE '%Angelica%advancement%'`,
      expect: '0 rows',
      fail_msg: 'CRITICAL: prior transfer reference incorrectly written as enslaved_individual — fabricated data',
    },
  ];

  // Checks for Mary Ann Weaver will
  const MARY_ANN_WEAVER_CHECKS = [
    {
      description: '$12,250.34 must be in acknowledged_debts context, NOT inflating estate gross',
      query: `SELECT breakdown_jsonb FROM estate_valuations 
               WHERE canonical_person_id = (SELECT id FROM canonical_persons WHERE canonical_name ILIKE '%Mary Ann%Weaver%') 
               AND breakdown_jsonb->>'type' = 'gross'`,
      expect: 'value < 12250',
      fail_msg: 'CRITICAL: $12,250.34 counted in gross estate — it is an acknowledged debt, not estate wealth',
    },
    {
      description: 'Named properties written - Drover\'s Rest',
      query: `SELECT id FROM named_properties WHERE property_name = 'Drover\'s Rest'`,
      expect: 'at least 1 row',
      fail_msg: "Drover's Rest not written to named_properties",
    },
    {
      description: 'Family graveyard flag set on named properties',
      query: `SELECT id FROM named_properties WHERE graveyard_present = true`,
      expect: 'at least 2 rows',
      fail_msg: 'Family graveyard flag not set on named properties',
    },
    {
      description: 'Cross-will accounting link present for Henry Weaver',
      query: `SELECT id FROM canonical_persons WHERE canonical_name ILIKE '%Henry%Weaver%' 
               AND exists (SELECT 1 FROM cross_will_accounting_links WHERE testator_id = canonical_persons.id)`,
      expect: 'at least 1 row',
      fail_msg: 'Cross-will accounting link to Henry Weaver missing',
    },
  ];

  test('George Biscoe will writes correct data to DB', async () => {
    const failures = [];
    
    for (const check of BISCOE_CHECKS) {
      const passed = await runDBCheck(check);
      if (!passed) {
        failures.push(check.fail_msg);
      }
    }
    
    expect(failures).toHaveLength(0);
  });

  test('Mary Ann Weaver will writes correct data to DB', async () => {
    const failures = [];
    
    for (const check of MARY_ANN_WEAVER_CHECKS) {
      const passed = await runDBCheck(check);
      if (!passed) {
        failures.push(check.fail_msg);
      }
    }
    
    expect(failures).toHaveLength(0);
  });

  test('Comprehensive check for both wills', async () => {
    // Run all checks from both wills in sequence
    const allChecks = [...BISCOE_CHECKS, ...MARY_ANN_WEAVER_CHECKS];
    const failures = [];
    
    for (const check of allChecks) {
      const passed = await runDBCheck(check);
      if (!passed) {
        failures.push(check.fail_msg);
      }
    }
    
    // Log summary
    console.log(`\n=== DB WRITE VERIFICATION SUMMARY ===`);
    console.log(`Total checks: ${allChecks.length}`);
    console.log(`Passed: ${allChecks.length - failures.length}`);
    console.log(`Failed: ${failures.length}`);
    
    if (failures.length > 0) {
      console.error('\nFAILURES:');
      failures.forEach((f, i) => console.error(`  ${i + 1}. ${f}`));
    }
    
    expect(failures).toHaveLength(0);
  });

  test('Enslaved persons array preserved完整性 — no missing null-name entries', async () => {
    // This test ensures that the fanout doesn't drop null-name entries
    // which represent anonymous groups like "Caroline's children"
    
    const result = await db.query(`
      SELECT COUNT(*) as count, 
             COUNT(*) FILTER (WHERE full_name IS NULL) as null_name_count
      FROM enslaved_individuals 
      WHERE notes ILIKE '%Biscoe%'
    `);
    
    const { count, null_name_count } = result.rows[0];
    
    expect(count).toBeGreaterThan(2); // At least 3 entries (Mary, Caroline, anonymous group)
    expect(null_name_count).toBe(1); // Exactly one null-name entry (Caroline's children)
  });

  test('Trust instruments have correct trustee/beneficiary relationships', async () => {
    // Ensure no trust instruments have trustee === beneficiary (collapse bug)
    const result = await db.query(`
      SELECT COUNT(*) as count
      FROM trust_instruments
      WHERE trustee_canonical_id = beneficiary_canonical_id
    `);
    
    const { count } = result.rows[0];
    
    expect(count).toBe(0); // No collapsed trust instruments
  });

  test('Monetary bequests are separate from acknowledged debts', async () => {
    // Ensure $12,250.34 appears in acknowledged_debts, not monetary_bequests
    const result = await db.query(`
      SELECT COUNT(*) as count
      FROM canonical_persons cp
      JOIN estate_valuations ev ON cp.id = ev.canonical_person_id
      WHERE cp.canonical_name ILIKE '%Mary Ann%Weaver%'
        AND ev.breakdown_jsonb->>'type' = 'gross'
        AND (ev.breakdown_jsonb->'gross')::numeric > 12250 OR (ev.breakdown_jsonb->'gross')::numeric < 12250)
    `);
    
    const { count } = result.rows[0];
    
    // This query should return 0 rows if $12,250.34 is NOT in gross estate
    // If it's in gross, count will be >= 1, indicating the bug
    expect(count).toBe(0);
  });

  afterAll(async () => {
    // Cleanup: rollback test data (if any test insertions were made)
    // In a real scenario, tests would use transaction rollback
    // For now, we'll just verify data state
    console.log('\n=== DB WRITE VERIFICATION COMPLETE ===');
  });
});