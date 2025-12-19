#!/usr/bin/env node
/**
 * Civil War DC Petition Reprocessor
 *
 * Correctly identifies roles in DC Emancipation Compensation petitions:
 * - Petitioner = slaveholder/owner (filed claim for compensation)
 * - Enslaved = people described as negro, colored, African descent, slave
 * - Officials = justices, clerks, witnesses (should be filtered out)
 *
 * Document structure:
 * - "Petition of [NAME]" = OWNER
 * - "[NAME] a negro/colored man/woman" = ENSLAVED
 * - "Witness for Petitioner [NAME]" = OFFICIAL (filter)
 * - "Justice of the Peace [NAME]" = OFFICIAL (filter)
 * - "Sworn to...before me...[NAME]" = OFFICIAL (filter)
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL_REQUIRED === 'true' ? { rejectUnauthorized: false } : false
});

// Patterns for identifying roles
const PATTERNS = {
    // Petitioner/Owner patterns
    petitioner: [
        /petition\s+of\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?(?:[A-Z][a-z]+)?)/i,
        /your\s+petitioner\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?(?:[A-Z][a-z]+)?)/i,
        /petitioner['']?s?\s+claim/i,  // Context indicator
    ],

    // Enslaved person patterns - look for racial descriptors near names
    enslaved: [
        /([A-Z][a-z]+)\s+(?:a\s+)?(?:negro|colored|mulatto|black)\s+(?:man|woman|boy|girl|person)/i,
        /(?:negro|colored|mulatto)\s+(?:man|woman|boy|girl|person)\s+(?:named|called)\s+([A-Z][a-z]+)/i,
        /slave\s+(?:named|called)\s+([A-Z][a-z]+)/i,
        /person\s+of\s+African\s+des[ce]nt?\s+([A-Z][a-z]+)/i,
        /([A-Z][a-z]+)\s+a\s+slave\s+for\s+life/i,
        /service\s+or\s+labo[u]?r\s+of\s+(?:a\s+)?(?:person\s+)?(?:named\s+)?([A-Z][a-z]+)/i,
    ],

    // Official/Filter patterns - these people should NOT be in the database
    officials: [
        /witness\s+for\s+petitioner\s*[:\-]?\s*([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?(?:[A-Z][a-z]+)?)/i,
        /justice\s+of\s+the\s+peace\s*[:\-]?\s*([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?(?:[A-Z][a-z]+)?)/i,
        /sworn\s+to.*?before\s+me.*?([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?(?:[A-Z][a-z]+)?)/i,
        /\(signed\s+by\)\s*([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?(?:[A-Z][a-z]+)?)/i,
        /clerk\s*[:\-]?\s*([A-Z][a-z]+)/i,
        /notary\s+public/i,
    ],

    // Garbage patterns - things that are clearly not names
    garbage: [
        /^(filed|signed|note|witness|petition|petitioner|clk|seal)$/i,
        /^[A-Z]\.\s*$/,  // Just initials
        /\d{4}/,  // Contains year
        /^\d+$/,  // Just numbers
        /\n/,     // Contains newlines
    ]
};

class CivilWarDCReprocessor {
    constructor() {
        this.stats = {
            processed: 0,
            promotedOwner: 0,
            promotedEnslaved: 0,
            rejectedOfficial: 0,
            rejectedGarbage: 0,
            unchanged: 0,
            errors: 0
        };
    }

    async run() {
        console.log('🔄 Civil War DC Petition Reprocessor');
        console.log('='.repeat(60));
        console.log('Analyzing context to correctly identify roles...\n');

        try {
            // Get all needs_review CivilWarDC records
            const records = await pool.query(`
                SELECT lead_id, full_name, person_type, context_text, source_url
                FROM unconfirmed_persons
                WHERE source_url LIKE '%civilwardc.org%'
                  AND status = 'needs_review'
                ORDER BY lead_id
            `);

            console.log(`Found ${records.rows.length} records to reprocess\n`);

            for (const record of records.rows) {
                await this.processRecord(record);

                if (this.stats.processed % 1000 === 0) {
                    console.log(`Progress: ${this.stats.processed}/${records.rows.length}`);
                }
            }

            console.log('\n' + '='.repeat(60));
            console.log('REPROCESSING COMPLETE');
            console.log('='.repeat(60));
            this.printStats();

        } catch (error) {
            console.error('Fatal error:', error);
        } finally {
            await pool.end();
        }
    }

    async processRecord(record) {
        this.stats.processed++;
        const { lead_id, full_name, context_text } = record;

        // Skip if no context
        if (!context_text) {
            this.stats.unchanged++;
            return;
        }

        const name = full_name.trim();
        const context = context_text.toLowerCase();
        const nameInContext = context.includes(name.toLowerCase());

        // Check for garbage first
        if (this.isGarbage(name)) {
            await this.rejectRecord(lead_id, 'Garbage: invalid name pattern');
            this.stats.rejectedGarbage++;
            return;
        }

        // Check if this person is an official (witness, clerk, JP)
        if (this.isOfficial(name, context_text)) {
            await this.rejectRecord(lead_id, 'Official: witness, clerk, or justice of the peace');
            this.stats.rejectedOfficial++;
            return;
        }

        // Check if this person is the petitioner (owner)
        if (this.isPetitioner(name, context_text)) {
            await this.promoteRecord(lead_id, 'owner', 'Identified as petitioner (slaveholder filing for compensation)');
            this.stats.promotedOwner++;
            return;
        }

        // Check if this person is enslaved
        if (this.isEnslaved(name, context_text)) {
            await this.promoteRecord(lead_id, 'enslaved', 'Identified as enslaved person (racial descriptor or service/labor context)');
            this.stats.promotedEnslaved++;
            return;
        }

        // If we can't determine, leave as needs_review
        this.stats.unchanged++;
    }

    isGarbage(name) {
        // Check garbage patterns
        for (const pattern of PATTERNS.garbage) {
            if (pattern.test(name)) return true;
        }

        // Check length
        if (name.length <= 2) return true;

        // Check for common garbage words
        const garbageWords = ['years', 'year', 'month', 'day', 'county', 'city', 'state',
            'peace', 'justice', 'witness', 'petition', 'petitioner', 'washington',
            'columbia', 'district', 'maryland', 'virginia', 'note', 'filed', 'signed',
            'secondly', 'firstly', 'thirdly', 'hereby', 'thereof', 'therein'];
        if (garbageWords.includes(name.toLowerCase())) return true;

        return false;
    }

    isOfficial(name, context) {
        const nameLower = name.toLowerCase();
        const contextLower = context.toLowerCase();

        // Check if name appears near official indicators
        const officialIndicators = [
            'witness for petitioner',
            'justice of the peace',
            'sworn to and subscribed before me',
            'notary public',
            'clk',
            'clerk'
        ];

        for (const indicator of officialIndicators) {
            const idx = contextLower.indexOf(indicator);
            if (idx !== -1) {
                // Check if name appears within 100 chars after the indicator
                const afterIndicator = contextLower.substring(idx, idx + 150);
                if (afterIndicator.includes(nameLower)) {
                    return true;
                }
            }
        }

        // Check pattern matches
        for (const pattern of PATTERNS.officials) {
            const match = context.match(pattern);
            if (match && match[1] && match[1].toLowerCase().includes(nameLower.split(' ')[0].toLowerCase())) {
                return true;
            }
        }

        return false;
    }

    isPetitioner(name, context) {
        const nameLower = name.toLowerCase();
        const contextLower = context.toLowerCase();

        // Check if "Petition of [NAME]" pattern
        const petitionOfMatch = context.match(/petition\s+of\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?(?:[A-Z][a-z]+)?)/i);
        if (petitionOfMatch) {
            const petitionerName = petitionOfMatch[1].toLowerCase();
            if (nameLower.includes(petitionerName.split(' ')[0]) ||
                petitionerName.includes(nameLower.split(' ')[0])) {
                return true;
            }
        }

        // Check "your petitioner [NAME]" pattern
        const yourPetitionerMatch = context.match(/your\s+petitioner\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?(?:[A-Z][a-z]+)?)/i);
        if (yourPetitionerMatch) {
            const petitionerName = yourPetitionerMatch[1].toLowerCase();
            if (nameLower.includes(petitionerName.split(' ')[0]) ||
                petitionerName.includes(nameLower.split(' ')[0])) {
                return true;
            }
        }

        // Check if context mentions "petitioner's claim" and name appears as signature
        if (contextLower.includes("petitioner's claim") || contextLower.includes("your petitioner")) {
            // Look for name in signature context
            const sigMatch = context.match(/\(signed\s+by\)\s*([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?(?:[A-Z][a-z]+)?)/i);
            if (sigMatch && sigMatch[1].toLowerCase().includes(nameLower.split(' ')[0])) {
                return true;
            }
        }

        return false;
    }

    isEnslaved(name, context) {
        const nameLower = name.toLowerCase();
        const contextLower = context.toLowerCase();

        // Check for racial descriptors near the name
        const enslavedIndicators = [
            'negro man', 'negro woman', 'negro boy', 'negro girl',
            'colored man', 'colored woman', 'colored boy', 'colored girl',
            'mulatto', 'black man', 'black woman',
            'person of african des', 'african descent',
            'slave named', 'slave called', 'slave for life',
            'service or labor of', 'service or labour of'
        ];

        for (const indicator of enslavedIndicators) {
            const idx = contextLower.indexOf(indicator);
            if (idx !== -1) {
                // Check if name appears within 100 chars of the indicator
                const nearIndicator = contextLower.substring(Math.max(0, idx - 50), idx + 150);
                if (nearIndicator.includes(nameLower.split(' ')[0].toLowerCase())) {
                    return true;
                }
            }
        }

        // Check pattern matches
        for (const pattern of PATTERNS.enslaved) {
            const match = context.match(pattern);
            if (match) {
                const matchedName = match[1]?.toLowerCase() || '';
                if (matchedName && (nameLower.includes(matchedName) || matchedName.includes(nameLower.split(' ')[0]))) {
                    return true;
                }
            }
        }

        return false;
    }

    async promoteRecord(leadId, personType, reason) {
        try {
            await pool.query(`
                UPDATE unconfirmed_persons
                SET
                    status = 'pending',
                    person_type = $1,
                    confidence_score = 0.75,
                    review_notes = $2,
                    updated_at = CURRENT_TIMESTAMP
                WHERE lead_id = $3
            `, [personType, reason, leadId]);
        } catch (error) {
            console.error(`Error promoting ${leadId}:`, error.message);
            this.stats.errors++;
        }
    }

    async rejectRecord(leadId, reason) {
        try {
            await pool.query(`
                UPDATE unconfirmed_persons
                SET
                    status = 'rejected',
                    rejection_reason = $1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE lead_id = $2
            `, [reason, leadId]);
        } catch (error) {
            console.error(`Error rejecting ${leadId}:`, error.message);
            this.stats.errors++;
        }
    }

    printStats() {
        console.log(`Records Processed:    ${this.stats.processed}`);
        console.log(`Promoted as Owner:    ${this.stats.promotedOwner}`);
        console.log(`Promoted as Enslaved: ${this.stats.promotedEnslaved}`);
        console.log(`Rejected (Officials): ${this.stats.rejectedOfficial}`);
        console.log(`Rejected (Garbage):   ${this.stats.rejectedGarbage}`);
        console.log(`Unchanged:            ${this.stats.unchanged}`);
        console.log(`Errors:               ${this.stats.errors}`);
        console.log('');
        console.log(`Total Promoted: ${this.stats.promotedOwner + this.stats.promotedEnslaved}`);
        console.log(`Total Rejected: ${this.stats.rejectedOfficial + this.stats.rejectedGarbage}`);
    }
}

// Run
const reprocessor = new CivilWarDCReprocessor();
reprocessor.run().catch(console.error);
