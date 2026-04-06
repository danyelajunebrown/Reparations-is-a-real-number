#!/usr/bin/env node
/**
 * Research Queue Builder
 *
 * For confirmed enslavers, generates a prioritized list of digitized
 * archives to search for primary source documents (wills, deeds,
 * probate records, Freedmen's Bureau records, etc.)
 *
 * Priority:
 *   1. Enslavers matched in ancestor climbs (highest — these affect real DAAs)
 *   2. Enslavers with named enslaved persons linked (have people to find docs for)
 *   3. Enslavers with county-level location (targetable research)
 *
 * For each enslaver, generates:
 *   - FamilySearch catalog search URL (probate, deeds, wills for county/year)
 *   - NARA Freedmen's Bureau search suggestions
 *   - State-specific archive URLs
 *   - Estimated document availability
 *
 * Usage:
 *   node scripts/build-research-queue.js
 *   node scripts/build-research-queue.js --climbed-only    (only enslavers from climbs)
 *   node scripts/build-research-queue.js --state Georgia
 *   node scripts/build-research-queue.js --limit 100
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const CLIMBED_ONLY = process.argv.includes('--climbed-only');
const stateIdx = process.argv.indexOf('--state');
const TARGET_STATE = stateIdx !== -1 ? process.argv[stateIdx + 1] : null;
const limitIdx = process.argv.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1]) : 500;

let sql;

// State-specific archive URLs
const STATE_ARCHIVES = {
    'Georgia': {
        probate: 'https://vault.georgiaarchives.org/',
        digitized: 'https://www.familysearch.org/search/catalog/results?count=20&placeId=196080&query=%2Bplace%3A%22Georgia%22&subjectsOpen=614163-50',
        freedmens: 'https://www.familysearch.org/en/search/collection/2721171?q.birthLikePlace=Georgia'
    },
    'Virginia': {
        probate: 'https://www.lva.virginia.gov/chancery/',
        digitized: 'https://www.virginiamemory.com/collections/',
        freedmens: 'https://www.familysearch.org/en/search/collection/2721171?q.birthLikePlace=Virginia'
    },
    'South Carolina': {
        probate: 'https://www.archivesindex.sc.gov/',
        digitized: 'https://www.familysearch.org/search/catalog/results?count=20&placeId=195625&query=%2Bplace%3A%22South+Carolina%22',
        freedmens: 'https://www.familysearch.org/en/search/collection/2721171?q.birthLikePlace=South+Carolina'
    },
    'North Carolina': {
        probate: 'https://digital.ncdcr.gov/',
        digitized: 'https://www.familysearch.org/search/catalog/results?count=20&placeId=196485&query=%2Bplace%3A%22North+Carolina%22',
        freedmens: 'https://www.familysearch.org/en/search/collection/2721171?q.birthLikePlace=North+Carolina'
    },
    'Louisiana': {
        probate: 'https://www.sos.la.gov/HistoricalResources/ResearchHistoricalRecords/Pages/default.aspx',
        digitized: 'https://www.familysearch.org/search/catalog/results?count=20&placeId=194785&query=%2Bplace%3A%22Louisiana%22',
        freedmens: 'https://www.familysearch.org/en/search/collection/2721171?q.birthLikePlace=Louisiana'
    },
    'Mississippi': {
        probate: 'https://www.mdah.ms.gov/arrec/digital_archives/',
        digitized: 'https://www.familysearch.org/search/catalog/results?count=20&placeId=196306&query=%2Bplace%3A%22Mississippi%22',
        freedmens: 'https://www.familysearch.org/en/search/collection/2721171?q.birthLikePlace=Mississippi'
    },
    'Alabama': {
        probate: 'https://www.archives.alabama.gov/',
        digitized: 'https://www.familysearch.org/search/catalog/results?count=20&placeId=191023&query=%2Bplace%3A%22Alabama%22',
        freedmens: 'https://www.familysearch.org/en/search/collection/2721171?q.birthLikePlace=Alabama'
    },
    'Kentucky': {
        digitized: 'https://www.familysearch.org/search/catalog/results?count=20&placeId=196102&query=%2Bplace%3A%22Kentucky%22',
        freedmens: 'https://www.familysearch.org/en/search/collection/2721171?q.birthLikePlace=Kentucky'
    },
    'Tennessee': {
        digitized: 'https://www.familysearch.org/search/catalog/results?count=20&placeId=197066&query=%2Bplace%3A%22Tennessee%22',
        freedmens: 'https://www.familysearch.org/en/search/collection/2721171?q.birthLikePlace=Tennessee'
    },
    'Maryland': {
        probate: 'https://msa.maryland.gov/megafile/msa/stagsere/se1/se18/html/se18intro.html',
        digitized: 'https://www.familysearch.org/search/catalog/results?count=20&placeId=191785&query=%2Bplace%3A%22Maryland%22',
        freedmens: 'https://www.familysearch.org/en/search/collection/2721171?q.birthLikePlace=Maryland'
    }
};

// Default for states without specific URLs
const DEFAULT_ARCHIVES = {
    digitized: state => `https://www.familysearch.org/search/catalog/results?count=20&query=%2Bplace%3A%22${encodeURIComponent(state)}%22`,
    freedmens: state => `https://www.familysearch.org/en/search/collection/2721171?q.birthLikePlace=${encodeURIComponent(state)}`,
    nara: 'https://catalog.archives.gov/advancedsearch'
};

function buildResearchLeads(enslaver) {
    const state = enslaver.primary_state || '';
    const county = enslaver.primary_county || '';
    const name = enslaver.canonical_name || '';
    const archives = STATE_ARCHIVES[state] || {};

    const leads = [];

    // FamilySearch catalog — probate records for this county
    if (county && state) {
        leads.push({
            type: 'familysearch_probate',
            description: `FamilySearch: Probate/Will records for ${county}, ${state}`,
            url: `https://www.familysearch.org/search/catalog/results?count=20&query=%2Bplace%3A%22${encodeURIComponent(county + ', ' + state)}%22%20%2Bsubject%3A%22Probate%22`,
            searchFor: `${name} in probate/will records`,
            automatable: true
        });
    }

    // FamilySearch — Freedmen's Bureau records for the state
    if (state) {
        const fbUrl = archives.freedmens || DEFAULT_ARCHIVES.freedmens(state);
        leads.push({
            type: 'freedmens_bureau',
            description: `Freedmen's Bureau records — ${state}`,
            url: fbUrl,
            searchFor: `Former enslaver "${name}" in Freedmen's Bureau labor contracts, marriage registers`,
            automatable: false
        });
    }

    // State-specific archives
    if (archives.probate) {
        leads.push({
            type: 'state_probate',
            description: `${state} state probate archives`,
            url: archives.probate,
            searchFor: `${name} will/estate/probate`,
            automatable: false
        });
    }

    // NARA
    leads.push({
        type: 'nara',
        description: 'National Archives catalog search',
        url: DEFAULT_ARCHIVES.nara,
        searchFor: `${name}, ${county || state}`,
        automatable: false
    });

    // SlaveVoyages — already checked during climbs, but note if enslaver is from a port city
    const portCities = ['Charleston', 'New Orleans', 'Savannah', 'Mobile', 'Norfolk', 'Baltimore', 'Richmond'];
    if (portCities.some(p => county && county.toLowerCase().includes(p.toLowerCase()))) {
        leads.push({
            type: 'slavevoyages_port',
            description: `SlaveVoyages: ${county} was a slave trade port`,
            url: `https://www.slavevoyages.org/voyage/database#searchBy=enslaver&nameOfEnslavers=${encodeURIComponent(name)}`,
            searchFor: `${name} as ship owner/captain in ${county}`,
            automatable: true
        });
    }

    return leads;
}

async function main() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  RESEARCH QUEUE BUILDER`);
    console.log(`  ${CLIMBED_ONLY ? 'Climbed enslavers only' : 'All enslavers'}`);
    if (TARGET_STATE) console.log(`  State: ${TARGET_STATE}`);
    console.log(`  Limit: ${LIMIT}`);
    console.log(`${'='.repeat(60)}\n`);

    sql = neon(process.env.DATABASE_URL);

    // Create research_queue table if not exists
    await sql`
        CREATE TABLE IF NOT EXISTS research_queue (
            id SERIAL PRIMARY KEY,
            canonical_person_id INTEGER,
            enslaver_name TEXT NOT NULL,
            state TEXT,
            county TEXT,
            priority INTEGER DEFAULT 0,
            priority_reason TEXT,
            leads JSONB DEFAULT '[]',
            status TEXT DEFAULT 'pending',
            assigned_to TEXT,
            result_notes TEXT,
            documents_found INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    `;

    // Get enslavers to research, prioritized
    let enslavers;
    if (CLIMBED_ONLY) {
        enslavers = await sql`
            SELECT DISTINCT cp.id, cp.canonical_name, cp.primary_state, cp.primary_county,
                   COUNT(DISTINCT acm.session_id) as climb_sessions,
                   MAX(acm.confidence_adjusted) as max_confidence
            FROM canonical_persons cp
            JOIN ancestor_climb_matches acm ON acm.slaveholder_id = cp.id
            WHERE cp.person_type = 'enslaver'
            AND acm.verification_status NOT IN ('temporal_impossible', 'common_name_suspect')
            ${TARGET_STATE ? sql`AND cp.primary_state = ${TARGET_STATE}` : sql``}
            GROUP BY cp.id, cp.canonical_name, cp.primary_state, cp.primary_county
            ORDER BY climb_sessions DESC, max_confidence DESC
            LIMIT ${LIMIT}
        `;
    } else {
        // Priority: enslavers with family_relationships (have documented enslaved people)
        enslavers = await sql`
            SELECT cp.id, cp.canonical_name, cp.primary_state, cp.primary_county,
                   COUNT(fr.id) as enslaved_count
            FROM canonical_persons cp
            LEFT JOIN family_relationships fr ON fr.person1_lead_id = cp.id
            WHERE cp.person_type = 'enslaver'
            AND cp.primary_state IS NOT NULL
            AND cp.primary_county IS NOT NULL
            ${TARGET_STATE ? sql`AND cp.primary_state = ${TARGET_STATE}` : sql``}
            GROUP BY cp.id, cp.canonical_name, cp.primary_state, cp.primary_county
            ORDER BY enslaved_count DESC
            LIMIT ${LIMIT}
        `;
    }

    console.log(`Found ${enslavers.length} enslavers to generate research leads for\n`);

    let queued = 0;
    for (const e of enslavers) {
        const leads = buildResearchLeads(e);
        const priority = e.climb_sessions ? 100 + (e.climb_sessions * 10) : (e.enslaved_count || 0);
        const reason = e.climb_sessions
            ? `Matched in ${e.climb_sessions} climb session(s), max confidence ${((e.max_confidence || 0) * 100).toFixed(0)}%`
            : `${e.enslaved_count || 0} documented enslaved persons`;

        if (!DRY_RUN) {
            // Check if already in queue
            const existing = await sql`
                SELECT id FROM research_queue WHERE canonical_person_id = ${e.id} LIMIT 1
            `;
            if (existing.length > 0) continue;

            await sql`
                INSERT INTO research_queue (canonical_person_id, enslaver_name, state, county, priority, priority_reason, leads)
                VALUES (${e.id}, ${e.canonical_name}, ${e.primary_state}, ${e.primary_county}, ${priority}, ${reason}, ${JSON.stringify(leads)})
            `;
        }

        queued++;
        if (queued <= 5) {
            console.log(`  ${e.canonical_name} (${e.primary_county || '?'}, ${e.primary_state || '?'}) — ${leads.length} leads, priority ${priority}`);
            leads.forEach(l => console.log(`    [${l.type}] ${l.description}`));
            console.log('');
        }
    }

    if (queued > 5) console.log(`  ... and ${queued - 5} more\n`);

    console.log(`Queued: ${queued} enslavers with research leads`);

    if (!DRY_RUN) {
        const total = await sql`SELECT COUNT(*) as cnt FROM research_queue`;
        console.log(`Total in research_queue: ${total[0].cnt}`);
    }
    console.log('');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
