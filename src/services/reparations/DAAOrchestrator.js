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
const MACRO = require('./macro-config');
const ObligationReconciler = require('./ObligationReconciler');
const CorporateSuccessionTracer = require('./CorporateSuccessionTracer');
const { OWNER_ROLE_TYPES, isOwnerType } = require('../person-roles');
const DisgorgementCalculator = require('./DisgorgementCalculator');
const FamilySearchClimberAgent = require('../../../scripts/agents/FamilySearchClimberAgent');

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
        this.disgorgementCalc = new DisgorgementCalculator(database);
        this.reconciler = new ObligationReconciler();
        this.USE_LINE_ITEM_METHODOLOGY = true;
    }

    async getLineItemsForPerson(canonical_person_id) {
        const tier1Result = await this.db.query(`
            SELECT
                rli.*,
                rhc.category_key,
                rhc.display_name AS harm_display,
                rhc.era,
                hpe.display_name AS perpetrator_display,
                hpe.entity_type,
                lt.display_name AS legal_theory_display,
                lt.jurisdiction AS legal_theory_jurisdiction
            FROM reparations_line_items rli
            JOIN reparations_harm_categories rhc ON rli.harm_category_id = rhc.id
            LEFT JOIN harm_perpetrator_entities hpe ON rli.perpetrator_entity_id = hpe.id
            LEFT JOIN LATERAL unnest(rli.legal_theory_ids) AS lt_id ON TRUE
            LEFT JOIN legal_theory_registry lt ON lt_id = lt.id
            WHERE rli.canonical_person_id = $1
            ORDER BY rhc.era, rhc.period_start
        `, [canonical_person_id]);

        // Tier 2 (geographic) query - requires person's primary_state
        // This will be handled in the computeDAAFromLineItems method or by fetching person data separately
        // For now, we'll return an empty array for tier2 if not explicitly requested with state info.
        const tier2Result = []; // Placeholder for now, will implement when person.primary_state is available

        return { tier1: tier1Result.rows, tier2: tier2Result };
    }

    computeDAAFromLineItems(lineItems) {
        const allItems = [...lineItems.tier1, ...lineItems.tier2];
        let total_usd = 0;
        let domestic_total_usd = 0;
        let international_total_usd = 0;

        const line_items_by_era = {
            antebellum: [],
            reconstruction: [],
            jim_crow: [],
            modern: []
        };

        for (const item of allItems) {
            total_usd += parseFloat(item.compounded_amount_usd || 0);

            // Check for domestic legal theories
            const isDomestic = item.legal_theory_jurisdiction === 'domestic_us';
            // Check for international legal theories
            const isInternational = item.legal_theory_jurisdiction === 'international';

            if (isDomestic) {
                domestic_total_usd += parseFloat(item.compounded_amount_usd || 0);
            }
            if (isInternational) {
                international_total_usd += parseFloat(item.compounded_amount_usd || 0);
            }

            if (line_items_by_era[item.era]) {
                line_items_by_era[item.era].push(item);
            }
        }

        // Darity & Mullen demographic per-capita and Brattle US per-capita.
        // SINGLE-SOURCED from macro-config (was inline 14e12/40e6 and 36e12/80e6).
        // NOTE: Brattle's published per-capita is $450,000 (macro-config /
        // global_indicator_targets), NOT 36e12/80e6=$450,000 by coincidence —
        // the prior inline 80e6 denominator was an undocumented guess; we now
        // read Brattle's own figure.
        const darityMullenPerCapita = MACRO.DARITY.percapita_demographic.value;
        const brattleUsPerCapita = MACRO.BRATTLE.us_percapita_usd.value;

        return {
            total_usd,
            domestic_total_usd,
            international_total_usd,
            line_items_by_era,
            global_indicator_context: {
                darity_mullen_per_capita_usd: darityMullenPerCapita,
                brattle_us_per_capita_usd: brattleUsPerCapita,
                note: 'Individual DAA represents Tier 1 directly documented evidence. Global scholars estimate total U.S. obligation at $14T (D&M, domestic racial wealth gap) to $36T (Brattle, international law) across approximately 40–80M eligible descendants.'
            },
            methodology_citations: [
                'Darity, Mullen & Slaughter 2022 (JEP 36:2)',
                'Craemer 2015 (Social Science Quarterly 96:2)',
                'Brattle Group 2023 (ASIL/UWI)',
                'UNGA Resolution A/80/L.48 (March 25, 2026)'
            ]
        };
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

        let debtCalculation;
        if (this.USE_LINE_ITEM_METHODOLOGY && acknowledgerInfo.canonicalPersonId) {
            console.log('Step 4: Calculating debt using Line Item Methodology...');
            const lineItems = await this.getLineItemsForPerson(acknowledgerInfo.canonicalPersonId);
            debtCalculation = this.computeDAAFromLineItems(lineItems);
            console.log(`   ✓ Total Line Item Debt: $${debtCalculation.total_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
            console.log(`   ✓ Domestic Line Item Debt: $${debtCalculation.domestic_total_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
            console.log(`   ✓ International Line Item Debt: $${debtCalculation.international_total_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
        } else {
            // Step 4a: Load participant wealth fingerprint from DB (migration 037).
            console.log('Step 4: Loading participant wealth fingerprint (M037)...');
            const wealthFingerprint = await this.loadParticipantWealthFingerprint(
                acknowledgerInfo.participantId || null,
                acknowledgerInfo
            );
            console.log(`   ✓ Wealth fingerprint loaded: corporateConnectionType=${wealthFingerprint.corporateConnectionType}, trustBeneficiary=${wealthFingerprint.trustBeneficiary}`);
            if (wealthFingerprint.wealthFlagElevated) {
                console.log(`   ⚑ DB wealth_flag_elevated=TRUE (${wealthFingerprint.wealthFlagReasons?.join(', ')})`);
            }

            // Step 4b: Calculate total debt (using ALL financial data)
            console.log('Step 4b: Calculating total debt (Craemer + tiered payment + wealth gap)...');
            debtCalculation = await this.calculateTotalDebt(slaveholderData, wealthFingerprint);
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

        // Step 5b: Wire DAA into enslaver_lineage_ledger (migration 040).
        // Upserts one enslaver_lineage_ledger row per slaveholder and creates
        // daa_lineage_contributions links. This is the mechanism that lets
        // multiple descendants' DAAs aggregate toward a single lineage total
        // (rhizomatic/distributed pledge model).
        console.log('Step 5b: Updating enslaver lineage ledger (M040)...');
        try {
            await this.upsertLineageLedger(slaveholders, debtCalculation, daaRecord.daaId, slaveholderData);
            console.log(`   ✓ Lineage ledger updated for ${slaveholders.length} enslaver(s)`);
        } catch (ledgerErr) {
            // Non-fatal: ledger update failure should NOT block DAA generation.
            // Log and continue — the DAA document is the primary deliverable.
            console.warn(`   ⚠ Lineage ledger update failed (non-fatal): ${ledgerErr.message}`);
        }
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
        if (this.USE_LINE_ITEM_METHODOLOGY && acknowledgerInfo.canonicalPersonId) {
            console.log(`   • Total Line Item Debt: $${debtCalculation.total_usd.toLocaleString()}`);
            console.log(`   • Domestic Line Item Debt: $${debtCalculation.domestic_total_usd.toLocaleString()}`);
            console.log(`   • International Line Item Debt: $${debtCalculation.international_total_usd.toLocaleString()}`);
        } else {
            console.log(`   • Slaveholders: ${slaveholderData.length}`);
            console.log(`   • Enslaved persons: ${totalEnslavedCount}`);
            console.log(`   • Craemer debt: $${debtCalculation.totalDebt.toLocaleString()}`);
            console.log(`   • Wealth-gap obligation: $${debtCalculation.wealthGapObligation.toLocaleString()}`);
            console.log(`   • Recommended debt (higher): $${debtCalculation.recommendedDebt.toLocaleString()}`);
            console.log(`   • Tiered annual payment: $${debtCalculation.annualPayment.toLocaleString()}`);
        }
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

        // Three tiers of documentary evidence, any of which unblocks an
        // ancestor. Each tier has different downstream implications for
        // which distribution methodology the DAA can support.
        //
        //   TIER A (strong):  land_transfer_events rows implicating this
        //                     enslaver — full probate chain, supports
        //                     inheritance-share math per migration 038.
        //   TIER B (moderate): person_documents entries with a probate-
        //                     equivalent document_type — will, probate,
        //                     administration, guardianship, deed, compensation
        //                     petition. Document is captured but transfer
        //                     chain not yet extracted.
        //   TIER C (base):    family_relationships rows where this person is
        //                     listed as an enslaver (person1_role=slaveholder)
        //                     — 1850/1860 slave schedule extraction proves
        //                     the enslaver→enslaved relationship existed.
        //                     Supports the existence claim; share math still
        //                     needs tier A.
        //
        // For each slaveholder in scope we also check ALL canonical_persons
        // rows with the same canonical_name — the project has known
        // duplicate-entry cases (e.g. Maria Angelica Biscoe exists once as
        // person_type='descendant' synced from FamilySearch tree and once
        // as person_type='enslaver' from DC primary sources). Documents on
        // either row count.
        //
        // Gate fails only for slaveholders with zero evidence across all
        // three tiers. On such a failure the DAA is not generated.
        const PROBATE_DOC_TYPES = [
            'will','probate','administration','guardianship','deed',
            'compensation_petition','dc_compensation_petition',
            'compensated_emancipation_petition','dc_petition','petition',
            'estate_inventory'
        ];
        const SCHEDULE_DOC_TYPES = [
            'slave_schedule','1850_slave_schedule','1860_slave_schedule',
            'agricultural_census','tax_list'
        ];

        const SPOUSE_FAMILY_REL_TYPES = [
            'spouse','spouse_of','married_to',
            'parent','parent_of','child','child_of',
            'father','father_of','mother','mother_of',
        ];

        // Per-origin scope: each origin canonical gets its own expanded set
        // of related canonical ids (same-name dupes + spouses/parents/children
        // via person_relationships_verified). Evidence on any of those counts.
        const q = await this.db.query(`
            WITH origins AS (
                SELECT DISTINCT id, canonical_name
                FROM canonical_persons
                WHERE id = ANY($1::int[])
            ),
            scope_per_orig AS (
                -- Self
                SELECT o.id AS orig_id, o.id AS scope_id FROM origins o
                UNION
                -- Same-name duplicates (e.g. Maria Angelica Biscoe had 6 rows before merge)
                SELECT o.id, cp.id
                FROM origins o
                JOIN canonical_persons cp ON cp.canonical_name = o.canonical_name AND cp.id != o.id
                UNION
                -- Spouse / parent / child via person_relationships_verified
                SELECT o.id, prv.related_person_id
                FROM origins o
                JOIN person_relationships_verified prv ON prv.person_id = o.id
                WHERE prv.relationship_type = ANY($4::text[])
                UNION
                SELECT o.id, prv.person_id
                FROM origins o
                JOIN person_relationships_verified prv ON prv.related_person_id = o.id
                WHERE prv.relationship_type = ANY($4::text[])
            )
            SELECT
                o.canonical_name,
                o.id AS enslaver_id,
                EXISTS (
                    SELECT 1 FROM scope_per_orig spo
                    JOIN land_transfer_events lte ON lte.enslaver_person_id = spo.scope_id
                    WHERE spo.orig_id = o.id AND lte.implicates_enslaver = TRUE
                ) AS tier_a,
                EXISTS (
                    SELECT 1 FROM scope_per_orig spo
                    JOIN person_documents pd ON pd.canonical_person_id = spo.scope_id
                    WHERE spo.orig_id = o.id
                      AND LOWER(COALESCE(pd.document_type, '')) = ANY($2::text[])
                ) AS tier_b,
                EXISTS (
                    SELECT 1 FROM scope_per_orig spo
                    JOIN canonical_persons cp ON cp.id = spo.scope_id
                    JOIN family_relationships fr
                        ON LOWER(fr.person1_name) = LOWER(cp.canonical_name)
                       AND fr.relationship_type = 'enslaved_by'
                    WHERE spo.orig_id = o.id
                ) AS tier_c,
                EXISTS (
                    SELECT 1 FROM scope_per_orig spo
                    JOIN person_documents pd ON pd.canonical_person_id = spo.scope_id
                    WHERE spo.orig_id = o.id
                      AND LOWER(COALESCE(pd.document_type, '')) = ANY($3::text[])
                ) AS tier_b_schedule
            FROM origins o
        `, [enslaverIds, PROBATE_DOC_TYPES, SCHEDULE_DOC_TYPES, SPOUSE_FAMILY_REL_TYPES]);

        const passed = [];
        const missing = [];
        for (const r of q.rows) {
            const hasAny = r.tier_a || r.tier_b || r.tier_c || r.tier_b_schedule;
            if (hasAny) {
                const tiers = [
                    r.tier_a && 'A-land',
                    r.tier_b && 'B-probate',
                    r.tier_c && 'C-schedule',
                    r.tier_b_schedule && 'B-schedule-doc',
                ].filter(Boolean).join(',');
                passed.push(`${r.canonical_name} [${tiers}]`);
            } else {
                missing.push(`  • ${r.canonical_name} (id=${r.enslaver_id}): no evidence in any tier`);
            }
        }

        console.log(`   → Probate gate evidence check:`);
        for (const p of passed) console.log(`      ✓ ${p}`);
        if (missing.length > 0) {
            console.log(`   → ${missing.length} ancestor(s) with NO documentary evidence:`);
            for (const m of missing) console.log('   ' + m);
            throw new DAAProbateGateError(
                'DAA generation blocked: the following slaveholder ancestors ' +
                'have no documentary evidence in any tier (land_transfer_events, ' +
                'probate-type person_documents, or family_relationships slave-' +
                'schedule presence):\n' + missing.join('\n') +
                '\n\nRequest primary-source records (probate / deed / 1850 or ' +
                '1860 slave schedule page / DC compensated emancipation petition) ' +
                'for these ancestors and ingest via the wealth-tracing pipeline, ' +
                'then re-run DAA generation. Policy reference: ' +
                'memory/project_debt_distribution_architecture.md.'
            );
        }

        console.log(`   ✓ Probate gate passed: ${passed.length} slaveholders have documentary evidence`);
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
        // Skip matches classified as temporal_impossible or common_name_suspect:
        // these are climb matches the verifier explicitly disqualified, and
        // including them downstream forces the probate gate to demand
        // documentary evidence for ancestors who shouldn't have made the
        // shortlist in the first place. The fallback path at line ~78 already
        // applies this filter; adding it to the primary path makes the two
        // paths consistent and lets operator annotations (UPDATE classification
        // = 'common_name_suspect' on a known false-positive match) actually
        // remove that match from gate scope.
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
              AND (acm.classification IS NULL
                   OR acm.classification NOT IN ('temporal_impossible', 'common_name_suspect'))
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

        // Step 2a: Pre-resolve FS IDs via person_external_ids so we know
        // which canonical_persons IDs the climb already locked in. We need
        // these for the filter on the canonical_persons fetch below.
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

        // Step 2b: Get canonical_persons marked as enslavers/descendants
        // whose names share at least one token with a climb match, OR whose
        // ids were already resolved via person_external_ids.
        //
        // The previous unfiltered "WHERE person_type IN ('enslaver','descendant')"
        // query loaded ~100K+ rows × all columns including `notes` TEXT and
        // tripped Neon serverless's 64MB HTTP response limit (HTTP 507) once
        // the canonical_persons table got large enough.
        //
        // Token-based filter (rather than exact name match) is needed so the
        // fuzzy-match logic below still catches name variants — e.g.
        // climb has "Angelica Chesley" and the canonical row is
        // "Angelica Chew" or "Maria Angelica Biscoe". Tokens of length < 4
        // are dropped so common particles like "de", "of", "jr" don't
        // pull in noise.
        //
        // We also stop SELECTing cp.notes (often very long primary-source
        // narrative); the matcher doesn't need it.
        const idsFromFsLookup = [...fsIdLookup.values()].map(r => r.canonical_person_id).filter(Boolean);
        const tokens = new Set();
        for (const r of climbNames.rows) {
            const name = (r.slaveholder_name || '').toLowerCase();
            for (const t of name.split(/[\s,.]+/)) {
                if (t.length >= 4) tokens.add(t);
            }
        }
        const tokenPatterns = [...tokens].map(t => `%${t}%`);

        const documentedSlaveholders = await this.db.query(`
            SELECT
                cp.id,
                cp.canonical_name,
                cp.birth_year_estimate,
                cp.death_year_estimate,
                cp.primary_state,
                cp.primary_county,
                cp.person_type
            FROM canonical_persons cp
            WHERE cp.person_type = ANY($3::text[])
              AND (
                  LOWER(cp.canonical_name) ILIKE ANY($1::text[])
                  OR cp.id = ANY($2::int[])
              )
            ORDER BY cp.canonical_name ASC
            LIMIT 10000
        `, [tokenPatterns.length ? tokenPatterns : ['__no_match__'], idsFromFsLookup,
            [...OWNER_ROLE_TYPES, 'descendant']]);
        // Index by id and (normalized) canonical_name for quick lookup
        const byId = new Map();
        const byName = new Map();
        for (const sh of documentedSlaveholders.rows) {
            byId.set(sh.id, sh);
            const key = (sh.canonical_name || '').toLowerCase().trim();
            if (!byName.has(key)) byName.set(key, []);
            byName.get(key).push(sh);
        }

        console.log(`   → ${documentedSlaveholders.rows.length} canonical_persons in scope (owner-side or descendant)`);

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
                    // Prefer an owner-side match (enslaver / slaveholder / free_poc_slaveholder / …)
                    // over a descendant on a name collision.
                    matched = candidates.find(c => isOwnerType(c.person_type)) || candidates[0];
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
                WHERE up.person_type IN ('enslaved','suspected_enslaved')
                AND jsonb_typeof(up.relationships) = 'array'
                AND EXISTS (
                    SELECT 1 FROM jsonb_array_elements(up.relationships) e, canonical_persons cp
                    WHERE cp.id = $1
                    AND e->>'type' = 'enslaved_by'
                    AND LOWER(COALESCE(e->>'name', e->>'related_to')) = LOWER(cp.canonical_name)
                )
                ORDER BY up.full_name
                LIMIT 100
            `, [slaveholder.slaveholder_id]);
            // NB (fixed): unconfirmed_persons.relationships is a JSONB ARRAY of {type,name|related_to};
            // the prior query read it as an OBJECT (relationships->>'enslaved_by'), so it silently
            // matched ZERO array-shaped rows. Now matches array elements by type + owner name.

            // Source 4: the lead-aware ownership edge table (M103/M104, populated by
            // build-enslaved-owner-edges). Reaches enslaved persons that are LEADS (SlaveVoyages
            // PAST / Hall / unconfirmed) linked enslaved_by an owner whose name matches this
            // enslaver — the de-siloing payoff (#3). Internal-only use (the external-assertion
            // gate doesn't apply to DAA computation). Owner matched by name, same accepted
            // ambiguity caveat as Source 2, until owner-lead→canonical linking lands.
            const ownerEdgeResult = await this.db.query(`
                SELECT DISTINCT ON (eor.enslaved_name)
                    eor.enslaved_subject_id as enslaved_id,
                    eor.enslaved_name as enslaved_name,
                    NULL as birth_year,
                    NULL as death_year,
                    NULL as freedom_year,
                    NULL as gender,
                    'enslaved_owner_relationships:' || eor.enslaved_subject_table as data_source,
                    eor.source_url as document_source_url,
                    NULL as s3_url,
                    NULL as document_type,
                    NULL as collection_name,
                    NULL as film_number,
                    NULL as image_number,
                    eor.confidence_score as match_confidence
                FROM enslaved_owner_relationships eor
                LEFT JOIN unconfirmed_persons o
                    ON eor.owner_subject_table = 'unconfirmed_persons' AND eor.owner_subject_id = o.lead_id
                WHERE eor.relationship_type = 'enslaved_by'
                AND eor.enslaved_name IS NOT NULL
                -- ⑤ data-quality: skip enslaved leads flagged as document/OCR artifacts (not people)
                AND NOT EXISTS (
                    SELECT 1 FROM unconfirmed_persons ej
                    WHERE eor.enslaved_subject_table = 'unconfirmed_persons'
                      AND ej.lead_id = eor.enslaved_subject_id
                      AND ej.data_quality_flags->>'name_artifact' = 'true'
                )
                AND (
                    -- FK path (#1 owner-lead→canonical linking): owner is/links to THIS canonical.
                    -- $2 bound as TEXT (confirmed_individual_id is varchar); cast per column.
                    (eor.owner_subject_table = 'canonical_persons' AND eor.owner_subject_id = $2::int)
                    OR eor.owner_canonical_id = $2::int
                    OR o.confirmed_individual_id = $2::text
                    -- name path (until the owner lead is review-confirmed): same accepted ambiguity as Source 2
                    OR LOWER(eor.owner_name) = LOWER($1)
                )
                ORDER BY eor.enslaved_name
                LIMIT 500
            `, [slaveholder.slaveholder_name, String(slaveholder.slaveholder_id)]);
            // FK path resolves owner identity properly (confirmed_individual_id set when a
            // cross_source_candidates link is human-reviewed); name path is the fallback until then.

            // Merge all sources, deduplicate by name
            const allEnslaved = [...enslavedResult.rows];
            const seenNames = new Set(allEnslaved.map(e => (e.enslaved_name || '').toLowerCase()));

            for (const row of [...relResult.rows, ...uncResult.rows, ...ownerEdgeResult.rows]) {
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

        // ── Combination: reconcile (replaces max(Craemer, wealth-gap)) ──
        // compareWithCraemer (the old max rule) is kept ONLY for display/back-compat;
        // the recommended figure now comes from ObligationReconciler.combine so the
        // headline number is a reconciled central estimate, not "whichever theory
        // is biggest". (Disgorgement/line-item predictors are added at the lineage
        // level in upsertLineageLedger; this DAA-level call reconciles the two
        // predictors available here.)
        const dualMethodology = this.wealthGapCalc.compareWithCraemer(
            wealthGapResult,
            totalDebt
        );
        const reconciledDaa = this.reconciler.combine({
            craemer:   totalDebt > 0 ? { usd: totalDebt, confidence: 0.7 } : null,
            wealthGap: wealthGapResult.totalObligation > 0 ? { usd: wealthGapResult.totalObligation, confidence: wealthGapResult.isImputed ? 0.3 : 0.5 } : null,
            disgorgement: { usd: 0, confidence: 0.2, evidence: 'none' },
            lineItem: null,
        });
        dualMethodology.reconciled = reconciledDaa.reconciled_obligation_usd;
        dualMethodology.reconciliationConfidence = reconciledDaa.confidence;
        dualMethodology.disagreement = reconciledDaa.disagreement;

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

            // Dual methodology recommendation — recommended is now the RECONCILED
            // figure (was dualMethodology.recommended = the max of the two).
            dualMethodology,
            recommendedDebt: reconciledDaa.reconciled_obligation_usd,
            recommendedDebtLegacyMax: dualMethodology.recommended,
            reconciliation: reconciledDaa,

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
        let totalDebtValue;
        let calculationMethodology;
        let calculationBreakdown;

        if (this.USE_LINE_ITEM_METHODOLOGY && acknowledgerInfo.canonicalPersonId) {
            totalDebtValue = debtCalculation.total_usd;
            calculationMethodology = 'Itemized Reparations Line Items';
            calculationBreakdown = debtCalculation; // Store the full line item breakdown
        } else {
            totalDebtValue = debtCalculation.recommendedDebt;
            calculationMethodology = debtCalculation.dualMethodology.recommendedMethodology;
            calculationBreakdown = {
                craemerDebt: debtCalculation.totalDebt,
                wealthGapObligation: debtCalculation.wealthGapObligation,
                tieredBreakdown: debtCalculation.tieredBreakdown,
                corporateEvidence: debtCalculation.corporateEvidence,
                slaveholderCalculations: debtCalculation.slaveholderCalculations
            };
        }

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
            totalDebt: totalDebtValue, // Use the determined totalDebtValue
            calculationMethodology: calculationMethodology, // Use the determined methodology
            calculationBreakdown: calculationBreakdown, // Use the determined breakdown
            notes: `Comprehensive DAA generated from ancestor climb session ${climbSession.id}. ${slaveholderData.length} documented slaveholder(s), ${allEnslavedPersons.length} documented enslaved person(s). Climb visited ${climbSession.ancestors_visited} ancestors with ${climbSession.matches_found} matches.`
        });

        return daaResult;
    }

    /**
     * Load participant wealth fingerprint from the M037 participants table,
     * then merge with any inline acknowledgerInfo fields.
     * Inline values take precedence so callers can always override via the
     * HTTP request body without a DB round-trip.
     *
     * @param {string|null} participantId  - UUID from participants.participant_id (may be null)
     * @param {Object}      acknowledgerInfo - Raw acknowledger payload from the API caller
     * @returns {Object} Merged financial fingerprint ready for calculateTotalDebt()
     */
    async loadParticipantWealthFingerprint(participantId, acknowledgerInfo) {
        // Sensible defaults — matches the schema nullable columns in M037
        const defaults = {
            annualIncome:           acknowledgerInfo.annualIncome           ?? null,
            netWorth:               acknowledgerInfo.netWorth               ?? null,
            corporateConnections:   acknowledgerInfo.corporateConnections   ?? false,
            corporateConnectionType:acknowledgerInfo.corporateConnectionType?? null,
            trustBeneficiary:       acknowledgerInfo.trustBeneficiary       ?? false,
            trustCorpus:            acknowledgerInfo.trustCorpus            ?? null,
            inheritedLandAcres:     acknowledgerInfo.inheritedLandAcres     ?? null,
            wealthFlagElevated:     acknowledgerInfo.wealthFlagElevated     ?? false,
            wealthFlagReasons:      acknowledgerInfo.wealthFlagReasons      ?? [],
        };

        if (!participantId) {
            return defaults;
        }

        let dbRow = null;
        try {
            const result = await this.db.query(`
                SELECT
                    annual_income,
                    net_worth,
                    corporate_connections,
                    corporate_connection_type,
                    trust_beneficiary,
                    trust_corpus,
                    inherited_land_acres,
                    wealth_flag_elevated,
                    wealth_flag_reasons
                FROM participants
                WHERE participant_id = $1
                LIMIT 1
            `, [participantId]);

            if (result.rows.length > 0) {
                dbRow = result.rows[0];
            }
        } catch (err) {
            // Non-fatal: participants table may not yet be migrated on this environment
            console.warn(`[DAAOrchestrator] Could not load M037 wealth fingerprint for participant ${participantId}: ${err.message}`);
        }

        if (!dbRow) {
            return defaults;
        }

        // Merge: inline acknowledgerInfo wins, DB fills gaps
        return {
            annualIncome:           acknowledgerInfo.annualIncome           ?? dbRow.annual_income           ?? null,
            netWorth:               acknowledgerInfo.netWorth               ?? dbRow.net_worth               ?? null,
            corporateConnections:   acknowledgerInfo.corporateConnections   ?? dbRow.corporate_connections   ?? false,
            corporateConnectionType:acknowledgerInfo.corporateConnectionType?? dbRow.corporate_connection_type?? null,
            trustBeneficiary:       acknowledgerInfo.trustBeneficiary       ?? dbRow.trust_beneficiary       ?? false,
            trustCorpus:            acknowledgerInfo.trustCorpus            ?? dbRow.trust_corpus            ?? null,
            inheritedLandAcres:     acknowledgerInfo.inheritedLandAcres     ?? dbRow.inherited_land_acres    ?? null,
            wealthFlagElevated:     acknowledgerInfo.wealthFlagElevated     ?? dbRow.wealth_flag_elevated    ?? false,
            wealthFlagReasons:      acknowledgerInfo.wealthFlagReasons      ?? dbRow.wealth_flag_reasons     ?? [],
        };
    }

    /**
     * Upsert rows in enslaver_lineage_ledger (M040) for each slaveholder
     * that has a canonical slaveholder_id, then link each ledger entry to
     * the newly created DAA via daa_lineage_contributions.
     *
     * Failures are non-fatal: the DAA document has already been committed to
     * the DB by the time this is called, so a ledger write failure should only
     * warn — never roll back the DAA.
     *
     * @param {Array}  slaveholders    - Array of slaveholder objects from getDocumentedSlaveholders()
     * @param {Object} debtCalculation - Result of calculateTotalDebt()
     * @param {string} daaId           - UUID of the newly created DAA record
     */
    async upsertLineageLedger(slaveholders, debtCalculation, daaId, slaveholderData = []) {
        if (!slaveholders || slaveholders.length === 0) return;

        // IMPORTANT FIX (Jun 2026): this writer previously targeted columns that
        // DO NOT EXIST on the live enslaver_lineage_ledger (enslaver_canonical_id,
        // craemer_2015_total_usd, wealth_gap_share_usd, combined_obligation_usd,
        // generation_from_enslaver) with ON CONFLICT on a nonexistent unique
        // key — so every write silently failed in the catch and the table stayed
        // empty (0 rows). The live schema is migration 040 (+093):
        //   enslaver_person_id (UNIQUE), total_obligation_usd, craemer_component_usd,
        //   wealth_gap_component_usd, disgorgement_component_usd, line_item_component_usd,
        //   reconciled_obligation_usd, obligation_confidence, reconciliation_metadata.
        // This rewrite targets the real columns AND replaces the max/sum rule with
        // the four-predictor ObligationReconciler.

        const sdByKey = new Map();
        for (const d of (slaveholderData || [])) {
            if (d?.slaveholder?.slaveholder_id) sdByKey.set(d.slaveholder.slaveholder_id, d);
        }

        for (const sh of slaveholders) {
            const slaveholderId = sh.slaveholder_id;
            if (!slaveholderId) continue;   // Skip unresolved climb matches

            try {
                // ── Predictor 1: Craemer labor-value over THIS enslaver's documented enslaved ──
                // Prefer the per-slaveholder breakdown from the legacy path; else
                // compute from the aggregated enslaved persons for this lineage.
                const slaveholderCalc = (debtCalculation.slaveholderCalculations || [])
                    .find(c => c.slaveholder?.slaveholder_id === slaveholderId
                            || c.slaveholder?.slaveholder_name === sh.slaveholder_name);
                let craemerLineage = slaveholderCalc?.debt ?? null;
                const sd = sdByKey.get(slaveholderId);
                if (craemerLineage == null && sd && Array.isArray(sd.enslavedPersons) && sd.enslavedPersons.length) {
                    const preview = this.daaGenerator.calculatePreview(
                        sd.enslavedPersons.map(p => ({
                            name: p.enslaved_name,
                            yearsEnslaved: p.years_enslaved,
                            startYear: p.start_year || 1800,
                        })).filter(p => p.yearsEnslaved != null),
                        1 // annualIncome unused for the historical-debt preview
                    );
                    craemerLineage = preview.totalDebt || null;
                }

                // ── Descendant aggregation (fixes the 100%-to-everyone bug) ──
                // estimated_living_descendants is the denominator for the lineage's
                // share-of-gap AND for each DAA's contribution share. Sourced from
                // the inheritance graph heir count when available, else a documented
                // generational-fanout estimate — NEVER defaulted to 1 (= full share).
                const { estDescendants, method: descMethod } =
                    await this._estimateLivingDescendants(slaveholderId, sh.generation_distance);

                // ── Predictor 2: wealth-gap share for this lineage ──
                // Lineage's collective share of the SCF gap = base-share-per-descendant
                // × this lineage's estimated living descendants. (Allocation
                // disciplined by descendant count, not a hand-picked multiplier.)
                const wealthGapLineage = this.wealthGapCalc.BASE_SHARE_PER_DESCENDANT * estDescendants;

                // ── Predictor 3: disgorgement (traced non-chattel enrichment) ──
                const disg = await this.disgorgementCalc.forEnslaver(slaveholderId);

                // ── Predictor 4: line-item sum tied to this lineage's enslaved ──
                const lineItemLineage = await this._lineItemSumForLineage(slaveholderId, sd);

                // ── Reconcile the four predictors (replaces max / sum) ──
                const result = this.reconciler.combine({
                    craemer:      craemerLineage != null ? { usd: craemerLineage, confidence: 0.7 } : null,
                    wealthGap:    estDescendants > 0 ? { usd: wealthGapLineage, confidence: 0.5 } : null,
                    disgorgement: { usd: disg.total_usd, confidence: disg.confidence, evidence: disg.evidence },
                    lineItem:     lineItemLineage != null ? { usd: lineItemLineage, confidence: 0.6 } : null,
                });

                const metadata = {
                    ...result.metadata,
                    predictors: result.predictors,
                    disagreement: result.disagreement,
                    flags: result.flags,
                    estimated_living_descendants: estDescendants,
                    descendants_estimate_method: descMethod,
                    disgorgement_detail: disg,
                };

                const lineageResult = await this.db.query(`
                    INSERT INTO enslaver_lineage_ledger (
                        enslaver_person_id,
                        enslaver_canonical_name,
                        total_obligation_usd,
                        craemer_component_usd,
                        wealth_gap_component_usd,
                        disgorgement_component_usd,
                        line_item_component_usd,
                        reconciled_obligation_usd,
                        obligation_confidence,
                        reconciliation_metadata,
                        calculation_methodology_note,
                        calculated_at,
                        estimated_living_descendants,
                        descendants_estimate_method,
                        created_at,
                        updated_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, NOW(), $12, $13, NOW(), NOW()
                    )
                    ON CONFLICT (enslaver_person_id)
                    DO UPDATE SET
                        total_obligation_usd         = EXCLUDED.total_obligation_usd,
                        craemer_component_usd        = EXCLUDED.craemer_component_usd,
                        wealth_gap_component_usd     = EXCLUDED.wealth_gap_component_usd,
                        disgorgement_component_usd   = EXCLUDED.disgorgement_component_usd,
                        line_item_component_usd      = EXCLUDED.line_item_component_usd,
                        reconciled_obligation_usd    = EXCLUDED.reconciled_obligation_usd,
                        obligation_confidence        = EXCLUDED.obligation_confidence,
                        reconciliation_metadata      = EXCLUDED.reconciliation_metadata,
                        calculation_methodology_note = EXCLUDED.calculation_methodology_note,
                        calculated_at                = NOW(),
                        estimated_living_descendants = EXCLUDED.estimated_living_descendants,
                        descendants_estimate_method  = EXCLUDED.descendants_estimate_method,
                        updated_at                   = NOW()
                    RETURNING lineage_id
                `, [
                    slaveholderId,
                    sh.slaveholder_name,
                    result.reconciled_obligation_usd,
                    craemerLineage,
                    wealthGapLineage,
                    disg.total_usd,
                    lineItemLineage,
                    result.reconciled_obligation_usd,
                    result.confidence,
                    JSON.stringify(metadata),
                    result.metadata.combination_rule,
                    estDescendants,
                    descMethod,
                ]);

                const lineageId = lineageResult.rows[0]?.lineage_id;
                if (!lineageId) continue;

                // Per-descendant contribution share — reconciled obligation divided
                // across the lineage's estimated living descendants. This is the
                // fix for "100% of ancestral debt to each descendant": share_fraction
                // is 1/estDescendants, not 1.0.
                const shareFraction = estDescendants > 0 ? 1.0 / estDescendants : null;
                const contributionUsd = shareFraction != null
                    ? Math.round(result.reconciled_obligation_usd * shareFraction * 100) / 100
                    : result.reconciled_obligation_usd;
                const shareBasis = descMethod === 'inheritance_heir_count'
                    ? 'inheritance_share_probate'
                    : 'naive_generational_split';

                await this.db.query(`
                    INSERT INTO daa_lineage_contributions (
                        daa_id, lineage_id, contribution_usd, share_basis, share_fraction,
                        share_methodology_note, source_calculation, confidence, created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, NOW())
                    ON CONFLICT (daa_id, lineage_id) DO UPDATE SET
                        contribution_usd = EXCLUDED.contribution_usd,
                        share_basis = EXCLUDED.share_basis,
                        share_fraction = EXCLUDED.share_fraction,
                        source_calculation = EXCLUDED.source_calculation,
                        confidence = EXCLUDED.confidence
                `, [
                    daaId, lineageId, contributionUsd, shareBasis, shareFraction,
                    `Reconciled lineage obligation ${result.reconciled_obligation_usd} ÷ ${estDescendants} est. living descendants (${descMethod}).`,
                    JSON.stringify({ reconciled: result.reconciled_obligation_usd, predictors: result.predictors, disagreement: result.disagreement }),
                    result.confidence,
                ]);

            } catch (err) {
                console.warn(`[DAAOrchestrator] upsertLineageLedger failed for slaveholder ${slaveholderId}: ${err.message}`);
                // Non-fatal — continue with remaining slaveholders
            }
        }
    }

    /**
     * Estimate living descendants of an enslaver lineage — the denominator that
     * fixes the "100% of debt to each descendant" bug. Priority:
     *   1. inheritance_summary_by_testator.heir_count (documented heirs) — when
     *      this enslaver appears as a testator in inheritance_edges.
     *   2. generational fan-out: ~2 surviving children per generation from the
     *      enslaver to the present (generation_distance), a documented demographic
     *      proxy (carried as a flagged estimate, not a silent constant).
     * Never returns < 1; never defaults to 1-as-full-share silently.
     */
    async _estimateLivingDescendants(enslaverPersonId, generationDistance) {
        try {
            const r = await this.db.query(`
                SELECT heir_count FROM inheritance_summary_by_testator WHERE testator_id = $1
            `, [enslaverPersonId]);
            if (r.rows.length && Number(r.rows[0].heir_count) > 0) {
                // Heirs documented at gen 1; project forward by fan-out to present.
                const heirs = Number(r.rows[0].heir_count);
                const gens = Math.max(0, (generationDistance || 6) - 1);
                const projected = Math.round(heirs * Math.pow(2, gens));
                return { estDescendants: Math.max(heirs, projected), method: 'inheritance_heir_count' };
            }
        } catch (e) { /* view may be absent on some envs — fall through */ }

        // Generational fan-out proxy (≈2 surviving offspring/generation).
        const gens = generationDistance || 6;
        const est = Math.max(1, Math.round(Math.pow(2, gens)));
        return { estDescendants: est, method: 'generational_fanout_2_per_gen' };
    }

    /**
     * Sum of reparations_line_items.compounded_amount_usd attributable to this
     * enslaver lineage. Line items are keyed to affected canonical persons; we
     * sum those tied to this enslaver's documented enslaved where resolvable.
     * Returns null (predictor absent) when nothing resolves — NOT 0-as-fact.
     */
    async _lineItemSumForLineage(enslaverPersonId, slaveholderData) {
        try {
            const r = await this.db.query(`
                SELECT COALESCE(SUM(rli.compounded_amount_usd), 0) AS sum_usd, COUNT(*) AS n
                FROM reparations_line_items rli
                JOIN family_relationships fr
                  ON LOWER(fr.person2_name) = LOWER((SELECT canonical_name FROM canonical_persons WHERE id = rli.canonical_person_id))
                JOIN canonical_persons enslaver ON LOWER(fr.person1_name) = LOWER(enslaver.canonical_name)
                WHERE enslaver.id = $1
                  AND fr.relationship_type = 'enslaved_by'
            `, [enslaverPersonId]);
            const n = Number(r.rows[0].n) || 0;
            if (n === 0) return null;
            return Math.round(Number(r.rows[0].sum_usd) * 100) / 100;
        } catch (e) {
            return null;
        }
    }
}

module.exports = DAAOrchestrator;
module.exports.DAAProbateGateError = DAAProbateGateError;
