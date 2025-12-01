/**
 * Demo: Adding Adjua d'Wolf Headstone Evidence
 * Shows how to enter diverse evidence types into the adaptive system
 */

const EvidenceManager = require('./evidence-manager');
const IndividualEntityManager = require('../../src/services/genealogy/EntityManager');
const pool = require('./database');

async function addAdjuaDWolfEvidence() {
  console.log('=== Adding Adjua d\'Wolf Headstone Evidence ===\n');

  const evidenceManager = new EvidenceManager();
  const entityManager = new IndividualEntityManager(pool);

  // First, ensure James d'Wolf exists in the system
  console.log('1. Finding or creating James d\'Wolf...');
  const jamesDWolfId = await entityManager.findOrCreateIndividual({
    fullName: 'James d\'Wolf',
    birthYear: 1764,
    deathYear: 1837,
    locations: ['Bristol, Rhode Island'],
    notes: 'Slave trader and United States Senator'
  });
  console.log(`   ✓ James d'Wolf ID: ${jamesDWolfId}\n`);

  // Create Adjua d'Wolf (enslaved person)
  console.log('2. Creating Adjua d\'Wolf record...');
  const adjuaDWolfId = await entityManager.findOrCreateIndividual({
    fullName: 'Adjua d\'Wolf',
    notes: 'Enslaved by James d\'Wolf, buried in Bristol, RI'
  });
  console.log(`   ✓ Adjua d'Wolf ID: ${adjuaDWolfId}\n`);

  // Add the headstone evidence
  console.log('3. Adding headstone evidence...');
  const headstoneEvidence = await evidenceManager.addEvidence({
    // Type (system learns this)
    evidenceType: 'headstone',

    // Core info
    title: 'Adjua d\'Wolf Headstone',
    description: 'Gravestone marking the burial place of Adjua d\'Wolf, enslaved by James d\'Wolf',

    // Content
    textContent: `ADJUA D'WOLF
Enslaved by James d'Wolf
[Inscription text from headstone]`,

    imageUrl: 'path/to/headstone-photo.jpg',  // Your photo
    sourceUrl: 'https://example.com/webpage-about-adjua',  // Webpage you found

    // Subjects
    subjectPersonId: adjuaDWolfId,
    subjectPersonName: 'Adjua d\'Wolf',

    // Link to James d'Wolf
    relatedPersons: [
      {
        personId: jamesDWolfId,
        relationship: 'enslaver',
        role: 'owner',
        notes: 'James d\'Wolf enslaved Adjua d\'Wolf'
      }
    ],

    // Provenance
    location: 'North Burial Ground, Bristol, Rhode Island',
    date: null,  // Headstone date if visible
    collectedBy: 'Danyela Brown',
    collectedDate: new Date().toISOString(),

    // What it proves
    proves: [
      'ownership',           // Proves James d'Wolf owned Adjua
      'existence',           // Proves Adjua d'Wolf existed
      'burial_location',     // Proves where buried
      'name_documentation'   // Documents the name
    ],
    confidence: 0.95,  // High confidence - physical evidence

    // Citations
    citations: [
      {
        type: 'physical_evidence',
        source: 'Headstone, North Burial Ground, Bristol, RI',
        date: new Date().toISOString()
      },
      {
        type: 'webpage',
        url: 'https://example.com/webpage',
        accessed: new Date().toISOString()
      }
    ],

    notes: `Physical headstone located in North Burial Ground.
Photo taken [date].
Webpage provides additional context about James d'Wolf's slave trading activities.`,

    // Custom metadata (completely flexible!)
    customMetadata: {
      cemetery: 'North Burial Ground',
      city: 'Bristol',
      state: 'Rhode Island',
      plot_number: null,
      headstone_condition: 'good',
      inscription_legible: true,
      photo_quality: 'high',
      webpage_archived: false,
      additional_sources: [
        'Bristol Historical Society records',
        'James d\'Wolf family papers'
      ]
    }
  });

  console.log(`   ✓ Evidence added: ${headstoneEvidence.evidenceId}\n`);

  // Now create the debt record
  console.log('4. Creating debt record...');
  const debtQuery = `
    INSERT INTO debt_lineage (
      debtor_id,
      debtor_generation,
      creditor_id,
      creditor_generation,
      debt_amount,
      debt_basis,
      evidence_id,
      status,
      notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `;

  const debtResult = await pool.query(debtQuery, [
    jamesDWolfId,           // James d'Wolf owes
    0,                      // Generation 0 (the enslaver)
    adjuaDWolfId,           // Adjua d'Wolf is owed
    0,                      // Generation 0 (the enslaved)
    2200000,                // $2.2M average reparations
    'direct_ownership',
    headstoneEvidence.evidenceId,
    'unpaid',
    'Documented via headstone evidence'
  ]);

  console.log(`   ✓ Debt record created: $2,200,000 owed\n`);

  // Build lineage tree
  console.log('5. Building James d\'Wolf lineage tree...');
  const lineage = await evidenceManager.buildLineageTree(jamesDWolfId, {
    maxDepth: 5,
    includeEvidence: true,
    includeDebt: true
  });

  console.log(`   ✓ Tree built:`);
  console.log(`     - Total descendants: ${lineage.totalDescendants}`);
  console.log(`     - Generations mapped: ${lineage.generations.length}`);
  console.log(`     - Total debt: $${lineage.totalDebt.toLocaleString()}\n`);

  // Show what the system learned
  console.log('6. System learned:');
  console.log(`   - New evidence type: "headstone"`);
  console.log(`   - Known evidence types: ${evidenceManager.getKnownEvidenceTypes().join(', ')}\n`);

  console.log('=== Success! ===');
  console.log('You can now:');
  console.log('- Add more evidence (photos, webpages, documents)');
  console.log('- Link to descendants of James d\'Wolf');
  console.log('- Track inherited debt to living heirs');
  console.log('- Build complete lineage trees\n');
}

// Run demo
addAdjuaDWolfEvidence()
  .then(() => console.log('✓ Demo complete'))
  .catch(err => console.error('Demo failed:', err));
