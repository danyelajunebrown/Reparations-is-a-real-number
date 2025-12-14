#!/usr/bin/env node
/**
 * Multi-Film FamilySearch Scraper Runner
 *
 * Processes all 10 films from the Thomas Porcher Ravenel papers (catalog 559181)
 * sequentially, using the same authenticated session.
 *
 * Usage:
 *   # Process all films starting from Film 2 (Film 1 already completed)
 *   node scripts/run-all-films.js
 *
 *   # Process specific range of films
 *   node scripts/run-all-films.js 2 5    # Films 2-5
 *   node scripts/run-all-films.js 6      # Start from Film 6
 *
 * Environment variables required:
 *   - DATABASE_URL: PostgreSQL connection string
 *   - GOOGLE_VISION_API_KEY: For OCR
 *   - FAMILYSEARCH_INTERACTIVE=true: For initial login
 *   - AWS credentials for S3 archival (optional)
 */

const { spawn } = require('child_process');
const path = require('path');

// Film configurations
// Film 2 starts at image 640 because images 1-639 were already processed
const FILMS = {
    1: { filmNumber: '008891444', totalImages: 1355, startImage: 1, status: 'COMPLETED' },
    2: { filmNumber: '008891445', totalImages: 970, startImage: 644, status: 'pending' },
    3: { filmNumber: '008891446', totalImages: 1031, startImage: 1, status: 'pending' },
    4: { filmNumber: '008891447', totalImages: 1058, startImage: 1, status: 'pending' },
    5: { filmNumber: '008891448', totalImages: 1012, startImage: 1, status: 'pending' },
    6: { filmNumber: '008891449', totalImages: 987, startImage: 1, status: 'pending' },
    7: { filmNumber: '008891450', totalImages: 1045, startImage: 1, status: 'pending' },
    8: { filmNumber: '008891451', totalImages: 1020, startImage: 1, status: 'pending' },
    9: { filmNumber: '008891452', totalImages: 1095, startImage: 1, status: 'pending' },
    10: { filmNumber: '008891453', totalImages: 1127, startImage: 1, status: 'pending' }
};

const SCRAPER_PATH = path.join(__dirname, 'scrapers', 'familysearch-scraper.js');

// Parse command line args
const startFilm = parseInt(process.argv[2] || '2', 10);
const endFilm = parseInt(process.argv[3] || '10', 10);

console.log(`
╔══════════════════════════════════════════════════════════════════╗
║     FAMILYSEARCH MULTI-FILM SCRAPER - RAVENEL PAPERS             ║
║     Catalog 559181: Thomas Porcher Ravenel Papers 1731-1867      ║
╠══════════════════════════════════════════════════════════════════╣
║  Films to process: ${startFilm} through ${endFilm}
║  Total images estimate: ~${Object.keys(FILMS).slice(startFilm - 1, endFilm).reduce((sum, k) => sum + FILMS[k].totalImages, 0).toLocaleString()} images
╚══════════════════════════════════════════════════════════════════╝
`);

// Check required environment variables
const DATABASE_URL = process.env.DATABASE_URL;
const GOOGLE_VISION_API_KEY = process.env.GOOGLE_VISION_API_KEY;

if (!DATABASE_URL) {
    console.error('❌ ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
}

if (!GOOGLE_VISION_API_KEY) {
    console.error('❌ ERROR: GOOGLE_VISION_API_KEY environment variable is required');
    process.exit(1);
}

// Track progress
const results = [];
let currentFilm = startFilm;

/**
 * Run the scraper for a single film
 */
function runFilmScraper(filmIndex) {
    return new Promise((resolve, reject) => {
        const film = FILMS[filmIndex];
        console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📽️  PROCESSING FILM ${filmIndex} of 10
    Film Number: ${film.filmNumber}
    Total Images: ${film.totalImages}
    Started: ${new Date().toISOString()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

        const startTime = Date.now();

        // Spawn the scraper process
        const startImg = film.startImage || 1;
        console.log(`    Starting from image: ${startImg}`);
        const scraperProcess = spawn('node', [SCRAPER_PATH, String(startImg), String(film.totalImages)], {
            env: {
                ...process.env,
                FILM_INDEX: String(filmIndex),
                FAMILYSEARCH_INTERACTIVE: 'true'
            },
            stdio: 'inherit'  // Pass through stdout/stderr
        });

        scraperProcess.on('close', (code) => {
            const duration = Math.round((Date.now() - startTime) / 1000 / 60);
            const result = {
                filmIndex,
                filmNumber: film.filmNumber,
                exitCode: code,
                duration: `${duration} minutes`,
                completedAt: new Date().toISOString()
            };

            results.push(result);

            if (code === 0) {
                console.log(`\n✅ Film ${filmIndex} completed successfully in ${duration} minutes\n`);
                resolve(result);
            } else {
                console.error(`\n❌ Film ${filmIndex} failed with exit code ${code}\n`);
                reject(new Error(`Film ${filmIndex} failed with exit code ${code}`));
            }
        });

        scraperProcess.on('error', (err) => {
            console.error(`\n❌ Failed to start scraper for Film ${filmIndex}: ${err.message}\n`);
            reject(err);
        });
    });
}

/**
 * Process all films sequentially
 */
async function processAllFilms() {
    console.log(`🚀 Starting multi-film processing at ${new Date().toISOString()}\n`);

    const overallStart = Date.now();
    let successCount = 0;
    let failCount = 0;

    for (let filmIndex = startFilm; filmIndex <= endFilm; filmIndex++) {
        if (FILMS[filmIndex].status === 'COMPLETED') {
            console.log(`⏭️  Skipping Film ${filmIndex} - already completed`);
            continue;
        }

        try {
            await runFilmScraper(filmIndex);
            successCount++;
            FILMS[filmIndex].status = 'COMPLETED';
        } catch (error) {
            failCount++;
            console.error(`⚠️  Film ${filmIndex} failed, continuing with next film...`);
            // Continue with next film even if one fails
        }
    }

    const totalDuration = Math.round((Date.now() - overallStart) / 1000 / 60);

    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                    PROCESSING COMPLETE                           ║
╠══════════════════════════════════════════════════════════════════╣
║  Total Duration: ${totalDuration} minutes
║  Films Processed: ${successCount + failCount}
║  Successful: ${successCount}
║  Failed: ${failCount}
╚══════════════════════════════════════════════════════════════════╝

Results:
${results.map(r => `  Film ${r.filmIndex}: ${r.exitCode === 0 ? '✅' : '❌'} (${r.duration})`).join('\n')}
`);

    // Exit with error code if any films failed
    process.exit(failCount > 0 ? 1 : 0);
}

// Run the processor
processAllFilms().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
