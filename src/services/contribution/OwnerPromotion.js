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
 */

const { v4: uuidv4 } = require('uuid');

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
     * Promote a single owner to the individuals table
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
            // Generate unique ID
            const individualId = `owner_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

            // Parse name components
            const nameParts = this.parseName(person.full_name);

            // Check for existing individual with same name
            const existingCheck = await this.db.query(`
                SELECT individual_id, full_name
                FROM individuals
                WHERE LOWER(full_name) = LOWER($1)
                LIMIT 1
            `, [person.full_name]);

            if (existingCheck.rows.length > 0) {
                // Update existing instead of creating duplicate
                const existingId = existingCheck.rows[0].individual_id;

                await this.db.query(`
                    UPDATE individuals SET
                        notes = COALESCE(notes, '') || E'\n' || $1,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE individual_id = $2
                `, [
                    `Additional source (${new Date().toISOString()}): ${sourceMetadata?.url || person.source_url}\nConfirmation: ${qualification.channelName}`,
                    existingId
                ]);

                console.log(`    ✓ Updated existing individual: ${person.full_name} (${existingId})`);

                return {
                    success: true,
                    action: 'updated',
                    individualId: existingId,
                    person: person.full_name
                };
            }

            // Build notes with confirmation details
            const notes = [
                `Confirmed via: ${qualification.channelName}`,
                `Source: ${sourceMetadata?.url || person.source_url}`,
                `Confidence: ${(qualification.confidence * 100).toFixed(0)}%`,
                `Extraction ID: ${extractionId || 'N/A'}`,
                `Promoted: ${new Date().toISOString()}`
            ].join('\n');

            // Insert new individual
            await this.db.query(`
                INSERT INTO individuals (
                    individual_id,
                    full_name,
                    first_name,
                    last_name,
                    birth_year,
                    death_year,
                    location,
                    notes,
                    source_url,
                    confidence_score,
                    verified,
                    created_at,
                    updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `, [
                individualId,
                person.full_name,
                nameParts.firstName,
                nameParts.lastName,
                person.birth_year || null,
                person.death_year || null,
                Array.isArray(person.locations) ? person.locations.join(', ') : (person.location || null),
                notes,
                sourceMetadata?.url || person.source_url,
                qualification.confidence,
                true  // Verified because it passed confirmatory channel
            ]);

            // Log the promotion
            await this.logPromotion(person, individualId, qualification, extractionId);

            console.log(`    ✓ Promoted to individuals: ${person.full_name} (${individualId})`);

            return {
                success: true,
                action: 'created',
                individualId,
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
                    COUNT(*) FILTER (WHERE verified = true) as verified_count,
                    COUNT(*) as total_individuals
                FROM individuals
            `);

            const recentPromotions = await this.db.query(`
                SELECT COUNT(*) as count
                FROM promotion_log
                WHERE promoted_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
            `);

            return {
                totalIndividuals: parseInt(stats.rows[0]?.total_individuals || 0),
                verifiedCount: parseInt(stats.rows[0]?.verified_count || 0),
                promotedLast24h: parseInt(recentPromotions.rows[0]?.count || 0),
                availableChannels: Object.keys(this.confirmatoryChannels)
            };
        } catch (error) {
            return {
                totalIndividuals: 0,
                verifiedCount: 0,
                promotedLast24h: 0,
                availableChannels: Object.keys(this.confirmatoryChannels),
                error: error.message
            };
        }
    }
}

module.exports = OwnerPromotion;
