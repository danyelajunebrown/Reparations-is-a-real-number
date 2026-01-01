/**
 * WikiTree Descendant Scraper
 *
 * Scrapes descendants from WikiTree profiles of confirmed slave owners.
 * Works with the wikitree_search_queue to process found profiles.
 *
 * FLOW:
 * 1. wikitree-batch-search.js finds WikiTree profiles for enslavers
 * 2. This script scrapes descendants from those profiles
 * 3. Stores results in slave_owner_descendants_suspected
 *
 * Usage:
 *   node scripts/wikitree-descendant-scraper.js                    # Process queue
 *   node scripts/wikitree-descendant-scraper.js --test Hopewell-183 # Test single profile
 *   node scripts/wikitree-descendant-scraper.js --dry-run          # Preview without saving
 *   node scripts/wikitree-descendant-scraper.js --limit 10         # Process 10 profiles
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { neon } = require('@neondatabase/serverless');
const https = require('https');

const sql = neon(process.env.DATABASE_URL);

// Configuration
const CONFIG = {
    RATE_LIMIT_MS: 2000,          // 2 seconds between requests
    MAX_GENERATIONS: 8,            // Don't go beyond great-great-great-great-grandchildren
    MAX_DESCENDANTS_PER_PROFILE: 500, // Safety limit
    USER_AGENT: 'ReparationsResearch/1.0 (genealogy-research; contact@example.com)'
};

// Statistics
const stats = {
    profilesProcessed: 0,
    descendantsFound: 0,
    descendantsSaved: 0,
    errors: 0,
    startTime: Date.now()
};

/**
 * Fetch a URL and return the HTML content
 */
function fetchPage(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': CONFIG.USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                // Follow redirect
                fetchPage(res.headers.location).then(resolve).catch(reject);
                return;
            }

            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }

            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => resolve(data));
        });

        req.on('error', reject);
        req.setTimeout(15000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

/**
 * Parse a single WikiTree public profile page for children
 * Returns direct children only - caller should recurse for grandchildren
 */
async function scrapeProfileChildren(wikitreeId) {
    const url = `https://www.wikitree.com/wiki/${wikitreeId}`;

    const html = await fetchPage(url);

    // Check if profile exists
    if (html.includes('There is no WikiTree profile') || html.includes('This page does not exist')) {
        return { success: false, error: 'Profile not found', children: [] };
    }

    const children = [];

    // Parse children from schema.org markup
    // Format: <span itemprop="children" itemscope itemtype="https://schema.org/Person">
    //           <a href="/wiki/Hopewell-141" itemprop="url" title="..."><span itemprop="name">Name</span></a>
    //         </span>
    const childPattern = /<span\s+itemprop="children"[^>]*>.*?<a\s+href="\/wiki\/([^"]+)"[^>]*>.*?<span\s+itemprop="name">([^<]+)<\/span>/gi;

    let match;
    while ((match = childPattern.exec(html)) !== null) {
        const [, childId, name] = match;

        // Skip duplicates
        if (children.find(c => c.wikitreeId === childId)) continue;

        children.push({
            wikitreeId: childId,
            name: name.trim()
        });
    }

    // Also try to extract from the "Children" paragraph (backup method)
    if (children.length === 0) {
        const childrenSection = html.match(/id="Children"[^>]*>.*?<\/p>/is);
        if (childrenSection) {
            const linkPattern = /<a\s+href="\/wiki\/([A-Z][a-z]+-\d+)"[^>]*>([^<]+)<\/a>/gi;
            while ((match = linkPattern.exec(childrenSection[0])) !== null) {
                const [, childId, name] = match;
                if (!children.find(c => c.wikitreeId === childId)) {
                    children.push({
                        wikitreeId: childId,
                        name: name.trim()
                    });
                }
            }
        }
    }

    // Extract birth/death years from the profile for this person
    let birthYear = null;
    let deathYear = null;

    const datesMatch = html.match(/(?:born|b\.)\s*(?:about\s+)?(\d{4})/i);
    if (datesMatch) birthYear = parseInt(datesMatch[1]);

    const deathMatch = html.match(/(?:died|d\.)\s*(?:about\s+)?(\d{4})/i);
    if (deathMatch) deathYear = parseInt(deathMatch[1]);

    // Extract person name
    const nameMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
    const personName = nameMatch ? nameMatch[1].trim() : null;

    return {
        success: true,
        personName,
        birthYear,
        deathYear,
        children
    };
}

/**
 * Recursively scrape descendants using BFS
 * Scrapes public profile pages (no login required)
 */
async function scrapeDescendants(wikitreeId, maxGenerations = CONFIG.MAX_GENERATIONS) {
    console.log(`   Starting BFS from: ${wikitreeId}`);

    const allDescendants = [];
    const visited = new Set();
    const queue = [{ wikitreeId, generation: 0, parentName: null }];
    const generationCounts = {};

    let rootPerson = null;

    while (queue.length > 0 && allDescendants.length < CONFIG.MAX_DESCENDANTS_PER_PROFILE) {
        const { wikitreeId: currentId, generation, parentName } = queue.shift();

        // Skip if already visited
        if (visited.has(currentId)) continue;
        visited.add(currentId);

        // Stop at max generations
        if (generation > maxGenerations) continue;

        // Rate limit
        if (visited.size > 1) {
            await new Promise(r => setTimeout(r, CONFIG.RATE_LIMIT_MS));
        }

        try {
            const result = await scrapeProfileChildren(currentId);

            if (!result.success) {
                continue;
            }

            // Store root person info
            if (generation === 0) {
                rootPerson = result.personName;
                console.log(`   Root: ${rootPerson} (${result.birthYear || '?'}-${result.deathYear || '?'})`);
            }

            // Process children
            for (const child of result.children) {
                // Queue children for next generation
                queue.push({
                    wikitreeId: child.wikitreeId,
                    generation: generation + 1,
                    parentName: result.personName
                });

                // Don't add root person to descendants
                if (generation === 0) continue;

                // Calculate living probability
                const currentYear = new Date().getFullYear();
                let isLiving = true;
                let livingProbability = 0.5;

                if (result.deathYear) {
                    isLiving = false;
                    livingProbability = 0;
                } else if (result.birthYear) {
                    const age = currentYear - result.birthYear;
                    if (age > 110) {
                        isLiving = false;
                        livingProbability = 0;
                    } else if (age > 90) {
                        livingProbability = 0.1;
                    } else if (age > 70) {
                        livingProbability = 0.5;
                    } else if (age > 50) {
                        livingProbability = 0.85;
                    } else if (age > 0) {
                        livingProbability = 0.95;
                    }
                }

                // Add to descendants if not already there
                if (!allDescendants.find(d => d.wikitreeId === currentId)) {
                    allDescendants.push({
                        wikitreeId: currentId,
                        name: result.personName || currentId,
                        birthYear: result.birthYear,
                        deathYear: result.deathYear,
                        generation,
                        parentName,
                        isLiving,
                        livingProbability,
                        wikitreeUrl: `https://www.wikitree.com/wiki/${currentId}`
                    });

                    generationCounts[generation] = (generationCounts[generation] || 0) + 1;
                }
            }

            // Log progress
            if (visited.size % 5 === 0) {
                console.log(`   Visited ${visited.size} profiles, found ${allDescendants.length} descendants, queue: ${queue.length}`);
            }

        } catch (err) {
            // Continue on error
            console.log(`   ⚠️ Error fetching ${currentId}: ${err.message}`);
        }
    }

    console.log(`   Completed: ${allDescendants.length} descendants from ${visited.size} profiles`);

    return {
        success: true,
        rootPerson,
        descendants: allDescendants,
        generationCounts
    };
}

/**
 * Save descendants to the database
 */
async function saveDescendants(ownerInfo, descendants, dryRun = false) {
    if (dryRun) {
        console.log(`   [DRY RUN] Would save ${descendants.length} descendants`);
        return { saved: 0, skipped: descendants.length };
    }

    let saved = 0;
    let skipped = 0;

    for (const desc of descendants) {
        try {
            // Check if already exists
            const existing = await sql`
                SELECT id FROM slave_owner_descendants_suspected
                WHERE owner_individual_id = ${ownerInfo.personId}
                AND descendant_name = ${desc.name}
                AND (descendant_birth_year = ${desc.birthYear} OR descendant_birth_year IS NULL)
                LIMIT 1
            `;

            if (existing.length > 0) {
                skipped++;
                continue;
            }

            // Insert new descendant
            await sql`
                INSERT INTO slave_owner_descendants_suspected (
                    owner_individual_id,
                    owner_name,
                    owner_birth_year,
                    owner_death_year,
                    descendant_name,
                    descendant_birth_year,
                    descendant_death_year,
                    generation_from_owner,
                    is_living,
                    estimated_living_probability,
                    familysearch_person_id,
                    discovered_via,
                    discovery_date,
                    status,
                    confidence_score,
                    research_notes
                ) VALUES (
                    ${ownerInfo.personId},
                    ${ownerInfo.ownerName},
                    ${ownerInfo.birthYear},
                    ${ownerInfo.deathYear},
                    ${desc.name},
                    ${desc.birthYear},
                    ${desc.deathYear},
                    ${desc.generation || 1},
                    ${desc.isLiving},
                    ${desc.livingProbability},
                    ${desc.wikitreeId},
                    'wikitree_scraping',
                    CURRENT_DATE,
                    'suspected',
                    ${desc.livingProbability > 0.5 ? 0.7 : 0.8},
                    ${'WikiTree profile: ' + desc.wikitreeUrl}
                )
            `;
            saved++;

        } catch (err) {
            console.log(`   ⚠️ Error saving ${desc.name}: ${err.message}`);
        }
    }

    return { saved, skipped };
}

/**
 * Process profiles from the WikiTree search queue
 */
async function processQueue(limit = 50, dryRun = false) {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('   WIKITREE DESCENDANT SCRAPER');
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Get found profiles that haven't been scraped for descendants yet
    const profiles = await sql`
        SELECT
            wsq.id as queue_id,
            wsq.person_id,
            wsq.person_name,
            wsq.birth_year,
            wsq.death_year,
            wsq.wikitree_id,
            wsq.wikitree_url
        FROM wikitree_search_queue wsq
        WHERE wsq.status = 'found'
        AND wsq.wikitree_id IS NOT NULL
        AND NOT EXISTS (
            SELECT 1 FROM slave_owner_descendants_suspected sods
            WHERE sods.owner_individual_id = wsq.person_id::text
            AND sods.discovered_via = 'wikitree_scraping'
        )
        ORDER BY wsq.match_confidence DESC
        LIMIT ${limit}
    `;

    if (profiles.length === 0) {
        console.log('No profiles to process. Run wikitree-batch-search.js first.');

        // Show queue stats
        const queueStats = await sql`
            SELECT status, COUNT(*) as count
            FROM wikitree_search_queue
            GROUP BY status
        `;
        console.log('\nQueue Status:');
        for (const s of queueStats) {
            console.log(`  ${s.status}: ${s.count}`);
        }
        return;
    }

    console.log(`Found ${profiles.length} profiles to scrape for descendants\n`);

    for (const profile of profiles) {
        console.log(`\n📍 Processing: ${profile.person_name} (${profile.wikitree_id})`);

        try {
            const result = await scrapeDescendants(profile.wikitree_id);

            if (!result.success) {
                console.log(`   ❌ ${result.error}`);
                stats.errors++;
                continue;
            }

            stats.descendantsFound += result.descendants.length;

            // Filter to likely living descendants (for privacy, we track but don't expose)
            const livingDescendants = result.descendants.filter(d => d.livingProbability > 0);
            console.log(`   👥 ${result.descendants.length} total, ${livingDescendants.length} potentially living`);

            // Show generation breakdown
            if (result.generationCounts && Object.keys(result.generationCounts).length > 0) {
                const genStr = Object.entries(result.generationCounts)
                    .map(([g, c]) => `Gen ${g}: ${c}`)
                    .join(', ');
                console.log(`   📊 ${genStr}`);
            }

            // Save to database
            const ownerInfo = {
                personId: profile.person_id?.toString(),
                ownerName: profile.person_name,
                birthYear: profile.birth_year,
                deathYear: profile.death_year
            };

            const saveResult = await saveDescendants(ownerInfo, result.descendants, dryRun);
            console.log(`   💾 Saved: ${saveResult.saved}, Skipped: ${saveResult.skipped}`);

            stats.descendantsSaved += saveResult.saved;
            stats.profilesProcessed++;

            // Rate limit
            await new Promise(r => setTimeout(r, CONFIG.RATE_LIMIT_MS));

        } catch (err) {
            console.log(`   ❌ Error: ${err.message}`);
            stats.errors++;
        }
    }

    // Print summary
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('   SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`   Profiles processed: ${stats.profilesProcessed}`);
    console.log(`   Descendants found:  ${stats.descendantsFound}`);
    console.log(`   Descendants saved:  ${stats.descendantsSaved}`);
    console.log(`   Errors:             ${stats.errors}`);
    console.log(`   Duration:           ${((Date.now() - stats.startTime) / 1000).toFixed(1)}s`);
    console.log('═══════════════════════════════════════════════════════════════\n');
}

/**
 * Test scraping a single WikiTree profile
 */
async function testProfile(wikitreeId) {
    console.log(`\n🔍 Testing WikiTree profile: ${wikitreeId}\n`);

    const result = await scrapeDescendants(wikitreeId);

    if (!result.success) {
        console.log(`❌ ${result.error}`);
        return;
    }

    console.log(`✓ Root person: ${result.rootPerson}`);
    console.log(`✓ Found ${result.descendants.length} descendants\n`);

    // Show first 20 descendants
    console.log('Sample descendants:');
    for (const desc of result.descendants.slice(0, 20)) {
        const dates = desc.birthYear ?
            `(${desc.birthYear}${desc.deathYear ? '-' + desc.deathYear : ''})` :
            '';
        const living = desc.isLiving ? ' [likely living]' : '';
        const gen = desc.generation ? `Gen ${desc.generation}` : '';
        console.log(`  ${gen} ${desc.name} ${dates}${living}`);
    }

    if (result.descendants.length > 20) {
        console.log(`  ... and ${result.descendants.length - 20} more`);
    }

    // Generation breakdown
    if (result.generationCounts && Object.keys(result.generationCounts).length > 0) {
        console.log('\nGeneration breakdown:');
        for (const [gen, count] of Object.entries(result.generationCounts)) {
            console.log(`  Generation ${gen}: ${count} descendants`);
        }
    }

    // Living probability breakdown
    const livingCount = result.descendants.filter(d => d.livingProbability > 0.5).length;
    const maybeCount = result.descendants.filter(d => d.livingProbability > 0 && d.livingProbability <= 0.5).length;
    const deceasedCount = result.descendants.filter(d => d.livingProbability === 0).length;

    console.log('\nLiving status:');
    console.log(`  Likely living (>50%): ${livingCount}`);
    console.log(`  Possibly living:      ${maybeCount}`);
    console.log(`  Deceased:             ${deceasedCount}`);
}

/**
 * Main entry point
 */
async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--help')) {
        console.log(`
WikiTree Descendant Scraper

Usage:
  node scripts/wikitree-descendant-scraper.js                    # Process queue
  node scripts/wikitree-descendant-scraper.js --test Hopewell-183 # Test single profile
  node scripts/wikitree-descendant-scraper.js --dry-run          # Preview without saving
  node scripts/wikitree-descendant-scraper.js --limit 10         # Process 10 profiles

Options:
  --test <id>    Test scraping a single WikiTree profile
  --dry-run      Don't save to database
  --limit <n>    Limit number of profiles to process (default: 50)
  --help         Show this help message
`);
        return;
    }

    const testIdx = args.indexOf('--test');
    if (testIdx !== -1) {
        const wikitreeId = args[testIdx + 1];
        if (!wikitreeId) {
            console.error('Please provide a WikiTree ID, e.g., --test Hopewell-183');
            return;
        }
        await testProfile(wikitreeId);
        return;
    }

    const dryRun = args.includes('--dry-run');

    const limitIdx = args.indexOf('--limit');
    const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 50;

    await processQueue(limit, dryRun);
}

main().catch(console.error);
