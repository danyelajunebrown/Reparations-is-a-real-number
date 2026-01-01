#!/usr/bin/env node
/**
 * Civil War DC Genealogical Extraction
 *
 * Extracts FULL genealogical data from DC Emancipation petitions:
 * - Petitioner (slaveholder) with location
 * - All enslaved persons with demographics (age, sex, color, height, skills)
 * - Family relationships among enslaved (parent/child)
 * - Inheritance chain (wills, previous owners, how acquired)
 * - Valuations
 * - Previous owners from wills/inheritance
 *
 * Usage:
 *   node scripts/extract-civilwardc-genealogy.js [--limit 10] [--dry-run]
 */

require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('neon') ? { rejectUnauthorized: false } : false
});

// Stats
const stats = {
    petitionsProcessed: 0,
    petitionersExtracted: 0,
    enslavedExtracted: 0,
    inheritanceChainsFound: 0,
    familyRelationshipsFound: 0,
    previousOwnersFound: 0,
    errors: 0
};

/**
 * Fetch and parse a petition page
 * The HTML is semantically marked up with:
 * - <span class="persName"> for person names
 * - <span class="placeName"> for places
 * - <span class="handwritten"> for handwritten text
 */
async function fetchPetition(url) {
    try {
        const response = await axios.get(url, {
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Reparations Research Project)'
            }
        });

        const $ = cheerio.load(response.data);

        // Extract all person names using semantic markup
        const personNames = [];
        $('span.persName').each((i, el) => {
            const name = $(el).text().trim();
            if (name && name.length > 2) {
                personNames.push(name);
            }
        });

        // Extract all place names
        const placeNames = [];
        $('span.placeName').each((i, el) => {
            const place = $(el).text().trim();
            if (place) placeNames.push(place);
        });

        // Get full text for context analysis
        const text = $('body').text()
            .replace(/\s+/g, ' ')
            .replace(/\n+/g, '\n')
            .trim();

        // Get petition section specifically
        const petitionText = $('.petition').text() || '';

        // Get handwritten content (often contains the actual data)
        const handwrittenText = $('span.handwritten').map((i, el) => $(el).text()).get().join(' ');

        return {
            text,
            petitionText,
            handwrittenText,
            personNames,
            placeNames,
            html: response.data,
            $,
            url
        };
    } catch (error) {
        console.error(`   ❌ Fetch error for ${url}: ${error.message}`);
        stats.errors++;
        return null;
    }
}

/**
 * Extract petitioner (slaveholder) information
 */
function extractPetitioner(text) {
    const petitioner = {
        name: null,
        location: null,
        role: 'slaveholder'
    };

    // Pattern: "Petition of [NAME]" or "To the Commissioners... [NAME]"
    const patterns = [
        /petition\s+of\s+([A-Z][a-zA-Z]+(?:\s+[A-Z]\.?\s*)?(?:[A-Z][a-zA-Z]+)?(?:\s+[A-Z][a-zA-Z]+)?)/i,
        /your\s+petitioner[,\s]+([A-Z][a-zA-Z]+(?:\s+[A-Z]\.?\s*)?(?:[A-Z][a-zA-Z]+)?)/i,
        /petitioner\s+([A-Z][a-zA-Z]+(?:\s+[A-Z]\.?\s*)?(?:[A-Z][a-zA-Z]+)?)\s+of/i
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            petitioner.name = match[1].trim();
            break;
        }
    }

    // Extract location
    const locationPatterns = [
        /of\s+(Washington\s+City|Georgetown|Washington\s+County|District\s+of\s+Columbia)/i,
        /residing\s+in\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/i,
        /of\s+the\s+city\s+of\s+([A-Z][a-zA-Z]+)/i
    ];

    for (const pattern of locationPatterns) {
        const match = text.match(pattern);
        if (match) {
            petitioner.location = match[1].trim();
            break;
        }
    }

    return petitioner;
}

/**
 * Extract enslaved persons with demographics
 */
function extractEnslavedPersons(text) {
    const enslaved = [];

    // Pattern for enslaved person descriptions
    // e.g., "Mary Lucy Brown, age 17" or "Susan Brown, a negro woman about 55 years"
    const patterns = [
        // Name with age: "Mary Lucy Brown, age 17"
        /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})[,\s]+(?:aged?|age)\s+(\d+)/gi,

        // Name with racial descriptor: "Susan Brown, a negro woman"
        /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})[,\s]+(?:a\s+)?(negro|colored|mulatto|black)\s+(man|woman|boy|girl)/gi,

        // Name followed by description in parentheses or dashes
        /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\s*[-–—]\s*(?:aged?\s+)?(\d+)/gi
    ];

    const foundNames = new Set();

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const name = match[1].trim();

            // Skip if already found or if it's a common non-name
            if (foundNames.has(name.toLowerCase())) continue;
            if (isNotAName(name)) continue;

            foundNames.add(name.toLowerCase());

            const person = {
                name: name,
                age: null,
                sex: null,
                color: null,
                height: null,
                skills: null,
                role: 'enslaved'
            };

            // Try to extract additional details from surrounding text
            const surroundingText = getSurroundingText(text, match.index, 200);

            // Age
            const ageMatch = surroundingText.match(/aged?\s+(\d+)|(\d+)\s+years?\s+old|about\s+(\d+)/i);
            if (ageMatch) {
                person.age = parseInt(ageMatch[1] || ageMatch[2] || ageMatch[3]);
            }

            // Sex
            if (/\b(woman|female|girl|mother|daughter)\b/i.test(surroundingText)) {
                person.sex = 'female';
            } else if (/\b(man|male|boy|father|son)\b/i.test(surroundingText)) {
                person.sex = 'male';
            }

            // Color/complexion
            const colorMatch = surroundingText.match(/\b(negro|black|mulatto|colored|bright|dark|copper|light)\s*(complexion|color)?/i);
            if (colorMatch) {
                person.color = colorMatch[1].toLowerCase();
            }

            // Height
            const heightMatch = surroundingText.match(/(\d)\s*feet?\s*,?\s*(\d+)?\s*(?:inches?|in\.?)?/i);
            if (heightMatch) {
                person.height = `${heightMatch[1]}'${heightMatch[2] || '0'}"`;
            }

            // Skills
            const skillPatterns = [
                /good\s+(cook|servant|waiter|nurse|laundress|seamstress|house\s+servant)/i,
                /first[- ]rate\s+(\w+)/i,
                /excellent\s+(\w+(?:\s+\w+)?)/i,
                /(cook|waiter|servant|nurse|laundress|seamstress|field\s+hand|ostler)/i
            ];
            for (const sp of skillPatterns) {
                const skillMatch = surroundingText.match(sp);
                if (skillMatch) {
                    person.skills = skillMatch[0].trim();
                    break;
                }
            }

            enslaved.push(person);
        }
    }

    return enslaved;
}

/**
 * Extract family relationships among enslaved
 */
function extractFamilyRelationships(text, enslavedPersons) {
    const relationships = [];

    // Patterns for family relationships
    // e.g., "Lewis Carter... Mary's child" or "child of Mary"
    const patterns = [
        /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)'s\s+(child|son|daughter|mother|father)/gi,
        /(child|son|daughter)\s+of\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi,
        /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:is|was)\s+(?:the\s+)?(mother|father)\s+of/gi,
        /born\s+(?:to|of)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const rel = {
                person1: null,
                person2: null,
                relationship: null
            };

            if (pattern.source.includes("'s")) {
                rel.person1 = match[1];
                rel.relationship = match[2].toLowerCase();
                rel.person2 = 'parent'; // person1 is parent
            } else if (pattern.source.includes('child|son|daughter')) {
                rel.person2 = match[2];
                rel.relationship = match[1].toLowerCase();
                rel.person1 = 'child'; // person2 is parent
            }

            if (rel.person1 && rel.person2) {
                relationships.push(rel);
            }
        }
    }

    return relationships;
}

/**
 * Extract inheritance chain and previous owners
 */
function extractInheritanceChain(text) {
    const inheritance = {
        method: null, // 'will', 'purchase', 'inheritance', 'marriage', 'gift'
        previousOwners: [],
        wills: [],
        details: null
    };

    // Check acquisition method
    if (/will\s+(?:of|and\s+testament)/i.test(text) || /bequeath/i.test(text)) {
        inheritance.method = 'will';
    } else if (/purchas/i.test(text) || /bought/i.test(text)) {
        inheritance.method = 'purchase';
    } else if (/marriage|married|wife|husband/i.test(text)) {
        inheritance.method = 'marriage';
    } else if (/inherit/i.test(text)) {
        inheritance.method = 'inheritance';
    } else if (/gift|given/i.test(text)) {
        inheritance.method = 'gift';
    }

    // Extract will information
    const willPatterns = [
        /will\s+(?:of|and\s+testament\s+of)\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?(?:[A-Z][a-z]+)?)/gi,
        /bequeath(?:ed)?\s+(?:to\s+)?(?:.*?)\s+by\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?(?:[A-Z][a-z]+)?)/gi,
        /(?:late|deceased)\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?(?:[A-Z][a-z]+)?)/gi
    ];

    for (const pattern of willPatterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const name = match[1].trim();
            if (!isNotAName(name) && !inheritance.previousOwners.includes(name)) {
                inheritance.previousOwners.push(name);
            }
        }
    }

    // Extract previous owners mentioned
    const ownerPatterns = [
        /(?:mother|father|grandmother|grandfather|sister|brother|uncle|aunt|wife|husband)\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?(?:[A-Z][a-z]+)?)/gi,
        /(?:belonged|belonging)\s+to\s+(?:the\s+)?(?:family\s+of\s+)?([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?(?:[A-Z][a-z]+)?)/gi,
        /(?:held\s+by|owned\s+by|property\s+of)\s+([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?(?:[A-Z][a-z]+)?)/gi
    ];

    for (const pattern of ownerPatterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const name = match[1].trim();
            if (!isNotAName(name) && !inheritance.previousOwners.includes(name)) {
                inheritance.previousOwners.push(name);
            }
        }
    }

    // Extract details about inheritance
    const detailPatterns = [
        /will\s+(?:of|and\s+testament)[^.]+\./i,
        /bequeath[^.]+\./i,
        /inherit[^.]+\./i
    ];

    for (const pattern of detailPatterns) {
        const match = text.match(pattern);
        if (match) {
            inheritance.details = match[0].trim();
            break;
        }
    }

    return inheritance;
}

/**
 * Extract valuations
 */
function extractValuations(text) {
    const valuations = {
        total: null,
        individual: []
    };

    // Total valuation
    const totalPatterns = [
        /(?:total|sum|amount)[^$]*\$\s*([\d,]+)/i,
        /valued?\s+(?:at|claim)\s+\$\s*([\d,]+)/i,
        /\$\s*([\d,]+)\s*(?:total|in\s+all)/i
    ];

    for (const pattern of totalPatterns) {
        const match = text.match(pattern);
        if (match) {
            valuations.total = parseFloat(match[1].replace(/,/g, ''));
            break;
        }
    }

    // Individual valuations - "Mary at $600"
    const individualPattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)[^$]*\$\s*([\d,]+)/gi;
    let match;
    while ((match = individualPattern.exec(text)) !== null) {
        const name = match[1].trim();
        if (!isNotAName(name)) {
            valuations.individual.push({
                name: name,
                value: parseFloat(match[2].replace(/,/g, ''))
            });
        }
    }

    return valuations;
}

/**
 * Helper: check if string is not a name
 */
function isNotAName(str) {
    const nonNames = [
        'petition', 'petitioner', 'witness', 'justice', 'peace', 'clerk',
        'county', 'city', 'state', 'district', 'columbia', 'washington',
        'maryland', 'virginia', 'georgia', 'congress', 'commissioners',
        'dollars', 'years', 'months', 'filed', 'signed', 'sworn',
        'april', 'may', 'june', 'july', 'august', 'september'
    ];
    return nonNames.includes(str.toLowerCase()) || str.length < 3;
}

/**
 * Helper: get surrounding text
 */
function getSurroundingText(text, index, range) {
    const start = Math.max(0, index - range);
    const end = Math.min(text.length, index + range);
    return text.substring(start, end);
}

/**
 * Store extracted data to database
 */
async function storeExtraction(petitionUrl, extraction, dryRun = false) {
    if (dryRun) {
        console.log('   [DRY RUN] Would store:', JSON.stringify(extraction, null, 2).substring(0, 500));
        return;
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Helper function to check if record exists
        async function recordExists(name, url) {
            const result = await client.query(
                'SELECT lead_id FROM unconfirmed_persons WHERE full_name = $1 AND source_url = $2 LIMIT 1',
                [name, url]
            );
            return result.rows.length > 0 ? result.rows[0].lead_id : null;
        }

        // Store petitioner
        if (extraction.petitioner.name) {
            const existingId = await recordExists(extraction.petitioner.name, petitionUrl);
            if (existingId) {
                await client.query(`
                    UPDATE unconfirmed_persons SET
                        person_type = $1,
                        context_text = $2,
                        confidence_score = $3,
                        extraction_method = $4,
                        updated_at = NOW()
                    WHERE lead_id = $5
                `, [
                    'slaveholder',
                    `Petitioner (slaveholder) in DC Emancipation claim. Location: ${extraction.petitioner.location || 'DC'}`,
                    0.95,
                    'civilwardc_genealogy_v2',
                    existingId
                ]);
            } else {
                await client.query(`
                    INSERT INTO unconfirmed_persons (
                        full_name, person_type, source_url, context_text,
                        confidence_score, extraction_method, locations
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                `, [
                    extraction.petitioner.name,
                    'slaveholder',
                    petitionUrl,
                    `Petitioner (slaveholder) in DC Emancipation claim. Location: ${extraction.petitioner.location || 'DC'}`,
                    0.95,
                    'civilwardc_genealogy_v2',
                    extraction.petitioner.location ? [extraction.petitioner.location] : []
                ]);
            }
            stats.petitionersExtracted++;
        }

        // Store enslaved persons
        for (const person of extraction.enslaved) {
            const context = [
                person.name,
                person.age ? `age ${person.age}` : null,
                person.sex,
                person.color,
                person.skills,
                extraction.petitioner.name ? `Owner: ${extraction.petitioner.name}` : null
            ].filter(Boolean).join(' | ');

            const relationships = {
                owner: extraction.petitioner.name,
                age: person.age,
                sex: person.sex,
                color: person.color,
                height: person.height,
                skills: person.skills,
                acquisition_method: extraction.inheritance.method,
                previous_owners: extraction.inheritance.previousOwners
            };

            const existingId = await recordExists(person.name, petitionUrl);
            if (existingId) {
                await client.query(`
                    UPDATE unconfirmed_persons SET
                        person_type = $1,
                        context_text = $2,
                        confidence_score = $3,
                        extraction_method = $4,
                        gender = $5,
                        relationships = $6,
                        updated_at = NOW()
                    WHERE lead_id = $7
                `, [
                    'enslaved',
                    context,
                    0.90,
                    'civilwardc_genealogy_v2',
                    person.sex,
                    JSON.stringify(relationships),
                    existingId
                ]);
            } else {
                await client.query(`
                    INSERT INTO unconfirmed_persons (
                        full_name, person_type, source_url, context_text,
                        confidence_score, extraction_method, gender, relationships
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                `, [
                    person.name,
                    'enslaved',
                    petitionUrl,
                    context,
                    0.90,
                    'civilwardc_genealogy_v2',
                    person.sex,
                    JSON.stringify(relationships)
                ]);
            }
            stats.enslavedExtracted++;
        }

        // Store family relationships (skip if table doesn't exist or has issues)
        try {
            for (const rel of extraction.familyRelationships) {
                if (rel.person1 && rel.person2) {
                    await client.query(`
                        INSERT INTO family_relationships (
                            person1_name, person1_role,
                            person2_name, person2_role,
                            relationship_type, source_url
                        ) VALUES ($1, $2, $3, $4, $5, $6)
                    `, [
                        rel.person1,
                        'enslaved',
                        rel.person2 || 'unknown',
                        'enslaved',
                        rel.relationship,
                        petitionUrl
                    ]);
                    stats.familyRelationshipsFound++;
                }
            }
        } catch (e) {
            // Ignore family relationship errors
        }

        // Store previous owners as potential slaveholders
        for (const prevOwner of extraction.inheritance.previousOwners) {
            const existingId = await recordExists(prevOwner, petitionUrl);
            if (!existingId) {
                await client.query(`
                    INSERT INTO unconfirmed_persons (
                        full_name, person_type, source_url, context_text,
                        confidence_score, extraction_method
                    ) VALUES ($1, $2, $3, $4, $5, $6)
                `, [
                    prevOwner,
                    'slaveholder',
                    petitionUrl,
                    `Previous owner mentioned in inheritance chain. Method: ${extraction.inheritance.method || 'unknown'}`,
                    0.80,
                    'civilwardc_genealogy_v2'
                ]);
                stats.previousOwnersFound++;
            }
        }

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error(`   ❌ Store error: ${error.message}`);
        stats.errors++;
    } finally {
        client.release();
    }
}

/**
 * Process a single petition using semantic HTML markup
 */
async function processPetition(url, dryRun = false) {
    console.log(`\n📜 Processing: ${url}`);

    const petition = await fetchPetition(url);
    if (!petition) return null;

    // Use semantic personNames from HTML markup
    const allNames = petition.personNames;
    const text = petition.text;
    const handwritten = petition.handwrittenText;

    // First person mentioned is usually the petitioner
    // Look for pattern "Petition of [NAME]" or "Your Petitioner, [NAME]"
    let petitionerName = null;
    const petitionerMatch = text.match(/petition(?:er)?[,\s]+(?:of\s+)?([A-Z][a-zA-Z\s\.]+?)(?:\s+of\s+|\s+by\s+|,)/i);
    if (petitionerMatch) {
        petitionerName = petitionerMatch[1].trim();
    } else if (allNames.length > 0) {
        // First name is usually the petitioner
        petitionerName = allNames[0];
    }

    // Find location from placeNames
    const location = petition.placeNames.find(p =>
        /washington|georgetown|district|columbia/i.test(p)
    ) || petition.placeNames[0] || null;

    // Identify enslaved persons - names mentioned with racial descriptors or ages
    const enslaved = [];
    const enslavedNames = new Set(); // Track unique names
    const enslavedIndicators = /negro|colored|mulatto|african|slave|servant|service or labor/i;

    for (const name of allNames) {
        // Skip if this is the petitioner (case-insensitive)
        if (name.toLowerCase() === petitionerName?.toLowerCase()) continue;

        // Skip if already added
        if (enslavedNames.has(name.toLowerCase())) continue;

        // Skip common official names
        if (isNotAName(name)) continue;

        // Check if this name appears near enslaved indicators
        const nameIndex = text.toLowerCase().indexOf(name.toLowerCase());
        if (nameIndex === -1) continue;

        const surrounding = text.substring(Math.max(0, nameIndex - 100), nameIndex + name.length + 100).toLowerCase();

        // If near enslaved indicators, mark as enslaved
        if (enslavedIndicators.test(surrounding)) {
            const person = {
                name: name,
                age: null,
                sex: null,
                color: null,
                role: 'enslaved'
            };

            // Extract age
            const ageMatch = surrounding.match(/(\d+)\s*(?:years?|yrs?)/i);
            if (ageMatch) person.age = parseInt(ageMatch[1]);

            // Extract sex
            if (/\b(woman|female|girl|mother|daughter)\b/i.test(surrounding)) {
                person.sex = 'female';
            } else if (/\b(man|male|boy|father|son)\b/i.test(surrounding)) {
                person.sex = 'male';
            }

            // Extract color
            const colorMatch = surrounding.match(/\b(negro|black|mulatto|colored|bright|copper|light)\b/i);
            if (colorMatch) person.color = colorMatch[1].toLowerCase();

            enslaved.push(person);
            enslavedNames.add(name.toLowerCase());
        }
    }

    // Find previous owners - names in inheritance context
    const previousOwners = [];
    const inheritanceIndicators = /will|testament|bequeath|inherit|mother|father|deceased|late|owned by|belonged to/i;

    for (const name of allNames) {
        if (name === petitionerName) continue;
        if (enslaved.find(e => e.name === name)) continue;
        if (isNotAName(name)) continue;

        const nameIndex = text.toLowerCase().indexOf(name.toLowerCase());
        if (nameIndex === -1) continue;

        const surrounding = text.substring(Math.max(0, nameIndex - 150), nameIndex + name.length + 50).toLowerCase();

        if (inheritanceIndicators.test(surrounding) && !enslavedIndicators.test(surrounding)) {
            previousOwners.push(name);
        }
    }

    // Determine acquisition method
    let acquisitionMethod = null;
    if (/will|testament|bequeath/i.test(text)) acquisitionMethod = 'will';
    else if (/purchas|bought/i.test(text)) acquisitionMethod = 'purchase';
    else if (/marriage|married|wife|husband/i.test(text)) acquisitionMethod = 'marriage';
    else if (/inherit/i.test(text)) acquisitionMethod = 'inheritance';
    else if (/gift|given/i.test(text)) acquisitionMethod = 'gift';

    // Extract family relationships among enslaved
    const familyRelationships = [];
    const familyPattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)'s\s+(child|son|daughter|mother|father)/gi;
    let match;
    while ((match = familyPattern.exec(text)) !== null) {
        familyRelationships.push({
            person1: match[1],
            relationship: match[2].toLowerCase()
        });
    }

    // Also check "child of" pattern
    const childOfPattern = /(child|son|daughter)\s+of\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi;
    while ((match = childOfPattern.exec(text)) !== null) {
        familyRelationships.push({
            relationship: match[1].toLowerCase(),
            person2: match[2]
        });
    }

    const extraction = {
        petitioner: {
            name: petitionerName,
            location: location,
            role: 'slaveholder'
        },
        enslaved: enslaved,
        familyRelationships: familyRelationships,
        inheritance: {
            method: acquisitionMethod,
            previousOwners: [...new Set(previousOwners)], // dedupe
            details: null
        },
        valuations: extractValuations(text),
        allNamesFound: allNames.length
    };

    console.log(`   All names in HTML: ${allNames.length}`);
    console.log(`   Petitioner: ${extraction.petitioner.name || 'Unknown'}`);
    console.log(`   Enslaved: ${extraction.enslaved.length} persons`);
    if (extraction.enslaved.length > 0) {
        console.log(`      → ${extraction.enslaved.map(e => e.name).join(', ')}`);
    }
    console.log(`   Family relationships: ${extraction.familyRelationships.length}`);
    console.log(`   Previous owners: ${extraction.inheritance.previousOwners.length}`);
    if (extraction.inheritance.previousOwners.length > 0) {
        console.log(`      → ${extraction.inheritance.previousOwners.join(', ')}`);
    }
    console.log(`   Acquisition: ${extraction.inheritance.method || 'unknown'}`);

    if (extraction.inheritance.previousOwners.length > 0) {
        stats.inheritanceChainsFound++;
    }

    await storeExtraction(url, extraction, dryRun);
    stats.petitionsProcessed++;

    return extraction;
}

/**
 * Main function
 */
async function main() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('   CIVIL WAR DC GENEALOGICAL EXTRACTION');
    console.log('   Extracting full genealogical data from DC Emancipation petitions');
    console.log('═══════════════════════════════════════════════════════════════\n');

    const args = process.argv.slice(2);
    const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 100;
    const dryRun = args.includes('--dry-run');

    if (dryRun) {
        console.log('🏃 DRY RUN MODE - No data will be saved\n');
    }

    try {
        // Get unique petition URLs from database
        const result = await pool.query(`
            SELECT DISTINCT source_url
            FROM unconfirmed_persons
            WHERE source_url LIKE '%civilwardc.org/texts/petitions%'
            ORDER BY source_url
            LIMIT $1
        `, [limit]);

        console.log(`Found ${result.rows.length} petitions to process\n`);

        for (let i = 0; i < result.rows.length; i++) {
            const url = result.rows[i].source_url;
            console.log(`[${i + 1}/${result.rows.length}]`);

            await processPetition(url, dryRun);

            // Rate limiting
            await new Promise(r => setTimeout(r, 1000));
        }

    } catch (error) {
        console.error('Fatal error:', error);
    } finally {
        await pool.end();
    }

    // Print stats
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('   EXTRACTION COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`   Petitions processed:     ${stats.petitionsProcessed}`);
    console.log(`   Petitioners extracted:   ${stats.petitionersExtracted}`);
    console.log(`   Enslaved extracted:      ${stats.enslavedExtracted}`);
    console.log(`   Inheritance chains:      ${stats.inheritanceChainsFound}`);
    console.log(`   Family relationships:    ${stats.familyRelationshipsFound}`);
    console.log(`   Previous owners found:   ${stats.previousOwnersFound}`);
    console.log(`   Errors:                  ${stats.errors}`);
    console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
