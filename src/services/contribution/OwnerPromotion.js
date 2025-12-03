/**
 * OwnerPromotion - Auto-promote slave owners from federal documents
 *
 * This service handles the promotion of slave owners extracted from
 * PRIMARY federal/government sources to the confirmed `individuals` table.
 *
 * Promotion criteria:
 * 1. Source must be a FEDERAL/GOVERNMENT document (census, petition, court record, etc.)
 * 2. Person type must be 'owner' or 'slaveholder'
 * 3. Confidence score >= 0.85 OR human-verified
 * 4. Name must be parseable (not just "illegible" or "unknown")
 *
 * Federal document domains that trigger auto-promotion:
 * - msa.maryland.gov (Maryland State Archives)
 * - archives.gov (National Archives)
 * - loc.gov (Library of Congress)
 * - civilwardc.org (DC Emancipation Petitions)
 * - familysearch.org/ark (when linked to federal records)
 * - ancestry.com (when viewing census/federal records)
 * - fold3.com (military/federal records)
 * - Any .gov domain
 */

const { v4: uuidv4 } = require('uuid');

class OwnerPromotion {
    constructor(database) {
        this.db = database;

        // Federal/government domains that qualify for auto-promotion
        this.federalDomains = [
            'msa.maryland.gov',
            'archives.gov',
            'nara.gov',
            'loc.gov',
            'civilwardc.org',
            'fold3.com',
            'accessgenealogy.com',
            // State archives
            'virginiamemory.com',
            'digital.ncdcr.gov',
            'sos.ga.gov',
            'mdhistory.msa.maryland.gov',
            // Any .gov domain is federal
        ];

        // Document types that are federal/primary sources
        this.federalDocumentTypes = [
            'slave_schedule',
            'census',
            'compensation_petition',
            'emancipation_petition',
            'court_record',
            'tax_record',
            'slave_manifest',
            'military_record',
            'pension_record',
            'land_grant',
            'freedmens_bureau'
        ];

        // Minimum confidence for auto-promotion (without human verification)
        this.autoPromoteThreshold = 0.90;

        // Minimum confidence for promotion with human verification
        this.humanVerifiedThreshold = 0.70;
    }

    /**
     * Check if a source URL qualifies as a federal document
     */
    isFederalSource(url, documentType = null) {
        if (!url) return false;

        const lowerUrl = url.toLowerCase();

        // Any .gov domain is federal
        if (lowerUrl.includes('.gov')) {
            return true;
        }

        // Check known federal domains
        for (const domain of this.federalDomains) {
            if (lowerUrl.includes(domain)) {
                return true;
            }
        }

        // Check document type
        if (documentType && this.federalDocumentTypes.includes(documentType.toLowerCase())) {
            return true;
        }

        return false;
    }

    /**
     * Check if a person qualifies for promotion
     */
    qualifiesForPromotion(person, sourceMetadata, humanVerified = false) {
        // Must be an owner type
        if (!['owner', 'slaveholder', 'slave_owner'].includes(person.person_type?.toLowerCase())) {
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

        // Must be from federal source
        const isFederal = this.isFederalSource(
            sourceMetadata?.url || person.source_url,
            sourceMetadata?.documentType || person.document_type
        );

        if (!isFederal) {
            return { qualifies: false, reason: 'Not a federal/government source' };
        }

        // Check confidence threshold
        const confidence = parseFloat(person.confidence_score) || 0;

        if (humanVerified && confidence >= this.humanVerifiedThreshold) {
            return {
                qualifies: true,
                reason: 'Human-verified federal document owner',
                confidence,
                promotionType: 'human_verified'
            };
        }

        if (confidence >= this.autoPromoteThreshold) {
            return {
                qualifies: true,
                reason: 'High-confidence federal document owner',
                confidence,
                promotionType: 'auto_high_confidence'
            };
        }

        return {
            qualifies: false,
            reason: `Confidence ${(confidence * 100).toFixed(0)}% below threshold`,
            confidence
        };
    }

    /**
     * Promote a single owner to the individuals table
     */
    async promoteOwner(person, sourceMetadata, extractionId = null) {
        const qualification = this.qualifiesForPromotion(
            person,
            sourceMetadata,
            person.human_verified || false
        );

        if (!qualification.qualifies) {
            console.log(`    ⚠️  Skipping ${person.full_name}: ${qualification.reason}`);
            return {
                success: false,
                reason: qualification.reason,
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
                    `Additional source: ${sourceMetadata?.url || person.source_url} (${new Date().toISOString()})`,
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
                    source_type,
                    source_url,
                    confidence_score,
                    verified,
                    created_at,
                    updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `, [
                individualId,
                person.full_name,
                nameParts.firstName,
                nameParts.lastName,
                person.birth_year || null,
                person.death_year || null,
                Array.isArray(person.locations) ? person.locations.join(', ') : (person.location || null),
                `Auto-promoted from federal document.\nSource: ${sourceMetadata?.url || person.source_url}\nDocument Type: ${sourceMetadata?.documentType || 'federal_record'}\nPromotion: ${qualification.promotionType}\nConfidence: ${(qualification.confidence * 100).toFixed(0)}%\nExtraction ID: ${extractionId || 'N/A'}`,
                'primary',
                sourceMetadata?.url || person.source_url,
                qualification.confidence,
                qualification.promotionType === 'human_verified'
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
                promotionType: qualification.promotionType
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
                    original_lead_id,
                    extraction_id,
                    full_name,
                    source_url,
                    confidence_score,
                    promotion_type,
                    promotion_reason,
                    promoted_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
            `, [
                individualId,
                person.lead_id || null,
                extractionId,
                person.full_name,
                person.source_url,
                qualification.confidence,
                qualification.promotionType,
                qualification.reason
            ]);
        } catch (error) {
            // Log table might not exist yet - that's okay
            console.log(`    (Promotion log skipped: ${error.message})`);
        }
    }

    /**
     * Batch promote owners from an extraction job
     */
    async promoteFromExtraction(extractionId, sourceMetadata) {
        console.log(`\n📍 Auto-promoting federal document owners from extraction ${extractionId}`);

        // Check if this is a federal source
        if (!this.isFederalSource(sourceMetadata?.url, sourceMetadata?.documentType)) {
            console.log(`    ⚠️  Not a federal source - skipping auto-promotion`);
            return { promoted: 0, skipped: 0, errors: 0 };
        }

        console.log(`    ✓ Federal source confirmed: ${sourceMetadata?.url}`);

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

        // Also check unconfirmed_persons linked to this session
        try {
            const unconfirmedResult = await this.db.query(`
                SELECT * FROM unconfirmed_persons
                WHERE source_url = $1
                AND person_type IN ('owner', 'slaveholder')
            `, [sourceMetadata?.url]);

            if (unconfirmedResult.rows.length > 0) {
                persons = [...persons, ...unconfirmedResult.rows];
            }
        } catch (error) {
            // Table might not exist
            console.log(`    (unconfirmed_persons check skipped)`);
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
                human_verified: owner.human_verified || owner.corrected || false,
                lead_id: owner.lead_id
            };

            const result = await this.promoteOwner(normalizedOwner, sourceMetadata, extractionId);

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
     * Manually promote a specific unconfirmed person
     */
    async promoteById(leadId, verifiedBy = 'manual') {
        try {
            const result = await this.db.query(`
                SELECT * FROM unconfirmed_persons WHERE lead_id = $1
            `, [leadId]);

            if (result.rows.length === 0) {
                return { success: false, reason: 'Lead not found' };
            }

            const person = result.rows[0];
            person.human_verified = true;

            const sourceMetadata = {
                url: person.source_url,
                documentType: person.document_type || 'federal_record'
            };

            const promotionResult = await this.promoteOwner(person, sourceMetadata);

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
                    COUNT(*) FILTER (WHERE source_type = 'primary') as primary_source_count,
                    COUNT(*) FILTER (WHERE verified = true) as verified_count,
                    COUNT(*) as total_individuals
                FROM individuals
            `);

            const recentPromotions = await this.db.query(`
                SELECT COUNT(*) as count
                FROM individuals
                WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
                AND notes LIKE '%Auto-promoted%'
            `);

            return {
                totalIndividuals: parseInt(stats.rows[0]?.total_individuals || 0),
                primarySourceCount: parseInt(stats.rows[0]?.primary_source_count || 0),
                verifiedCount: parseInt(stats.rows[0]?.verified_count || 0),
                promotedLast24h: parseInt(recentPromotions.rows[0]?.count || 0)
            };
        } catch (error) {
            return {
                totalIndividuals: 0,
                primarySourceCount: 0,
                verifiedCount: 0,
                promotedLast24h: 0,
                error: error.message
            };
        }
    }
}

module.exports = OwnerPromotion;
