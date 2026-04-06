#!/usr/bin/env node
/**
 * Build Voyage Evidence — Create retrievable source documentation
 * for every SlaveVoyages enslaver match
 *
 * 1. Loads the full voyage TSV data
 * 2. Indexes all owners/captains → voyage details
 * 3. For each slavevoyages_enslaver match in ancestor_climb_matches,
 *    attaches the full voyage evidence (ship, ports, dates, enslaved counts)
 * 4. Stores voyage records in person_documents for DAA retrieval
 *
 * Usage:
 *   node scripts/build-voyage-evidence.js
 *   node scripts/build-voyage-evidence.js --dry-run
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.argv.includes('--dry-run');

const TRANSATLANTIC_PATH = path.resolve(__dirname, '../storage/population-data/slavevoyages-transatlantic-2023.tab');
const INTRAAMERICAN_PATH = path.resolve(__dirname, '../storage/population-data/slavevoyages-intra-american-2023.tab');

let sql = null;

const stats = {
    voyagesLoaded: 0,
    ownerIndex: 0,
    matchesUpdated: 0,
    errors: 0,
    startTime: Date.now()
};

function parseTSV(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const headers = lines[0].split('\t').map(h => h.trim());
    return lines.slice(1).map(line => {
        const values = line.split('\t');
        const obj = {};
        headers.forEach((h, i) => { obj[h] = (values[i] || '').trim(); });
        return obj;
    });
}

function buildOwnerIndex(voyages, tradeType) {
    const index = {};

    for (const v of voyages) {
        const voyageId = v['VOYAGEID'] || '';
        const shipName = v['SHIPNAME'] || 'Unknown vessel';
        const embarkPort = v['EMBPORT'] || v['PLAC1TRA'] || '';
        const arrivalPort = v['ARRPORT'] || v['PLACCONS'] || '';
        const departDate = v['DATEDEP'] || v['DATEDEPA'] || '';
        const arrivalDate = v['DATELAND1'] || '';
        const totalEmbarked = parseInt(v['TSLAVESD']) || null;
        const totalArrived = parseInt(v['TSLAVESP']) || null;
        const nationality = v['NATINIMP'] || v['NATIONAL'] || '';
        const tonnage = v['TONNAGE'] || '';
        const fate = v['FATE'] || '';
        const registration = v['PLACREG'] || '';

        const voyageRecord = {
            voyageId,
            tradeType,
            shipName,
            embarkPort,
            arrivalPort,
            departDate,
            arrivalDate,
            totalEmbarked,
            totalArrived,
            nationality,
            tonnage,
            fate,
            registration,
            sourceUrl: `https://www.slavevoyages.org/voyage/${voyageId}/variables`,
            citation: `SlaveVoyages.org, ${tradeType === 'transatlantic' ? 'Trans-Atlantic' : 'Intra-American'} Slave Trade Database, Voyage #${voyageId}`
        };

        // Index by owner names
        const ownerKeys = ['OWNERA','OWNERB','OWNERC','OWNERD','OWNERE','OWNERF',
                          'OWNERG','OWNERH','OWNERI','OWNERJ','OWNERK','OWNERL',
                          'OWNERM','OWNERN','OWNERO','OWNERP'];
        for (const key of ownerKeys) {
            const name = (v[key] || '').trim();
            if (name && name.length >= 3) {
                const nameKey = name.toLowerCase();
                if (!index[nameKey]) index[nameKey] = [];
                index[nameKey].push({ ...voyageRecord, role: 'owner', nameAsRecorded: name });
                stats.ownerIndex++;
            }
        }

        // Index by captain names
        for (const key of ['CAPTAINA', 'CAPTAINB', 'CAPTAINC']) {
            const name = (v[key] || '').trim();
            if (name && name.length >= 3) {
                const nameKey = name.toLowerCase();
                if (!index[nameKey]) index[nameKey] = [];
                index[nameKey].push({ ...voyageRecord, role: 'captain', nameAsRecorded: name });
                stats.ownerIndex++;
            }
        }

        stats.voyagesLoaded++;
    }

    return index;
}

async function main() {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  BUILD VOYAGE EVIDENCE`);
    console.log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
    console.log(`${'═'.repeat(60)}\n`);

    sql = neon(DATABASE_URL);

    // Load and index all voyages
    console.log('Loading voyage data...');
    const ownerIndex = {};

    if (fs.existsSync(TRANSATLANTIC_PATH)) {
        const ta = parseTSV(TRANSATLANTIC_PATH);
        console.log(`  Trans-Atlantic: ${ta.length} voyages`);
        const taIndex = buildOwnerIndex(ta, 'transatlantic');
        Object.assign(ownerIndex, taIndex);
    }

    if (fs.existsSync(INTRAAMERICAN_PATH)) {
        const ia = parseTSV(INTRAAMERICAN_PATH);
        console.log(`  Intra-American: ${ia.length} voyages`);
        const iaIndex = buildOwnerIndex(ia, 'intraamerican');
        // Merge — same person can appear in both
        for (const [key, voyages] of Object.entries(iaIndex)) {
            if (!ownerIndex[key]) ownerIndex[key] = [];
            ownerIndex[key].push(...voyages);
        }
    }

    console.log(`  Index: ${Object.keys(ownerIndex).length} unique names → ${stats.ownerIndex} voyage links`);

    // Get all slavevoyages_enslaver matches across all sessions
    console.log('\nFinding SlaveVoyages matches in climb data...');
    const matches = await sql`
        SELECT m.id, m.slaveholder_name, m.session_id, m.generation_distance,
               m.lineage_path, m.verification_status, m.notes,
               s.modern_person_name
        FROM ancestor_climb_matches m
        JOIN ancestor_climb_sessions s ON m.session_id = s.id
        WHERE m.match_type = 'slavevoyages_enslaver'
        AND m.verification_status != 'temporal_impossible'
        ORDER BY s.modern_person_name, m.generation_distance
    `;

    console.log(`  Found ${matches.length} SlaveVoyages matches to enrich\n`);

    // For each match, look up the full voyage evidence
    for (const match of matches) {
        const nameKey = match.slaveholder_name.toLowerCase().replace(/[,*()]/g, '').trim();

        // Try exact match first, then partial
        let voyages = ownerIndex[nameKey] || [];

        // Try last name only if no exact match
        if (voyages.length === 0) {
            const lastWord = nameKey.split(/\s+/).pop();
            if (lastWord && lastWord.length >= 4) {
                for (const [key, v] of Object.entries(ownerIndex)) {
                    if (key.includes(lastWord) || lastWord.includes(key.split(/\s+/).pop())) {
                        voyages = v;
                        break;
                    }
                }
            }
        }

        if (voyages.length === 0) continue;

        // Build evidence text for the DAA
        const evidenceLines = voyages.slice(0, 5).map(v => { // Cap at 5 voyages per person
            const embarked = v.totalEmbarked ? `${v.totalEmbarked} enslaved embarked` : '';
            const arrived = v.totalArrived ? `${v.totalArrived} arrived` : '';
            const people = [embarked, arrived].filter(Boolean).join(', ');
            return `Voyage #${v.voyageId}: ${v.role} of ${v.shipName}` +
                   (v.embarkPort ? `, from ${v.embarkPort}` : '') +
                   (v.arrivalPort ? ` to ${v.arrivalPort}` : '') +
                   (v.departDate ? ` (${v.departDate})` : '') +
                   (people ? ` — ${people}` : '') +
                   `. Source: ${v.citation}`;
        });

        const totalEmbarkedAcrossVoyages = voyages.reduce((sum, v) => sum + (v.totalEmbarked || 0), 0);
        const totalVoyages = voyages.length;

        const evidenceJson = {
            voyages: voyages.slice(0, 10).map(v => ({
                voyageId: v.voyageId,
                tradeType: v.tradeType,
                role: v.role,
                nameAsRecorded: v.nameAsRecorded,
                ship: v.shipName,
                embarkPort: v.embarkPort,
                arrivalPort: v.arrivalPort,
                departDate: v.departDate,
                totalEmbarked: v.totalEmbarked,
                totalArrived: v.totalArrived,
                sourceUrl: v.sourceUrl
            })),
            totalVoyages,
            totalEmbarkedAcrossVoyages,
            summary: `${match.slaveholder_name}: ${totalVoyages} documented voyage(s), ${totalEmbarkedAcrossVoyages} total enslaved persons transported`
        };

        if (!DRY_RUN) {
            try {
                await sql`
                    UPDATE ancestor_climb_matches
                    SET verification_evidence = ${JSON.stringify(evidenceJson)}::jsonb,
                        notes = ${evidenceLines.join(' | ')}
                    WHERE id = ${match.id}
                `;
                stats.matchesUpdated++;
            } catch (e) {
                stats.errors++;
            }
        } else {
            console.log(`  ${match.slaveholder_name} (${match.modern_person_name}, Gen ${match.generation_distance}): ${totalVoyages} voyages, ${totalEmbarkedAcrossVoyages} enslaved`);
            stats.matchesUpdated++;
        }
    }

    const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  EVIDENCE BUILD COMPLETE`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`  Voyages loaded:       ${stats.voyagesLoaded.toLocaleString()}`);
    console.log(`  Owner/captain index:  ${stats.ownerIndex.toLocaleString()}`);
    console.log(`  Matches enriched:     ${stats.matchesUpdated}`);
    console.log(`  Errors:               ${stats.errors}`);
    console.log(`  Elapsed:              ${elapsed}s`);

    if (!DRY_RUN) {
        // Show a sample enriched match
        const sample = await sql`
            SELECT slaveholder_name, verification_evidence->>'summary' as summary,
                   notes
            FROM ancestor_climb_matches
            WHERE match_type = 'slavevoyages_enslaver'
            AND verification_evidence IS NOT NULL
            ORDER BY RANDOM() LIMIT 3
        `;
        console.log('\n  Sample enriched matches:');
        sample.forEach(s => console.log(`    ${s.slaveholder_name}: ${s.summary}`));
    }

    console.log('');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
