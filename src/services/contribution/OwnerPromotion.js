/**
 * OwnerPromotion - Promote slave owners based on CONTENT-BASED confirmation
 *
 * IMPORTANT: Promotion is based on ACTUAL DOCUMENT CONTENT, not source domain.
 * A .gov URL does NOT automatically mean the data is confirmed.
 *
 * Confirmation can ONLY come from:
 * 1. Human transcription of names from the document
 * 2. OCR extraction that has been human-verified
 * 3. High-confidence OCR (>= 95%) from a document the user confirmed contains owner/slave data
 * 4. Structured metadata parsed from the page that user confirmed as accurate
 * 5. Cross-reference with existing confirmed records
 *
 * The source domain (government archive, genealogy site, etc.) provides CONTEXT
 * about where to look for documents, but does NOT confirm the data itself.
 *
 * STEP 3 REWIRE (de-siloing): this class's valuable confirmatory-channel/confidence gate is
 * preserved, but promotion now routes through PersonService.promoteToCanonical — minting into
 * the deduped, gated `canonical_persons` (NOT the dead `individuals` table). The external-
 * assertion gate stays FALSE until a proposition-specific STORED (s3_key) document is attached
 * (canonical/document-gate standard). This fixes the 3rd of the 3 live dead-`individuals` writes.
 */

const { v4: uuidv4 } = require('uuid');
const PersonService = require('../PersonService');

class OwnerPromotion {
    constructor(database) {
        this.db = database;

        // Confirmatory channels - the ONLY ways data can be confirmed
        // This is designed to grow as new confirmation methods are added
        this.confirmatoryChannels = {
            'human_transcription': {
                name: 'Human Transcription',
                description: 'User manually transcribed names from document',
                minConfidence: 0.90,
                requiresHumanInput: true
            },
            'ocr_human_verified': {
                name: 'OCR + Human Verification',
                description: 'OCR extraction reviewed and corrected by human',
                minConfidence: 0.85,
                requiresHumanInput: true
            },
            'ocr_high_confidence': {
                name: 'High-Confidence OCR',
                description: 'OCR with >= 95% confidence from user-confirmed document',
                minConfidence: 0.95,
                requiresHumanInput: false  // But requires user to confirm doc type
            },
            'structured_metadata': {
                name: 'Structured Page Metadata',
                description: 'Data parsed from page that user confirmed as accurate',
                minConfidence: 0.80,
                requiresHumanInput: true
            },
            'cross_reference': {
                name: 'Cross-Reference Match',
                description: 'Name matches existing confirmed record from different source',
                minConfidence: 0.85,
                requiresHumanInput: false
            }
            // ADD NEW CHANNELS HERE as they become available
        };

        // Document types that CAN contain confirmatory data (when extracted properly)
        // These are just hints for the UI - they don't auto-confirm anything
        this.documentTypesWithOwnerData = [
            'slave_schedule',
            'census',
            'compensation_petition',
            'emancipation_petition',
            'court_record',
            'tax_record',
            'slave_manifest',
            'estate_inventory',
            'will_testament',
            'bill_of_sale',
            'plantation_record'
        ];
    }

    /**
     * Check if a source domain is a government/institutional archive
     * NOTE: This does NOT confirm data - it just provides context about the source
     */
    isGovernmentArchive(url) {
        if (!url) return false;
        const lowerUrl = url.toLowerCase();
        return lowerUrl.includes('.gov') ||
               lowerUrl.includes('archives') ||
               lowerUrl.includes('msa.maryland') ||
               lowerUrl.includes('civilwardc.org');
    }

    /**
     * Get list of available confirmatory channels
     */
    getConfirmatoryChannels() {
        return Object.entries(this.confirmatoryChannels).map(([id, channel]) => ({
            id,
            ...channel
        }));
    }

    /**
     * Add a new confirmatory channel (for extensibility)
     */
    addConfirmatoryChannel(id, config) {
        if (this.confirmatoryChannels[id]) {
            throw new Error(`Confirmatory channel '${id}' already exists`);
        }
        this.confirmatoryChannels[id] = {
            name: config.name,
            description: config.description,
            minConfidence: config.minConfidence || 0.85,
            requiresHumanInput: config.requiresHumanInput !== false
        };
        console.log(`Added new confirmatory channel: ${id}`);
    }

    /**
     * Check if a person qualifies for promotion
     *
     * CRITICAL: Promotion requires CONTENT-BASED confirmation, not just source domain
     */
    qualifiesForPromotion(person, sourceMetadata, confirmationChannel = null) {
        // Must be an owner type
        const personType = person.person_type?.toLowerCase() || person.type?.toLowerCase();
        if (!['owner', 'slaveholder', 'slave_owner'].includes(personType)) {
            return { qualifies: false, reason: 'Not an owner type' };
        }

        // Must have a valid name
        if (!person.full_name || person.full_name.length < 2) {
            return { qualifies: false, reason: 'Invalid or missing name' };
        }

        // Filter out obviously bad names
        const badNames = ['unknown', 'illegible', 'unclear', '???', 'n/a', 'none'];
        if (badNames.some(bad => person.full_name.toLowerCase().includes(bad))) {
            return { qualifies: false, reason: 'Name is illegible or unknown' };
        }

        // CRITICAL: Must have a valid confirmatory channel
        if (!confirmationChannel) {
            return {
                qualifies: false,
                reason: 'No confirmatory channel specified. Data must be confirmed via human transcription, verified OCR, or other valid channel.',
                hint: 'Available channels: ' + Object.keys(this.confirmatoryChannels).join(', ')
            };
        }

        const channel = this.confirmatoryChannels[confirmationChannel];
        if (!channel) {
            return {
                qualifies: false,
                reason: `Unknown confirmatory channel: ${confirmationChannel}`,
                hint: 'Available channels: ' + Object.keys(this.confirmatoryChannels).join(', ')
            };
        }

        // Check confidence against channel's minimum
        const confidence = parseFloat(person.confidence_score) || 0;
        if (confidence < channel.minConfidence) {
            return {
                qualifies: false,
                reason: `Confidence ${(confidence * 100).toFixed(0)}% below ${channel.name} threshold of ${(channel.minConfidence * 100).toFixed(0)}%`,
                confidence
            };
        }

        // All checks passed
        return {
            qualifies: true,
            reason: `Confirmed via ${channel.name}`,
            confidence,
            confirmationChannel,
            channelName: channel.name
        };
    }

    /**
     * Promote a single owner to a (deduped, gated) canonical_persons row via PersonService.
     * The confirmatory-channel/confidence gate above still decides WHETHER to promote; the
     * minting, dedup, document-attach, and external-assertion gate are PersonService's job.
     */
    async promoteOwner(person, sourceMetadata, confirmationChannel, extractionId = null) {
        const qualification = this.qualifiesForPromotion(person, sourceMetadata, confirmationChannel);

        if (!qualification.qualifies) {
            console.log(`    ⚠️  Skipping ${person.full_name}: ${qualification.reason}`);
            return {
                success: false,
                reason: qualification.reason,
                hint: qualification.hint,
                person: person.full_name
            };
        }

        try {
            const ps = this._personService || (this._personService = new PersonService(this.db));
            const srcUrl = sourceMetadata?.url || person.source_url;
            const isPrimary = this.isGovernmentArchive(srcUrl);

            // Resolve to a lead ref to promote: use an existing lead_id, else find-or-create one
            // (which dedups + writes blocking keys). findOrCreateLead may itself LINK directly to
            // an existing canonical — promoteToCanonical handles a canonical ref too (attaches
            // evidence + recomputes the gate rather than minting a duplicate).
            let leadRef;
            if (person.lead_id) {
                leadRef = { subject_table: 'unconfirmed_persons', subject_id: person.lead_id };
            } else {
                const loc = await ps.findOrCreateLead({
                    name: person.full_name,
                    personType: 'owner',
                    birthYear: person.birth_year || null,
                    deathYear: person.death_year || null,
                    locations: Array.isArray(person.locations) ? person.locations : (person.location ? [person.location] : []),
                    sourceUrl: srcUrl,
                    sourceType: isPrimary ? 'primary' : 'secondary',
                    confidence: qualification.confidence,
                });
                if (!loc.ref) {
                    return { success: false, reason: 'could not create/resolve a lead for promotion', person: person.full_name };
                }
                leadRef = loc.ref;
            }

            // The confirmatory document → a person_documents row. s3_key only when a REAL stored
            // file is supplied (sourceMetadata.s3Key) — a bare URL does NOT lift the gate.
            const evidence = {
                personType: 'enslaver',
                sourceType: isPrimary ? 'primary' : 'secondary',
                confidence: qualification.confidence,
                createdBy: `owner_promotion:${confirmationChannel}`,
                document: {
                    documentType: sourceMetadata?.documentType || person.document_type || null,
                    sourceUrl: srcUrl,
                    s3Key: sourceMetadata?.s3Key || null,
                    s3Url: sourceMetadata?.s3Url || null,
                    evidenceStrength: sourceMetadata?.s3Key ? 'direct_primary' : 'secondary_database',
                },
            };

            const r = await ps.promoteToCanonical(leadRef, evidence);

            if (r.action === 'needs_review') {
                console.log(`    ⏸  ${person.full_name}: ambiguous identity match — routed to human review (Biscoe rule, no auto-merge)`);
                return { success: false, reason: 'ambiguous identity match — needs human review', candidates: r.candidates, person: person.full_name };
            }
            if (!r.ref) {
                return { success: false, reason: r.action || 'promotion failed', person: person.full_name };
            }

            await this.logPromotion(person, r.ref.subject_id, qualification, extractionId);

            const gate = r.gate || {};
            console.log(`    ✓ Promoted to canonical #${r.ref.subject_id} (${r.action}); slaveowner-assertable=${!!gate.assertable_slaveowner}: ${person.full_name}`);

            return {
                success: true,
                action: r.action,
                canonicalId: r.ref.subject_id,
                gate,
                person: person.full_name,
                confidence: qualification.confidence,
                confirmationChannel: qualification.confirmationChannel
            };

        } catch (error) {
            console.error(`    ✗ Failed to promote ${person.full_name}:`, error.message);
            return {
                success: false,
                reason: error.message,
                person: person.full_name
            };
        }
    }

    /**
     * Parse name into components
     */
    parseName(fullName) {
        if (!fullName) return { firstName: null, lastName: null };

        const name = fullName.trim();

        // Handle "LASTNAME, FIRSTNAME" format
        if (name.includes(',')) {
            const parts = name.split(',').map(p => p.trim());
            return {
                lastName: parts[0],
                firstName: parts[1] || null
            };
        }

        // Handle "FIRSTNAME LASTNAME" format
        const parts = name.split(/\s+/);
        if (parts.length === 1) {
            return { firstName: null, lastName: parts[0] };
        }

        return {
            firstName: parts[0],
            lastName: parts.slice(1).join(' ')
        };
    }

    /**
     * Log promotion for audit trail
     */
    async logPromotion(person, individualId, qualification, extractionId) {
        try {
            await this.db.query(`
                INSERT INTO promotion_log (
                    individual_id,
                    full_name,
                    source_url,
                    confidence_score,
                    promotion_type,
                    promotion_reason,
                    promoted_at
                ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
            `, [
                individualId,
                person.full_name,
                person.source_url,
                qualification.confidence,
                qualification.confirmationChannel,
                qualification.reason
            ]);
        } catch (error) {
            // Log table might have different schema - that's okay
            console.log(`    (Promotion log note: ${error.message})`);
        }
    }

    /**
     * Batch promote owners from an extraction job
     * Requires specifying the confirmatory channel used
     */
    async promoteFromExtraction(extractionId, sourceMetadata, confirmationChannel) {
        console.log(`\n📍 Promoting owners from extraction ${extractionId}`);
        console.log(`    Confirmation channel: ${confirmationChannel}`);

        if (!confirmationChannel) {
            console.log(`    ✗ No confirmatory channel specified - cannot promote`);
            return {
                promoted: 0,
                skipped: 0,
                errors: 0,
                error: 'Confirmatory channel is required'
            };
        }

        if (!this.confirmatoryChannels[confirmationChannel]) {
            console.log(`    ✗ Unknown confirmatory channel: ${confirmationChannel}`);
            return {
                promoted: 0,
                skipped: 0,
                errors: 0,
                error: `Unknown channel. Available: ${Object.keys(this.confirmatoryChannels).join(', ')}`
            };
        }

        // Get extracted persons from the extraction job
        let persons = [];

        try {
            const result = await this.db.query(`
                SELECT parsed_rows FROM extraction_jobs WHERE extraction_id = $1
            `, [extractionId]);

            if (result.rows.length > 0 && result.rows[0].parsed_rows) {
                persons = result.rows[0].parsed_rows;
            }
        } catch (error) {
            console.error(`    ✗ Failed to get extraction data: ${error.message}`);
            return { promoted: 0, skipped: 0, errors: 1 };
        }

        if (persons.length === 0) {
            console.log(`    ⚠️  No persons found to promote`);
            return { promoted: 0, skipped: 0, errors: 0 };
        }

        console.log(`    Found ${persons.length} persons to evaluate`);

        // Filter to owners only
        const owners = persons.filter(p => {
            const type = (p.person_type || p.type || '').toLowerCase();
            return ['owner', 'slaveholder', 'slave_owner'].includes(type) ||
                   (p.columns && p.columns.owner_name);
        });

        console.log(`    ${owners.length} are owner type`);

        // Promote each qualifying owner
        let promoted = 0;
        let skipped = 0;
        let errors = 0;

        for (const owner of owners) {
            // Normalize the owner object
            const normalizedOwner = {
                full_name: owner.full_name || owner.columns?.owner_name || owner.name,
                person_type: 'owner',
                birth_year: owner.birth_year || owner.columns?.birth_year,
                death_year: owner.death_year || owner.columns?.death_year,
                locations: owner.locations || (owner.columns?.location ? [owner.columns.location] : []),
                source_url: sourceMetadata?.url || owner.source_url,
                confidence_score: owner.confidence_score || owner.confidence || 0.85,
                lead_id: owner.lead_id
            };

            const result = await this.promoteOwner(
                normalizedOwner,
                sourceMetadata,
                confirmationChannel,
                extractionId
            );

            if (result.success) {
                promoted++;
            } else if (result.reason?.includes('confidence') || result.reason?.includes('Not')) {
                skipped++;
            } else {
                errors++;
            }
        }

        console.log(`\n📊 Promotion Summary:`);
        console.log(`    ✓ Promoted: ${promoted}`);
        console.log(`    ⏭️  Skipped: ${skipped}`);
        console.log(`    ✗ Errors: ${errors}`);

        return { promoted, skipped, errors };
    }

    /**
     * Manually promote a specific unconfirmed person by lead ID
     */
    async promoteById(leadId, confirmationChannel, verifiedBy = 'manual') {
        if (!confirmationChannel) {
            return {
                success: false,
                reason: 'Confirmatory channel is required',
                hint: 'Available channels: ' + Object.keys(this.confirmatoryChannels).join(', ')
            };
        }

        try {
            const result = await this.db.query(`
                SELECT * FROM unconfirmed_persons WHERE lead_id = $1
            `, [leadId]);

            if (result.rows.length === 0) {
                return { success: false, reason: 'Lead not found' };
            }

            const person = result.rows[0];

            const sourceMetadata = {
                url: person.source_url,
                documentType: person.document_type || 'unknown'
            };

            const promotionResult = await this.promoteOwner(
                person,
                sourceMetadata,
                confirmationChannel
            );

            if (promotionResult.success) {
                // Update the unconfirmed_persons record
                await this.db.query(`
                    UPDATE unconfirmed_persons
                    SET status = 'promoted',
                        reviewed_at = CURRENT_TIMESTAMP,
                        reviewed_by = $2
                    WHERE lead_id = $1
                `, [leadId, verifiedBy]);
            }

            return promotionResult;

        } catch (error) {
            return { success: false, reason: error.message };
        }
    }

    /**
     * Get promotion statistics
     */
    async getStats() {
        try {
            const stats = await this.db.query(`
                SELECT
                    COUNT(*) FILTER (WHERE verification_status = 'promoted') as promoted_count,
                    COUNT(*) FILTER (WHERE assertable_slaveowner OR assertable_enslaved) as assertable_count,
                    COUNT(*) as total_canonical
                FROM canonical_persons
            `);

            const recentPromotions = await this.db.query(`
                SELECT COUNT(*) as count
                FROM promotion_log
                WHERE promoted_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
            `).catch(() => ({ rows: [{ count: 0 }] }));

            return {
                totalCanonical: parseInt(stats.rows[0]?.total_canonical || 0),
                promotedCount: parseInt(stats.rows[0]?.promoted_count || 0),
                assertableCount: parseInt(stats.rows[0]?.assertable_count || 0),
                promotedLast24h: parseInt(recentPromotions.rows[0]?.count || 0),
                availableChannels: Object.keys(this.confirmatoryChannels)
            };
        } catch (error) {
            return {
                totalCanonical: 0,
                promotedCount: 0,
                assertableCount: 0,
                promotedLast24h: 0,
                availableChannels: Object.keys(this.confirmatoryChannels),
                error: error.message
            };
        }
    }
}

module.exports = OwnerPromotion;
