#!/usr/bin/env node
/**
 * Smoke test for the newspaper-runaway-ad extractor + block segmenter.
 *
 * Loads each sample in samples/runaway_ads/, runs the BlockSegmenter to
 * produce per-ad blocks, then runs the extractor on each block whose
 * classifyConfidence exceeds the threshold. This is closer to real
 * pipeline behavior than the prior whole-page-text approach.
 *
 * Usage:
 *   node tests/documents/test-runaway-ad-extractor.js
 *   node tests/documents/test-runaway-ad-extractor.js --sample <substring>
 *   node tests/documents/test-runaway-ad-extractor.js --verbose
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const { NewspaperRunawayAdExtractor } = require(path.join(REPO_ROOT, 'src/services/documents/extractors/newspaper-runaway-ad-extractor'));
const { segmentNewspaperPage, filterMeaningfulBlocks } = require(path.join(REPO_ROOT, 'src/services/documents/block-segmenter'));
const SAMPLES_DIR = path.join(REPO_ROOT, 'samples/runaway_ads');

const args = process.argv.slice(2);
const SAMPLE_FILTER = args.includes('--sample') ? args[args.indexOf('--sample') + 1] : null;
const VERBOSE = args.includes('--verbose');

function loadAlto(altoPath) {
    if (!fs.existsSync(altoPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(altoPath, 'utf8'));
    } catch (e) {
        return null;
    }
}

(async () => {
    const sampleDirs = fs.readdirSync(SAMPLES_DIR)
        .filter(d => fs.statSync(path.join(SAMPLES_DIR, d)).isDirectory())
        .filter(d => !SAMPLE_FILTER || d.includes(SAMPLE_FILTER));

    console.log(`══════════════════════════════════════════════════════════════════`);
    console.log(`  Runaway-ad pipeline smoke test (segmenter + extractor)`);
    console.log(`  Samples: ${sampleDirs.length}`);
    console.log(`══════════════════════════════════════════════════════════════════\n`);

    const extractor = new NewspaperRunawayAdExtractor();
    let pageOk = 0, pageSkip = 0, totalAdsExtracted = 0;
    let totalNamedFugitives = 0, totalSubscribers = 0, totalPriorOwners = 0, totalBounties = 0, totalPlaces = 0;

    for (const dir of sampleDirs) {
        const samplePath = path.join(SAMPLES_DIR, dir);
        const metadata = JSON.parse(fs.readFileSync(path.join(samplePath, 'metadata.json'), 'utf8'));
        const altoPath = path.join(samplePath, 'alto.json');

        const altoJson = loadAlto(altoPath);
        if (!altoJson) {
            console.log(`  ⏭  ${dir}: no/corrupt OCR data`);
            pageSkip++;
            continue;
        }

        // Segment the page
        const allBlocks = segmentNewspaperPage(altoJson);
        const candidateBlocks = filterMeaningfulBlocks(allBlocks);

        // Classify each block; keep only those that read as runaway ads
        const runawayBlocks = candidateBlocks
            .map(b => ({ ...b, conf: NewspaperRunawayAdExtractor.classifyConfidence(b.text) }))
            .filter(b => b.conf >= 0.45);

        console.log(`  ${dir}`);
        console.log(`     blocks total=${allBlocks.length} meaningful=${candidateBlocks.length} ad-classified=${runawayBlocks.length}`);

        if (runawayBlocks.length === 0) {
            console.log(`     ⏭ no runaway-ad blocks above threshold`);
            console.log();
            continue;
        }

        // Run extractor on each ad block
        let pageNamedFug = 0, pageSubs = 0, pagePrior = 0, pageBounties = 0, pagePlaces = 0;
        for (const block of runawayBlocks) {
            const r = await extractor.extract({
                blockText: block.text,
                blockCoordinates: block.bbox,
                sourceMetadata: metadata,
            });
            const enslaved = r.entities.find(e => e.role === 'enslaved_person_fugitive');
            const subscriber = r.entities.find(e => e.role === 'subscriber_current_enslaver');
            const prior = r.entities.find(e => e.role === 'prior_enslaver');
            const bounty = r.entities.find(e => e.type === 'monetary_amount');
            const place = r.entities.find(e => e.type === 'place');

            if (enslaved?.attributes?.name) pageNamedFug++;
            if (subscriber) pageSubs++;
            if (prior) pagePrior++;
            if (bounty) pageBounties++;
            if (place) pagePlaces++;

            if (VERBOSE) {
                console.log(`       block#${block.blockIdx} (conf=${block.conf.toFixed(2)}, ${block.wordCount} words):`);
                if (enslaved) console.log(`         fugitive: ${JSON.stringify(enslaved.attributes)}`);
                if (subscriber) console.log(`         subscriber: ${JSON.stringify(subscriber.attributes)}`);
                if (prior) console.log(`         prior: ${JSON.stringify(prior.attributes)}`);
                if (bounty) console.log(`         bounty: ${JSON.stringify(bounty.attributes)}`);
                if (place) console.log(`         place: ${JSON.stringify(place.attributes)}`);
            }
            totalAdsExtracted++;
        }

        console.log(`     extracted: ${pageNamedFug} named, ${pageSubs} subscribers, ${pagePrior} prior, ${pageBounties} bounties, ${pagePlaces} places`);
        console.log();

        totalNamedFugitives += pageNamedFug;
        totalSubscribers += pageSubs;
        totalPriorOwners += pagePrior;
        totalBounties += pageBounties;
        totalPlaces += pagePlaces;
        pageOk++;
    }

    console.log(`══════════════════════════════════════════════════════════════════`);
    console.log(`  Pages processed: ${pageOk}    Skipped (no OCR): ${pageSkip}`);
    console.log(`  Total ads extracted: ${totalAdsExtracted}`);
    console.log(`  Across all ads:`);
    console.log(`    named fugitives:  ${totalNamedFugitives}`);
    console.log(`    subscribers:      ${totalSubscribers}`);
    console.log(`    prior enslavers:  ${totalPriorOwners}`);
    console.log(`    bounty amounts:   ${totalBounties}`);
    console.log(`    place anchors:    ${totalPlaces}`);
    console.log(`══════════════════════════════════════════════════════════════════`);
    console.log(`(Run with --verbose for per-block detail)`);
})().catch(e => {
    console.error('FATAL:', e.message);
    console.error(e.stack);
    process.exit(2);
});
