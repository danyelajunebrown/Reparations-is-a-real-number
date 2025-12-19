/**
 * Promote Trackable Enslaved to Canonical Persons
 *
 * Criterion: Must have at least ONE family link (spouse, parent, or child)
 * This enables descendant tracking for reparations distribution
 *
 * Process:
 * 1. Find all unique people in family_relationships table
 * 2. Find corresponding records in unconfirmed_persons (enslaved type)
 * 3. Promote to canonical_persons if not already present
 */

const { Pool } = require('pg');
const config = require('../config');
const pool = new Pool(config.database);

async function getTrackablePeople() {
    // Get all unique names from family_relationships with their relationship details
    const result = await pool.query(`
        WITH family_people AS (
            SELECT person1_name as name, person1_role as role, relationship_type, source_url
            FROM family_relationships
            UNION ALL
            SELECT person2_name as name, person2_role as role, relationship_type, source_url
            FROM family_relationships
        )
        SELECT
            name,
            array_agg(DISTINCT role) as roles,
            array_agg(DISTINCT relationship_type) as relationship_types,
            MIN(source_url) as source_url,
            COUNT(*) as relationship_count
        FROM family_people
        GROUP BY name
        ORDER BY relationship_count DESC, name
    `);

    return result.rows;
}

async function findUnconfirmedPerson(name) {
    // Find matching unconfirmed_persons record
    const result = await pool.query(`
        SELECT
            lead_id,
            full_name,
            person_type,
            source_url,
            confidence_score,
            context_text
        FROM unconfirmed_persons
        WHERE full_name = $1
        AND person_type = 'enslaved'
        ORDER BY confidence_score DESC
        LIMIT 1
    `, [name]);

    return result.rows[0] || null;
}

async function isAlreadyCanonical(name) {
    const result = await pool.query(`
        SELECT id FROM canonical_persons
        WHERE canonical_name = $1
        LIMIT 1
    `, [name]);
    return result.rows.length > 0;
}

async function promoteToCanonical(person, familyDetails) {
    const result = await pool.query(`
        INSERT INTO canonical_persons (
            canonical_name,
            person_type,
            verification_status,
            confidence_score,
            notes,
            created_by
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
    `, [
        person.full_name,
        'enslaved',
        'family_verified',
        0.90,
        `Family trackable: ${familyDetails.roles.join(', ')}. Relationships: ${familyDetails.relationship_types.join(', ')}. Source: ${familyDetails.source_url || 'various'}`,
        'promote_trackable_script'
    ]);

    return result.rows[0].id;
}

async function main() {
    const dryRun = !process.argv.includes('--execute');
    if (dryRun) {
        console.log('DRY RUN mode. Use --execute to apply changes.\n');
    }

    console.log('=== PROMOTE TRACKABLE ENSLAVED TO CANONICAL ===\n');

    const trackablePeople = await getTrackablePeople();
    console.log(`Found ${trackablePeople.length} people with family links\n`);

    const stats = {
        processed: 0,
        foundInUnconfirmed: 0,
        alreadyCanonical: 0,
        promoted: 0,
        notFound: 0,
        errors: 0
    };

    const promotedList = [];
    const notFoundList = [];

    for (const person of trackablePeople) {
        stats.processed++;

        // Check if already canonical
        if (await isAlreadyCanonical(person.name)) {
            stats.alreadyCanonical++;
            continue;
        }

        // Find in unconfirmed_persons
        const unconfirmed = await findUnconfirmedPerson(person.name);

        if (!unconfirmed) {
            stats.notFound++;
            notFoundList.push(person.name);
            continue;
        }

        stats.foundInUnconfirmed++;

        if (!dryRun) {
            try {
                const canonicalId = await promoteToCanonical(unconfirmed, person);
                stats.promoted++;
                promotedList.push({
                    name: person.name,
                    canonicalId: canonicalId,
                    roles: person.roles,
                    relationshipTypes: person.relationship_types
                });
            } catch (err) {
                console.error(`Error promoting ${person.name}: ${err.message}`);
                stats.errors++;
            }
        } else {
            promotedList.push({
                name: person.name,
                roles: person.roles,
                relationshipTypes: person.relationship_types
            });
        }
    }

    // Display results
    console.log('=== WOULD BE / WERE PROMOTED ===\n');
    for (const p of promotedList.slice(0, 30)) {
        console.log(`${p.name}`);
        console.log(`  Roles: ${p.roles.join(', ')}`);
        console.log(`  Relationships: ${p.relationshipTypes.join(', ')}`);
        if (p.canonicalId) console.log(`  → canonical_persons.id = ${p.canonicalId}`);
        console.log('');
    }

    if (notFoundList.length > 0) {
        console.log('=== NOT FOUND IN UNCONFIRMED_PERSONS (enslaved) ===\n');
        console.log(notFoundList.slice(0, 20).join(', '));
        if (notFoundList.length > 20) console.log(`... and ${notFoundList.length - 20} more`);
        console.log('');
    }

    console.log('=== STATISTICS ===\n');
    console.log(`People processed: ${stats.processed}`);
    console.log(`Found in unconfirmed_persons: ${stats.foundInUnconfirmed}`);
    console.log(`Already canonical: ${stats.alreadyCanonical}`);
    console.log(`Not found (may be owner names): ${stats.notFound}`);

    if (!dryRun) {
        console.log(`\nPromoted to canonical: ${stats.promoted}`);
        console.log(`Errors: ${stats.errors}`);
    } else {
        console.log(`\nWould promote: ${promotedList.length}`);
    }

    // Show canonical_persons count
    const canonicalCount = await pool.query(`
        SELECT person_type, COUNT(*) FROM canonical_persons GROUP BY 1 ORDER BY 2 DESC
    `);
    console.log('\n=== CANONICAL_PERSONS COUNT ===\n');
    canonicalCount.rows.forEach(r => console.log(`  ${r.person_type}: ${r.count}`));

    await pool.end();
}

main().catch(console.error);
