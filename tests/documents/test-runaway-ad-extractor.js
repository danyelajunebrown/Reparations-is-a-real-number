#!/usr/bin/env node
/**
 * Smoke test for the newspaper-runaway-ad extractor.
 *
 * Loads each sample in samples/runaway_ads/, reconstructs the OCR text from
 * the JSON word-coordinates file (loc.gov returns word-level data, not page
 * text — we reconstruct by stringing words in y/x order), and runs the
 * extractor against the reconstructed text.
 *
 * Note: page-level OCR isn't block-segmented yet — each sample is a full
 * newspaper PAGE that contains multiple ads + other content. This test
 * runs the extractor over the WHOLE PAGE text. In real ingestion, the
 * BlockSegmenter would carve out individual ad blocks first. The smoke
 * test here exists to verify the extractor's regex/heuristic logic
 * against representative period-correct text, not to do full pipeline
 * extraction.
 *
 * Usage:
 *   node tests/documents/test-runaway-ad-extractor.js
 *   node tests/documents/test-runaway-ad-extractor.js --sample ranaway_negro_reward_1830-1850
 */

const fs = require('fs');
const path = require('path');

// Re-resolve relative path so this can run from any cwd
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const { NewspaperRunawayAdExtractor } = require(path.join(REPO_ROOT, 'src/services/documents/extractors/newspaper-runaway-ad-extractor'));
const SAMPLES_DIR = path.join(REPO_ROOT, 'samples/runaway_ads');

const args = process.argv.slice(2);
const SAMPLE_FILTER = args.includes('--sample') ? args[args.indexOf('--sample') + 1] : null;

function reconstructTextFromWordCoords(wordCoordsPath) {
    if (!fs.existsSync(wordCoordsPath)) return null;
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(wordCoordsPath, 'utf8'));
    } catch (e) {
        return null;  // corrupt or upstream-error response (e.g., loc.gov 520)
    }
    // loc.gov format: { "<xml_path>": { "coords": { "<word>": [{coordinates, position}, ...] } } }
    const xmlKey = Object.keys(raw)[0];
    const coords = raw[xmlKey]?.coords || {};
    // Each entry has positions [block, line] arrays. To reconstruct readable text we sort by
    // y-coordinate (coordinates[1]) then x-coordinate (coordinates[0]).
    const tokens = [];
    for (const [word, occurrences] of Object.entries(coords)) {
        for (const occ of occurrences) {
            const c = occ.coordinates;
            if (!c || c.length < 2) continue;
            tokens.push({ word, x: c[0], y: c[1], pos: occ.position });
        }
    }
    tokens.sort((a, b) => {
        const yLine = Math.floor(a.y / 100) - Math.floor(b.y / 100);  // 100-px line buckets
        if (yLine !== 0) return yLine;
        return a.x - b.x;
    });
    return tokens.map(t => t.word).join(' ');
}

(async () => {
    const sampleDirs = fs.readdirSync(SAMPLES_DIR)
        .filter(d => fs.statSync(path.join(SAMPLES_DIR, d)).isDirectory())
        .filter(d => !SAMPLE_FILTER || d.includes(SAMPLE_FILTER));

    console.log(`══════════════════════════════════════════════════════════════════`);
    console.log(`  Runaway-ad extractor smoke test`);
    console.log(`  Samples: ${sampleDirs.length}`);
    console.log(`══════════════════════════════════════════════════════════════════\n`);

    const extractor = new NewspaperRunawayAdExtractor();
    let passCount = 0;
    let failCount = 0;
    const summary = [];

    for (const dir of sampleDirs) {
        const samplePath = path.join(SAMPLES_DIR, dir);
        const metadata = JSON.parse(fs.readFileSync(path.join(samplePath, 'metadata.json'), 'utf8'));
        const altoPath = path.join(samplePath, 'alto.json');

        const text = reconstructTextFromWordCoords(altoPath);
        if (!text) {
            console.log(`  ⏭  ${dir}: no OCR data`);
            continue;
        }

        // Pre-classification: does the page even contain a runaway ad?
        const classifyConf = NewspaperRunawayAdExtractor.classifyConfidence(text);

        const result = await extractor.extract({
            blockText: text,
            sourceMetadata: metadata,
        });

        const personEntities = result.entities.filter(e => e.type === 'person');
        const enslavedFound = personEntities.find(e => e.role === 'enslaved_person_fugitive');
        const subscriberFound = personEntities.find(e => e.role === 'subscriber_current_enslaver');
        const priorFound = personEntities.find(e => e.role === 'prior_enslaver');
        const bountyFound = result.entities.find(e => e.type === 'monetary_amount');
        const placeFound = result.entities.find(e => e.type === 'place');

        const ok = classifyConf >= 0.3 && (enslavedFound || subscriberFound || bountyFound);
        if (ok) passCount++; else failCount++;

        console.log(`  ${ok ? '✓' : '✗'}  ${dir}`);
        console.log(`     classify_confidence: ${classifyConf.toFixed(2)}`);
        console.log(`     entities: ${personEntities.length} persons, ${result.entities.length - personEntities.length} other`);
        if (enslavedFound) console.log(`       enslaved fugitive: ${JSON.stringify(enslavedFound.attributes)}`);
        if (subscriberFound) console.log(`       subscriber/current: ${JSON.stringify(subscriberFound.attributes)}`);
        if (priorFound) console.log(`       prior enslaver: ${JSON.stringify(priorFound.attributes)}`);
        if (bountyFound) console.log(`       bounty: ${JSON.stringify(bountyFound.attributes)}`);
        if (placeFound) console.log(`       place: ${JSON.stringify(placeFound.attributes)}`);
        console.log(`     relationships: ${result.relationships.length}, events: ${result.events.length}`);
        console.log();

        summary.push({ sample: dir, classify_confidence: classifyConf, ok, entityCount: result.entities.length });
    }

    console.log(`══════════════════════════════════════════════════════════════════`);
    console.log(`  Pass: ${passCount}/${sampleDirs.length}    Fail: ${failCount}/${sampleDirs.length}`);
    console.log(`══════════════════════════════════════════════════════════════════`);

    process.exit(failCount > 0 ? 1 : 0);
})().catch(e => {
    console.error('FATAL:', e.message);
    console.error(e.stack);
    process.exit(2);
});
