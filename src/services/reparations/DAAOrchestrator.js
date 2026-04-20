/**
 * DAA Orchestrator
 * 
 * Coordinates the complete DAA generation process:
 * 1. Runs (or resumes) ancestor climb to find ALL slaveholders
 * 2. Aggregates enslaved persons with primary source documentation
 * 3. Calculates total debt across all slaveholders
 * 4. Generates comprehensive DAA with DOCX document
 * 
 * This bridges the gap between the ancestor climber and DAA generator.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const TieredPaymentCalculator = require('./TieredPaymentCalculator');
const WealthGapCalculator = require('./WealthGapCalculator');
const CorporateSuccessionTracer = require('./CorporateSuccessionTracer');

/**
 * Thrown by _enforceProbateGate when the slaveholders identified for a
 * DAA don't have the probate / deed / administration records required
 * to compute per-descendant inheritance shares. The DAA is NOT generated;
 * the error message lists which ancestors need records ingested.
 */
class DAAProbateGateError extends Error {
    constructor(message) {
        super(message);
        this.name = 'DAAProbateGateError';
        this.code = 'DAA_PROBATE_GATE';
    }
}

class DAAOrchestrator {
    constructor(database, daaGenerator, documentGenerator) {
        this.db = database;
        this.daaGenerator = daaGenerator;
        this.documentGenerator = documentGenerator;
        this.tieredCalc = new TieredPaymentCalculator();
        this.wealthGapCalc = new WealthGapCalculator();
        this.successionTracer = new CorporateSuccessionTracer(database);
    }

    /**
     * Main entry point: Generate comprehensive DAA for a modern person
     * 
     * @param {string} familySearchId - FamilySearch ID of modern person
     * @param {Object} acknowledgerInfo - Acknowledger details
     * @returns {Object} Complete DAA record and document path
     */
    async generateComprehensiveDAA(familySearchId, acknowledgerInfo, sessionId = null) {
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('   COMPREHENSIVE DAA GENERATION');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(`Modern Person: ${acknowledgerInfo.name} (${familySearchId})`);
        console.log();

        // Step 1: Ensure ancestor climb is complete
        console.log('Step 1: Checking ancestor climb status...');
        const climbSession = await this.ensureClimbComplete(familySearchId, acknowledgerInfo.name, sessionId);
        console.log(`   ✓ Climb session: ${climbSession.id}`);
        console.log(`   ✓ Matches found: ${climbSession.matches_found}`);
        console.log();

        // Step 2: Get all documented slaveholders
        console.log('Step 2: Retrieving documented slaveholders...');
        const slaveholders = await this.getDocumentedSlaveholders(climbSession.id);
        console.log(`   ✓ Found ${slaveholders.length} documented slaveholder(s)`);

        if (slaveholders.length === 0) {
            console.log('   ℹ No documented slaveholders with linked enslaved individuals found.');
            // Fall back to climb matches that passed verification (not temporal_impossible/common_name_suspect)
            const climbMatches = await this.db.query(`
                SELECT slaveholder_name, slaveholder_fs_id, generation_distance, lineage_path,
                       match_type, match_confidence, confidence_adjusted, classification
                FROM ancestor_climb_matches
                WHERE session_id = $1
                AND classification NOT IN ('temporal_impossible', 'common_name_suspect')
                ORDER BY generation_distance
            `, [climbSession.id]);

            if (climbMatches.rows.length > 0) {
                console.log(`   ℹ Using ${climbMatches.rows.length} verified climb match(es) as basis for DAA`);
                for (const m of climbMatches.rows) {
                    slaveholders.push({
                        match_id: null,
                        slaveholder_id: null,
                        slaveholder_name: m.slaveholder_name,
                        slaveholder_fs_id: m.slaveholder_fs_id,
                        slaveholder_birth_year: null,
                        generation_distance: m.generation_distance,
                        lineage_path: m.lineage_path,
                        match_type: m.match_type,
                        match_confidence: m.confidence_adjusted || m.match_confidence,
                        primary_state: null,
                        enslaved_count: 0,
                        document_count: 0,
                        _from_climb_match: true
                    });
                }
            } else {
                console.log('   ℹ No verified matches found. DAA will document the search itself.');
            }
        }
        
        for (const sh of slaveholders) {
            console.log(`      • ${sh.slaveholder_name} (Gen ${sh.generation_distance})`);
        }
        console.log();

        // ── HARD GATE: refuse to generate a DAA without probate records ─────
        //
        // Policy decision 2026-04-20 (see
        // memory/project_debt_distribution_architecture.md):
        //
        //   No DAA is generated unless the enslaver lineage has documented
        //   probate / deed / administration records in `land_transfer_events`
        //   (migration 038) that support per-descendant inheritance-share
        //   computation. The alternative — generating a DAA with a "share
        //   pending" methodology note — was explicitly rejected by the user
        //   as releasing an incomplete legal instrument.
        //
        //   A DAA that assigns 100% of ancestral debt to a single descendant
        //   is mathematically wrong; one that assigns share = "TBD" is
        //   ethically indefensible. So we block generation until the
        //   primary sources required for real share math are in the DB.
        //
        // When a user's probate records arrive (user's 5 DC ancestors,
        // Apr 18, 2026 request), they get ingested into land_transfer_events
        // and this gate releases automatically.
        await this._enforceProbateGate(slaveholders);

        // Step 3: Aggregate enslaved persons for each slaveholder
        console.log('Step 3: Aggregating enslaved persons with primary sources...');
        const slaveholderData = await this.aggregateEnslavedData(slaveholders);
        
        let totalEnslavedCount = 0;
        for (const data of slaveholderData) {
            totalEnslavedCount += data.enslavedPersons.length;
            console.log(`   ✓ ${data.slaveholder.slaveholder_name}: ${data.enslavedPersons.length} enslaved person(s)`);
        }
        console.log(`   ✓ Total enslaved persons documented: ${totalEnslavedCount}`);
        console.log();

        // Step 4: Calculate total debt (using ALL financial data)
        console.log('Step 4: Calculating total debt (Craemer + tiered payment + wealth gap)...');
        const debtCalculation = await this.calculateTotalDebt(slaveholderData, {
            annualIncome: acknowledgerInfo.annualIncome || 0,
            netWorth: acknowledgerInfo.netWorth || 0,
            realEstateEquity: acknowledgerInfo.realEstateEquity || 0,
            inheritanceReceived: acknowledgerInfo.inheritanceReceived || 0,
            inheritanceExpected: acknowledgerInfo.inheritanceExpected || 0,
            corporateConnectionType: acknowledgerInfo.corporateConnectionType || 'none',
            corporateConnections: acknowledgerInfo.corporateConnections || [],
            trustCorpus: acknowledgerInfo.trustCorpus || 0,
            trustBeneficiary: acknowledgerInfo.trustBeneficiary || 'no',
            inheritedLandAcres: acknowledgerInfo.inheritedLandAcres || 'none',
        });
        console.log(`   ✓ Craemer debt: $${debtCalculation.totalDebt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
        console.log(`   ✓ Wealth-gap obligation: $${debtCalculation.wealthGapObligation.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
        console.log(`   ✓ Recommended (higher): $${debtCalculation.recommendedDebt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${debtCalculation.dualMethodology.recommendedMethodology})`);
        console.log(`   ✓ Tiered annual payment: $${debtCalculation.annualPayment.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (was flat $${debtCalculation.flatRateComparison.flatAnnualPayment.toLocaleString()})`);
        if (debtCalculation.wealthFlagElevated) {
            console.log(`   ⚑ ELEVATED WEALTH: ${debtCalculation.wealthFlagReasons.join(', ')}`);
        }
        if (debtCalculation.corporateEvidence.length > 0) {
            console.log(`   ⚑ Corporate connections: ${debtCalculation.corporateEvidence.map(e => e.modernEntity).join(', ')}`);
        }
        console.log();

        // Step 5: Create DAA database record
        console.log('Step 5: Creating DAA database record...');
        const daaRecord = await this.createDAARecord(
            climbSession,
            acknowledgerInfo,
            slaveholderData,
            debtCalculation
        );
        console.log(`   ✓ DAA ID: ${daaRecord.daaId}`);
        console.log(`   ✓ Agreement Number: ${daaRecord.agreementNumber}`);
        console.log();

        // Step 6: Generate DOCX document
        console.log('Step 6: Generating DOCX document...');
        const docxPath = await this.documentGenerator.generateDOCX(
            daaRecord,
            slaveholderData,
            debtCalculation,
            acknowledgerInfo
        );
        console.log(`   ✓ Document saved: ${docxPath}`);
        console.log();

        console.log('═══════════════════════════════════════════════════════════════');
        console.log('   ✅ COMPREHENSIVE DAA GENERATION COMPLETE');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log();
        console.log('Summary:');
        console.log(`   • Slaveholders: ${slaveholderData.length}`);
        console.log(`   • Enslaved persons: ${totalEnslavedCount}`);
        console.log(`   • Craemer debt: $${debtCalculation.totalDebt.toLocaleString()}`);
        console.log(`   • Wealth-gap obligation: $${debtCalculation.wealthGapObligation.toLocaleString()}`);
        console.log(`   • Recommended debt (higher): $${debtCalculation.recommendedDebt.toLocaleString()}`);
        console.log(`   • Tiered annual payment: $${debtCalculation.annualPayment.toLocaleString()}`);
        console.log(`   • Document: ${docxPath}`);
        console.log(`   • DAA ID: ${daaRecord.daaId}`);
        console.log();

        return {
            daaRecord,
            docxPath,
            slaveholderData,
            debtCalculation,
            climbSession
        };
    }

    /**
     * Probate gate — throws `DAAProbateGateError` if the slaveholders
     * identified for this lineage don't have land_transfer_events rows that
     * support inheritance-share computation. Called from
     * generateComprehensiveDAA before any debt math, before any DB record,
     * before any DOCX generation.
     *
     * Policy: a DAA computed without probate-backed share math assigns 100%
     * of ancestral debt to one descendant out of potentially hundreds. That
     * number is mathematically wrong and legally indefensible. Rather than
     * release a DAA with a "share pending" methodology note, we block the
     * document entirely. When probate records arrive and get ingested, the
     * gate releases for that lineage.
     *
     * @param {Array} slaveholders — resolved slaveholders from
     *     getDocumentedSlaveholders(). Each should have slaveholder_id
     *     pointing at canonical_persons.id.
     */
    async _enforceProbateGate(slaveholders) {
        const enslaverIds = slaveholders
            .map(s => s.slaveholder_id)
            .filter(id => id != null);

        if (enslaverIds.length === 0) {
            throw new DAAProbateGateError(
                'Cannot generate DAA: no slaveholders resolved to canonical_persons. ' +
                'Complete ancestor-climb match verification before DAA generation.'
            );
        }

        // Count land_transfer_events rows implicating each enslaver in scope.
        // Probate/deed/administration records get ingested here; if an
        // enslaver has no rows, we don't have the primary-source backing
        // required for an inheritance-share computation.
        const q = await this.db.query(`
            SELECT
                cp.id AS enslaver_id,
                cp.canonical_name,
                COUNT(lte.transfer_id)::int AS transfer_event_count
            FROM canonical_persons cp
            LEFT JOIN land_transfer_events lte
                ON lte.implicates_enslaver = TRUE
                AND lte.enslaver_person_id = cp.id
            WHERE cp.id = ANY($1)
            GROUP BY cp.id, cp.canonical_name
        `, [enslaverIds]);

        const missing = q.rows.filter(r => r.transfer_event_count === 0);
        if (missing.length > 0) {
            const lines = missing.map(m => `  • ${m.canonical_name} (id=${m.enslaver_id}): no land_transfer_events`);
            throw new DAAProbateGateError(
                'DAA generation blocked: inheritance-share computation requires ' +
                'probate, Recorder of Deeds, and administration-bond records ' +
                'ingested into `land_transfer_events` (migration 038). The ' +
                'following slaveholder ancestors have no such records in the ' +
                'DB:\n' + lines.join('\n') +
                '\n\nRequest the applicable jurisdictions\' probate and deed ' +
                'records for these ancestors, ingest via the wealth-tracing ' +
                'pipeline, then re-run DAA generation. Policy reference: ' +
                'memory/project_debt_distribution_architecture.md.'
            );
        }

        console.log(`   ✓ Probate gate passed: ${q.rows.length} slaveholders have land_transfer_events coverage`);
    }

    /**
     * Ensure ancestor climb is complete for the given person
     * Checks for existing session or runs new climb
     */
    async ensureClimbComplete(familySearchId, personName, sessionId = null) {
        // Direct session ID lookup (for name-only climbs)
        if (sessionId) {
            const directSession = await this.db.query(`
                SELECT * FROM ancestor_climb_sessions
                WHERE id = $1 AND status = 'completed'
            `, [sessionId]);
            if (directSession.rows.length > 0) {
                console.log(`   ℹ Using session ${sessionId}`);
                return directSession.rows[0];
            }
        }

        // Check for existing completed session by FS ID or by name for NAME-ONLY
        const existingSession = await this.db.query(`
            SELECT * FROM ancestor_climb_sessions
            WHERE (modern_person_fs_id = $1 OR ($1 = 'NAME-ONLY' AND modern_person_name = $2))
            AND status = 'completed'
            ORDER BY started_at DESC
            LIMIT 1
        `, [familySearchId, personName]);

        if (existingSession.rows.length > 0) {
            console.log('   ℹ Using existing climb session');
            return existingSession.rows[0];
        }

        // Check for in-progress session
        const inProgressSession = await this.db.query(`
            SELECT * FROM ancestor_climb_sessions
            WHERE modern_person_fs_id = $1
            AND status = 'in_progress'
            ORDER BY started_at DESC
            LIMIT 1
        `, [familySearchId]);

        if (inProgressSession.rows.length > 0) {
            console.log('   ⚠ Found in-progress climb session');
            console.log('   → Please complete the climb first by running:');
            console.log(`   → FAMILYSEARCH_INTERACTIVE=true node scripts/scrapers/familysearch-ancestor-climber.js --resume ${inProgressSession.rows[0].id}`);
            throw new Error('Climb session in progress. Complete it before generating DAA.');
        }

        // No session exists - need to run climb
        console.log('   ⚠ No climb session found');
        console.log('   → Please run ancestor climb first:');
        console.log(`   → FAMILYSEARCH_INTERACTIVE=true node scripts/scrapers/familysearch-ancestor-climber.js ${familySearchId} --name "${personName}"`);
        throw new Error('Ancestor climb required. Run the command above first.');
    }

    /**
     * Get all slaveholders with primary source documentation
     * 
     * NEW STRATEGY:
     * 1. Get ALL ancestor names from climb (not just matched ones)
     * 2. Query database for documented slaveholders
     * 3. Match using fuzzy name/location/date matching
     */
    async getDocumentedSlaveholders(sessionId) {
        console.log('   → Querying database for documented slaveholders...');

        // Step 1: Get ALL ancestor names from climb.
        //
        // Climb matches can live in either ancestor_climb_matches (normalized
        // table, preferred) OR ancestor_climb_sessions.all_matches (inline
        // JSONB). Some climbs only populate the JSONB (e.g. Ryan Mills' 15-
        // match session has table_cnt=0, inline=15) — probably a historical
        // pipeline variation. We read both and prefer the normalized table
        // when it has rows, else fall back to JSONB.
        let climbNames = await this.db.query(`
            SELECT DISTINCT
                acm.id as match_id,
                acm.slaveholder_name,
                acm.slaveholder_fs_id,
                acm.slaveholder_birth_year,
                acm.generation_distance,
                acm.lineage_path,
                acm.match_type,
                acm.match_confidence,
                acm.slaveholder_id as existing_match_id
            FROM ancestor_climb_matches acm
            WHERE acm.session_id = $1
            ORDER BY acm.generation_distance ASC
        `, [sessionId]);

        if (climbNames.rows.length === 0) {
            const inline = await this.db.query(`
                SELECT all_matches
                FROM ancestor_climb_sessions
                WHERE id = $1 AND all_matches IS NOT NULL
            `, [sessionId]);
            const allMatches = inline.rows[0]?.all_matches || [];
            if (Array.isArray(allMatches) && allMatches.length > 0) {
                console.log(`   → Using JSONB inline matches fallback (${allMatches.length} matches not in normalized table)`);
                climbNames = { rows: allMatches.map((m, i) => ({
                    match_id: `inline-${i}`,
                    slaveholder_name: m?.match?.canonical_name || m?.person?.name || '(unknown)',
                    slaveholder_fs_id: m?.person?.fs_id || null,
                    slaveholder_birth_year: m?.match?.birth_year_estimate || m?.person?.birth_year || null,
                    generation_distance: m?.generation || null,
                    lineage_path: m?.path || null,
                    match_type: m?.match?.type || 'inline_unknown',
                    match_confidence: m?.match?.confidence ?? m?.verdict?.confidence_adjusted ?? null,
                    existing_match_id: m?.match?.id || null,
                })) };
            }
        }

        console.log(`   → Found ${climbNames.rows.length} ancestor names in climb`);

        // Step 2: Get ALL canonical_persons marked as enslavers.
        //
        // IMPORTANT: we do NOT filter on `HAVING COUNT(enslaved_individuals) > 0`
        // here. Many real enslavers in canonical_persons have their enslaved
        // persons linked via `family_relationships(enslaved_by)` or
        // `unconfirmed_persons.relationships[enslaved_by]` rather than the
        // `enslaved_individuals` table — so the old HAVING filter dropped 93%
        // of Adrian Brown's 16 verified climb matches on the first run.
        // Enslaved-count is computed per-slaveholder below via UNION across
        // all three storage locations.
        const documentedSlaveholders = await this.db.query(`
            SELECT
                cp.id,
                cp.canonical_name,
                cp.birth_year_estimate,
                cp.death_year_estimate,
                cp.primary_state,
                cp.primary_county,
                cp.notes,
                cp.person_type
            FROM canonical_persons cp
            WHERE cp.person_type IN ('enslaver', 'descendant')
            ORDER BY cp.canonical_name ASC
        `);
        // Index by id and (normalized) canonical_name for quick lookup
        const byId = new Map();
        const byName = new Map();
        for (const sh of documentedSlaveholders.rows) {
            byId.set(sh.id, sh);
            const key = (sh.canonical_name || '').toLowerCase().trim();
            if (!byName.has(key)) byName.set(key, []);
            byName.get(key).push(sh);
        }

        console.log(`   → ${documentedSlaveholders.rows.length} canonical_persons in scope (enslaver or descendant)`);

        // Step 2b: Pre-resolve FS IDs via person_external_ids so the
        // highest-quality linkage (verified external ID from the climber)
        // becomes a direct UUID match rather than a fuzzy name guess.
        const fsIds = climbNames.rows.map(r => r.slaveholder_fs_id).filter(Boolean);
        const fsIdLookup = new Map();
        if (fsIds.length) {
            const pei = await this.db.query(`
                SELECT external_id, canonical_person_id, confidence
                FROM person_external_ids
                WHERE id_system='familysearch' AND external_id = ANY($1)
            `, [fsIds]);
            for (const r of pei.rows) fsIdLookup.set(r.external_id, r);
        }
        console.log(`   → Resolved ${fsIdLookup.size} of ${fsIds.length} climb FS IDs via person_external_ids`);

        // Step 3: Resolve each climb ancestor to a canonical_persons row.
        // Priority: (1) FS ID via person_external_ids, (2) existing_match_id,
        // (3) exact name, (4) family-variation fuzzy, (5) substring+birth-year.
        // Previous implementation silently dropped ~93% of climb matches
        // because it required enslaved_individuals linkage AND did only fuzzy
        // name match. FS-ID resolution recovers verified external-ID matches.
        const matches = [];
        const unresolved = [];

        for (const ancestor of climbNames.rows) {
            let matched = null;
            let matchType = null;
            let matchConf = 0;

            // (1) FS ID via person_external_ids — highest confidence
            if (ancestor.slaveholder_fs_id && fsIdLookup.has(ancestor.slaveholder_fs_id)) {
                const pei = fsIdLookup.get(ancestor.slaveholder_fs_id);
                const candidate = byId.get(pei.canonical_person_id);
                if (candidate) {
                    matched = candidate;
                    matchType = 'fs_external_id';
                    matchConf = 0.95;
                }
            }

            // (2) existing_match_id (integer canonical_persons.id from climb)
            if (!matched && ancestor.existing_match_id) {
                const candidate = byId.get(ancestor.existing_match_id);
                if (candidate) {
                    matched = candidate;
                    matchType = 'existing_id';
                    matchConf = 0.90;
                }
            }

            // (3) Exact name match (case-insensitive)
            if (!matched) {
                const key = (ancestor.slaveholder_name || '').toLowerCase().trim();
                const candidates = byName.get(key);
                if (candidates && candidates.length > 0) {
                    // Prefer enslaver over descendant
                    matched = candidates.find(c => c.person_type === 'enslaver') || candidates[0];
                    matchType = 'name_exact';
                    matchConf = 0.85;
                }
            }

            if (matched) {
                matches.push({
                    match_id: ancestor.match_id,
                    slaveholder_id: matched.id,
                    slaveholder_name: matched.canonical_name,
                    slaveholder_fs_id: ancestor.slaveholder_fs_id,
                    slaveholder_birth_year: matched.birth_year_estimate,
                    generation_distance: ancestor.generation_distance,
                    lineage_path: ancestor.lineage_path,
                    match_type: matchType,
                    match_confidence: matchConf,
                    climb_match_confidence: ancestor.match_confidence,
                    primary_state: matched.primary_state,
                    primary_county: matched.primary_county,
                    notes: matched.notes,
                    canonical_person_type: matched.person_type,
                });
                continue;
            }

            // Fuzzy matching by name
            const ancestorName = (ancestor.slaveholder_name || '').toLowerCase().trim();
            
            for (const dbSlaveholder of documentedSlaveholders.rows) {
                const dbName = dbSlaveholder.canonical_name.toLowerCase().trim();
                
                // Exact match
                if (ancestorName === dbName) {
                    matches.push({
                        match_id: ancestor.match_id,
                        slaveholder_id: dbSlaveholder.id,
                        slaveholder_name: dbSlaveholder.canonical_name,
                        slaveholder_fs_id: ancestor.slaveholder_fs_id,
                        slaveholder_birth_year: dbSlaveholder.birth_year_estimate,
                        generation_distance: ancestor.generation_distance,
                        lineage_path: ancestor.lineage_path,
                        match_type: 'name_exact',
                        match_confidence: 90,
                        primary_state: dbSlaveholder.primary_state,
                        primary_county: dbSlaveholder.primary_county,
                        notes: dbSlaveholder.notes,
                        enslaved_count: dbSlaveholder.enslaved_count,
                        document_count: dbSlaveholder.document_count
                    });
                    break;
                }
                
                // ENHANCED: Special name variation matching for known families
                // Angelica Chesley → Angelica Chew, Maria Angelica Biscoe
                if (ancestorName.includes('angelica') && dbName.includes('angelica')) {
                    const matched = (ancestorName.includes('chesley') && (dbName.includes('chew') || dbName.includes('biscoe'))) ||
                                  (ancestorName.includes('chew') && (dbName.includes('chesley') || dbName.includes('biscoe'))) ||
                                  (ancestorName.includes('biscoe') && (dbName.includes('angelica')));
                    
                    if (matched) {
                        matches.push({
                            match_id: ancestor.match_id,
                            slaveholder_id: dbSlaveholder.id,
                            slaveholder_name: dbSlaveholder.canonical_name,
                            slaveholder_fs_id: ancestor.slaveholder_fs_id,
                            slaveholder_birth_year: dbSlaveholder.birth_year_estimate,
                            generation_distance: ancestor.generation_distance,
                            lineage_path: ancestor.lineage_path,
                            match_type: 'name_variation',
                            match_confidence: 85,
                            primary_state: dbSlaveholder.primary_state,
                            primary_county: dbSlaveholder.primary_county,
                            notes: dbSlaveholder.notes,
                            enslaved_count: dbSlaveholder.enslaved_count,
                            document_count: dbSlaveholder.document_count
                        });
                        break;
                    }
                }
                
                // Biscoe family name variations
                if ((ancestorName.includes('biscoe') && dbName.includes('biscoe')) ||
                    (ancestorName.includes('bisco') && dbName.includes('biscoe'))) {
                    matches.push({
                        match_id: ancestor.match_id,
                        slaveholder_id: dbSlaveholder.id,
                        slaveholder_name: dbSlaveholder.canonical_name,
                        slaveholder_fs_id: ancestor.slaveholder_fs_id,
                        slaveholder_birth_year: dbSlaveholder.birth_year_estimate,
                        generation_distance: ancestor.generation_distance,
                        lineage_path: ancestor.lineage_path,
                        match_type: 'name_variation',
                        match_confidence: 85,
                        primary_state: dbSlaveholder.primary_state,
                        primary_county: dbSlaveholder.primary_county,
                        notes: dbSlaveholder.notes,
                        enslaved_count: dbSlaveholder.enslaved_count,
                        document_count: dbSlaveholder.document_count
                    });
                    break;
                }
                
                // Chew family matching
                if (ancestorName.includes('chew') && dbName.includes('chew')) {
                    matches.push({
                        match_id: ancestor.match_id,
                        slaveholder_id: dbSlaveholder.id,
                        slaveholder_name: dbSlaveholder.canonical_name,
                        slaveholder_fs_id: ancestor.slaveholder_fs_id,
                        slaveholder_birth_year: dbSlaveholder.birth_year_estimate,
                        generation_distance: ancestor.generation_distance,
                        lineage_path: ancestor.lineage_path,
                        match_type: 'name_variation',
                        match_confidence: 85,
                        primary_state: dbSlaveholder.primary_state,
                        primary_county: dbSlaveholder.primary_county,
                        notes: dbSlaveholder.notes,
                        enslaved_count: dbSlaveholder.enslaved_count,
                        document_count: dbSlaveholder.document_count
                    });
                    break;
                }
                
                // General fuzzy match: check if names contain each other
                if (ancestorName.includes(dbName) || dbName.includes(ancestorName)) {
                    // Check birth year proximity (within 10 years)
                    const birthYearMatch = !ancestor.slaveholder_birth_year || !dbSlaveholder.birth_year_estimate ||
                        Math.abs(ancestor.slaveholder_birth_year - dbSlaveholder.birth_year_estimate) <= 10;
                    
                    if (birthYearMatch) {
                        matches.push({
                            match_id: ancestor.match_id,
                            slaveholder_id: dbSlaveholder.id,
                            slaveholder_name: dbSlaveholder.canonical_name,
                            slaveholder_fs_id: ancestor.slaveholder_fs_id,
                            slaveholder_birth_year: dbSlaveholder.birth_year_estimate,
                            generation_distance: ancestor.generation_distance,
                            lineage_path: ancestor.lineage_path,
                            match_type: 'name_fuzzy',
                            match_confidence: 75,
                            primary_state: dbSlaveholder.primary_state,
                            primary_county: dbSlaveholder.primary_county,
                            notes: dbSlaveholder.notes,
                            enslaved_count: dbSlaveholder.enslaved_count,
                            document_count: dbSlaveholder.document_count
                        });
                        break;
                    }
                }
            }
        }

        // Derive unresolved set: climb match_ids that produced no matches
        const matchedClimbIds = new Set(matches.map(m => m.match_id));
        for (const ancestor of climbNames.rows) {
            if (!matchedClimbIds.has(ancestor.match_id)) {
                unresolved.push({ name: ancestor.slaveholder_name, fs_id: ancestor.slaveholder_fs_id });
            }
        }

        console.log(`   → Matched ${matches.length} climb ancestors to canonical_persons`);
        if (unresolved.length) {
            console.log(`   → ${unresolved.length} climb matches could not be linked to canonical_persons:`);
            for (const u of unresolved) console.log(`      ✗ ${u.name} (FS ID: ${u.fs_id || '-'})`);
        }

        // Dedupe by slaveholder_id; keep the match with highest confidence
        const byKey = new Map();
        for (const m of matches) {
            const key = m.slaveholder_id;
            const existing = byKey.get(key);
            if (!existing || (m.match_confidence ?? 0) > (existing.match_confidence ?? 0)) {
                byKey.set(key, m);
            }
        }
        const uniqueMatches = [...byKey.values()];
        for (const m of uniqueMatches) {
            console.log(`      • ${m.slaveholder_name} (gen ${m.generation_distance}, ${m.match_type} @${m.match_confidence}, canonical type=${m.canonical_person_type || '-'})`);
        }

        return uniqueMatches;
    }

    /**
     * Aggregate enslaved persons for each slaveholder with primary sources
     * 
     * UPDATED: Now uses enslaved_individuals table directly since
     * enslaved_owner_relationships is empty
     */
    async aggregateEnslavedData(slaveholders) {
        const slaveholderData = [];

        for (const slaveholder of slaveholders) {
            // For climb-match slaveholders without DB IDs:
            // Document the slaveholder connection WITHOUT fabricating enslaved persons.
            // We have evidence of the slaveholder match but no individually documented
            // enslaved persons linked to this slaveholder yet. The debt calculation
            // for this slaveholder is pending further research.
            if (slaveholder._from_climb_match || !slaveholder.slaveholder_id) {
                const matchSource = slaveholder.match_type === 'slavevoyages_enslaver'
                    ? 'Trans-Atlantic Slave Trade Database (SlaveVoyages.org)'
                    : 'Historical enslaver records';
                slaveholderData.push({
                    slaveholder,
                    enslavedPersons: [], // No fabricated persons — empty until real data exists
                    enslaved_persons_pending: true, // Flag for document generators
                    primarySources: [{
                        document_type: slaveholder.match_type,
                        collection_name: matchSource,
                        source_note: `Matched via ${slaveholder.match_type} at ${Math.round((slaveholder.match_confidence || 0) * 100)}% confidence. Lineage: ${Array.isArray(slaveholder.lineage_path) ? slaveholder.lineage_path.join(' → ') : 'unknown'}. Enslaved persons not yet individually documented — debt calculation pending further research.`
                    }]
                });
                continue;
            }

            // Get enslaved persons from ALL sources:
            //   1. enslaved_individuals (confirmed, 18K records)
            //   2. family_relationships (1.9M edges, now linked to canonical IDs)
            //   3. unconfirmed_persons with JSONB enslaved_by links (52K)
            //
            // This ensures the DAA sees every documented enslaved person
            // across slave schedules, Natchez probate, Book of Negroes,
            // Santos census, insurance registers, and all other imports.

            // Source 1: enslaved_individuals (original, confirmed)
            const enslavedResult = await this.db.query(`
                SELECT
                    ei.enslaved_id,
                    ei.full_name as enslaved_name,
                    ei.birth_year,
                    ei.death_year,
                    ei.freedom_year,
                    ei.gender,
                    'enslaved_individuals' as data_source,
                    pd.s3_url,
                    pd.source_url as document_source_url,
                    pd.document_type,
                    pd.collection_name,
                    pd.film_number,
                    pd.image_number
                FROM enslaved_individuals ei
                LEFT JOIN person_documents pd ON CAST(ei.enslaved_by_individual_id AS integer) = pd.canonical_person_id
                WHERE CAST(ei.enslaved_by_individual_id AS text) = CAST($1 AS text)
                ORDER BY ei.full_name ASC
            `, [slaveholder.slaveholder_id]);

            // Source 2: family_relationships (1.9M slave-schedule-extracted
            // enslaved_by edges). IMPORTANT: person1_lead_id is NULL across
            // every row in this table — the edges are matched by NAME only,
            // not by canonical_persons FK. So we match on person1_name =
            // slaveholder.canonical_name (case-insensitive). This recovers
            // enslaved persons for enslavers whose tree-climbed canonical
            // entry matches the schedule-extracted name string.
            //
            // Ambiguity note: very common names (John Smith: 724 edges,
            // William Smith: 559) will match canonical enslavers who share
            // those names but may not actually be the same person. We
            // accept that risk for initial DAA generation and downstream
            // MatchVerifier should re-check before any payment.
            // LEFT JOIN migration 039's view to pick up inferred birth/
            // freedom years from slave-schedule age + collection-year lookup.
            // Without this, Craemer returns $0 for every schedule-sourced
            // enslaved person (dates are NULL on all 18K enslaved_individuals
            // rows and no date columns exist directly on family_relationships).
            const relResult = await this.db.query(`
                SELECT DISTINCT ON (fr.person2_name)
                    fr.person2_lead_id as enslaved_id,
                    fr.person2_name as enslaved_name,
                    epi.inferred_birth_year as birth_year,
                    NULL as death_year,
                    epi.inferred_freedom_year as freedom_year,
                    NULL as gender,
                    'family_relationships' as data_source,
                    fr.source_url as document_source_url,
                    NULL as s3_url,
                    NULL as document_type,
                    NULL as collection_name,
                    NULL as film_number,
                    NULL as image_number,
                    fr.confidence as match_confidence,
                    epi.inference_method as date_inference_method,
                    epi.inference_confidence as date_inference_confidence
                FROM family_relationships fr
                LEFT JOIN enslaved_persons_inferred_dates epi ON epi.relationship_id = fr.id
                WHERE LOWER(fr.person1_name) = LOWER($1)
                AND fr.relationship_type = 'enslaved_by'
                AND fr.person2_name IS NOT NULL
                ORDER BY fr.person2_name
                LIMIT 500
            `, [slaveholder.slaveholder_name]);
            // NOTE: we DO include "Unknown (Female, age 17)" etc. — these are
            // real enslaved persons whose names weren't captured on the slave
            // schedule (age/sex descriptors preserved in the name field).
            // The prior `NOT LIKE 'Unknown%'` filter dropped Charles Brown's 5
            // documented-but-unnamed enslaved from Adrian's DAA entirely.

            // Source 3: unconfirmed_persons with JSONB enslaved_by matching this enslaver
            const uncResult = await this.db.query(`
                SELECT DISTINCT ON (up.full_name)
                    up.lead_id as enslaved_id,
                    up.full_name as enslaved_name,
                    NULL as birth_year,
                    NULL as death_year,
                    NULL as freedom_year,
                    up.gender,
                    up.extraction_method as data_source,
                    up.source_url as document_source_url,
                    NULL as s3_url,
                    NULL as document_type,
                    NULL as collection_name,
                    NULL as film_number,
                    NULL as image_number
                FROM unconfirmed_persons up
                WHERE up.person_type = 'enslaved'
                AND up.relationships->>'enslaved_by' IS NOT NULL
                AND EXISTS (
                    SELECT 1 FROM canonical_persons cp
                    WHERE cp.id = $1
                    AND LOWER(up.relationships->>'enslaved_by') = LOWER(cp.canonical_name)
                )
                ORDER BY up.full_name
                LIMIT 100
            `, [slaveholder.slaveholder_id]);

            // Merge all sources, deduplicate by name
            const allEnslaved = [...enslavedResult.rows];
            const seenNames = new Set(allEnslaved.map(e => (e.enslaved_name || '').toLowerCase()));

            for (const row of [...relResult.rows, ...uncResult.rows]) {
                const nameKey = (row.enslaved_name || '').toLowerCase();
                if (nameKey && !seenNames.has(nameKey)) {
                    seenNames.add(nameKey);
                    allEnslaved.push(row);
                }
            }

            // Replace the single-source result with the merged result
            enslavedResult.rows = allEnslaved;

            // Calculate years enslaved from documented dates only
            const enslavedPersons = enslavedResult.rows.map(person => {
                let yearsEnslaved = null;
                let yearsEstimated = false;

                if (person.birth_year && person.freedom_year) {
                    yearsEnslaved = person.freedom_year - person.birth_year;
                } else if (person.birth_year && person.death_year) {
                    yearsEnslaved = person.death_year - person.birth_year;
                } else {
                    // No documented dates — mark as unknown rather than fabricating
                    yearsEnslaved = null;
                    yearsEstimated = true;
                }

                if (yearsEnslaved !== null) {
                    yearsEnslaved = Math.max(1, yearsEnslaved);
                }

                return {
                    ...person,
                    years_enslaved: yearsEnslaved,
                    years_estimated: yearsEstimated,
                    start_year: person.birth_year || null,
                    end_year: person.freedom_year || person.death_year || null
                };
            });

            // Get primary source documents for this enslaver
            const primarySources = await this.getPrimarySourcesForEnslaver(slaveholder.slaveholder_id);

            slaveholderData.push({
                slaveholder,
                enslavedPersons,
                primarySources
            });
        }

        return slaveholderData;
    }

    /**
     * Get primary source documents for an enslaver
     */
    async getPrimarySourcesForEnslaver(enslaverId) {
        // Do NOT require s3_url — many primary-source rows are still
        // FamilySearch-hosted and haven't been mirrored to S3 yet. The
        // FamilySearch ARK alone is sufficient provenance for the DAA.
        // Previously this filter caused Exhibit A to render "ARK TBD"
        // for every slaveholder whose documents hadn't been S3-archived.
        const result = await this.db.query(`
            SELECT DISTINCT
                pd.s3_url,
                pd.source_url as document_source_url,
                pd.document_type,
                pd.collection_name,
                pd.film_number,
                pd.image_number
            FROM person_documents pd
            WHERE pd.canonical_person_id = $1
              AND (pd.s3_url IS NOT NULL OR pd.source_url IS NOT NULL)
            ORDER BY pd.document_type, pd.film_number, pd.image_number
        `, [enslaverId]);

        return result.rows.map(doc => ({
            s3_url: doc.s3_url,
            document_source_url: doc.document_source_url,
            document_type: doc.document_type,
            collection_name: doc.collection_name,
            film_number: doc.film_number,
            image_number: doc.image_number,
            source_url: doc.document_source_url,
            // Expose the ARK under the key the DOCX template reads
            // (DAADocumentGenerator uses `sources[0]?.ark`). The FS source_url
            // IS the ARK for all FamilySearch-hosted documents.
            ark: doc.document_source_url || null,
        }));
    }

    /**
     * Aggregate unique primary sources across enslaved persons
     */
    aggregatePrimarySources(enslavedPersons) {
        const sources = new Map();

        for (const person of enslavedPersons) {
            if (person.s3_url) {
                const key = person.s3_url;
                if (!sources.has(key)) {
                    sources.set(key, {
                        s3_url: person.s3_url,
                        document_source_url: person.document_source_url,
                        document_type: person.document_type,
                        collection_name: person.collection_name,
                        film_number: person.film_number,
                        image_number: person.image_number,
                        source_url: person.source_url
                    });
                }
            }
        }

        return Array.from(sources.values());
    }

    /**
     * Calculate total debt across all slaveholders.
     *
     * Uses ALL participant financial data:
     *   - Craemer formula for historical debt (DAAGenerator)
     *   - TieredPaymentCalculator for progressive payment schedule
     *   - WealthGapCalculator for Darity-Mullen wealth-gap obligation
     *   - CorporateSuccessionTracer for corporate connection documentation
     *
     * @param {Array} slaveholderData - From aggregateEnslavedData()
     * @param {Object} participantFinancials - Full financial disclosure
     */
    async calculateTotalDebt(slaveholderData, participantFinancials) {
        // Accept either a number (backward compat) or full financials object
        const financials = typeof participantFinancials === 'number'
            ? { annualIncome: participantFinancials }
            : participantFinancials;

        const {
            annualIncome = 0,
            netWorth = 0,
            realEstateEquity = 0,
            inheritanceReceived = 0,
            inheritanceExpected = 0,
            corporateConnectionType = 'none',
            corporateConnections = [],
            trustCorpus = 0,
            trustBeneficiary = 'no',
            inheritedLandAcres = 'none',
        } = financials;

        let totalDebt = 0;
        const slaveholderCalculations = [];
        let totalEnslavedCount = 0;

        for (const data of slaveholderData) {
            const enslavedForCalculation = data.enslavedPersons.map(person => ({
                name: person.enslaved_name,
                yearsEnslaved: person.years_enslaved,
                startYear: person.start_year || 1800,
                relationship: person.relationship_type
            }));

            const preview = this.daaGenerator.calculatePreview(
                enslavedForCalculation,
                annualIncome
            );

            slaveholderCalculations.push({
                slaveholder: data.slaveholder,
                debt: preview.totalDebt,
                enslavedCount: enslavedForCalculation.length,
                calculations: preview.calculations
            });

            totalDebt += preview.totalDebt;
            totalEnslavedCount += enslavedForCalculation.length;
        }

        // ── Tiered Payment (replaces flat 2%) ────────────────────────
        const tieredResult = this.tieredCalc.calculate({
            annualIncome,
            netWorth,
            enslavedCount: totalEnslavedCount || 1,
            corporateConnection: corporateConnectionType
        });

        // ── Wealth Gap (Darity-Mullen dual methodology) ─────────────
        const wealthGapResult = this.wealthGapCalc.calculateIndividualShare({
            annualIncome,
            netWorth,
            realEstateEquity,
            inheritanceReceived,
            inheritanceExpected,
            numSlaveholderAncestors: slaveholderData.length || 1,
            numLivingDescendants: null
        });

        // ── Corporate Connection Documentation ──────────────────────
        const corporateEvidence = [];
        for (const key of corporateConnections) {
            const chain = this.successionTracer.getChain(key);
            if (chain) {
                corporateEvidence.push({
                    key,
                    modernEntity: chain.modern,
                    predecessorCount: chain.predecessors.length,
                    earliestYear: Math.min(...chain.predecessors.map(p => p.year)),
                    primarySource: chain.documentation.primary,
                    enslavedDocumented: chain.documentation.enslavedAsCollateral
                        || chain.documentation.enslaved
                        || chain.documentation.enslavedNames
                        || null
                });
            }
        }

        // ── Dual-methodology comparison ─────────────────────────────
        const dualMethodology = this.wealthGapCalc.compareWithCraemer(
            wealthGapResult,
            totalDebt
        );

        // ── Wealth flag computation ─────────────────────────────────
        const wealthReasons = [];
        if (trustCorpus > 1000000) wealthReasons.push('trust_corpus_over_1m');
        if (trustBeneficiary === 'irrevocable') wealthReasons.push('irrevocable_trust');
        if (inheritedLandAcres === '500_to_5000' || inheritedLandAcres === 'over_5000') wealthReasons.push('large_inherited_land');
        if (corporateConnections.length > 0) wealthReasons.push('farmer_paellmann_connection');
        if (netWorth > 0 && annualIncome > 0 && netWorth > annualIncome * 10) wealthReasons.push('net_worth_10x_income');
        if (inheritanceReceived > 500000) wealthReasons.push('inheritance_over_500k');

        return {
            // Historical debt (Craemer — genealogy-driven)
            totalDebt,
            slaveholderCalculations,
            totalEnslavedCount,

            // Payment schedule (tiered — replaces flat 2%)
            annualPayment: tieredResult.annualPayment,
            monthlyPayment: tieredResult.monthlyPayment,
            tieredBreakdown: tieredResult,

            // Wealth-gap obligation (Darity-Mullen)
            wealthGapObligation: wealthGapResult.totalObligation,
            wealthGapBreakdown: wealthGapResult,

            // Dual methodology recommendation
            dualMethodology,
            recommendedDebt: dualMethodology.recommended,

            // Corporate evidence
            corporateEvidence,
            corporateConnectionType,

            // Inputs preserved for audit trail
            annualIncome,
            financials,
            wealthFlagElevated: wealthReasons.length > 0,
            wealthFlagReasons: wealthReasons,

            // Comparison with old flat rate
            flatRateComparison: {
                flatAnnualPayment: Math.round(annualIncome * 0.02 * 100) / 100,
                tieredAnnualPayment: tieredResult.annualPayment,
                difference: Math.round((tieredResult.annualPayment - annualIncome * 0.02) * 100) / 100,
                note: tieredResult.annualPayment > annualIncome * 0.02
                    ? 'Tiered rate is higher — wealth fingerprint detected additional obligation'
                    : 'Tiered rate is equal or lower — progressive benefit for lower incomes'
            }
        };
    }

    /**
     * Create comprehensive DAA database record
     */
    async createDAARecord(climbSession, acknowledgerInfo, slaveholderData, debtCalculation) {
        // For now, we'll create individual DAA records per slaveholder
        // Future enhancement: Multi-slaveholder DAA support
        
        const mainSlaveholder = slaveholderData[0] || null; // Primary/first slaveholder

        // Prepare all enslaved persons across all slaveholders
        const allEnslavedPersons = [];
        for (const data of slaveholderData) {
            for (const person of data.enslavedPersons) {
                allEnslavedPersons.push({
                    name: person.enslaved_name,
                    yearsEnslaved: person.years_enslaved,
                    startYear: person.start_year || 1800,
                    relationship: `enslaved_by_${data.slaveholder.slaveholder_name}`
                });
            }
        }

        // Get primary source for main slaveholder (may be null for zero-slaveholder DAAs)
        const primarySource = mainSlaveholder?.primarySources?.[0] || {};

        // For zero-slaveholder DAAs, use climb match data as context
        const slaveholderName = mainSlaveholder?.slaveholder?.slaveholder_name ||
            `Unlinked matches from climb ${climbSession.id.substring(0, 8)}`;

        // Generate DAA
        const daaResult = await this.daaGenerator.generateDAA({
            acknowledgerName: acknowledgerInfo.name,
            acknowledgerEmail: acknowledgerInfo.email,
            acknowledgerAddress: acknowledgerInfo.address,
            slaveholderName,
            slaveholderCanonicalId: mainSlaveholder?.slaveholder?.slaveholder_id || null,
            slaveholderFamilySearchId: mainSlaveholder?.slaveholder?.slaveholder_fs_id || null,
            primarySourceArk: primarySource.ark || null,
            primarySourceArchive: primarySource.collection_name || null,
            primarySourceReference: primarySource.film_number ? `Film ${primarySource.film_number}, Image ${primarySource.image_number}` : null,
            primarySourceDate: null,
            primarySourceType: primarySource.document_type || null,
            generationFromSlaveholder: mainSlaveholder?.slaveholder?.generation_distance || null,
            annualIncome: acknowledgerInfo.annualIncome,
            enslavedPersons: allEnslavedPersons,
            notes: `Comprehensive DAA generated from ancestor climb session ${climbSession.id}. ${slaveholderData.length} documented slaveholder(s), ${allEnslavedPersons.length} documented enslaved person(s). Climb visited ${climbSession.ancestors_visited} ancestors with ${climbSession.matches_found} matches.`
        });

        // Store slaveholder breakdown in notes for now
        // TODO: Use multi-slaveholder schema once migration 029 is run
        await this.db.query(`
            UPDATE debt_acknowledgment_agreements
            SET calculation_breakdown = jsonb_set(
                calculation_breakdown,
                '{slaveholder_breakdown}',
                $2::jsonb
            )
            WHERE daa_id = $1
        `, [
            daaResult.daaId,
            JSON.stringify(debtCalculation.slaveholderCalculations)
        ]);

        return daaResult;
    }
}

module.exports = DAAOrchestrator;
module.exports.DAAProbateGateError = DAAProbateGateError;
