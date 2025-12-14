/**
 * FamilySearch Catalog Processor
 *
 * Handles FamilySearch catalog URLs that contain multiple film collections.
 * Extracts film numbers and queues them for processing.
 *
 * Usage:
 *   const processor = new FamilySearchCatalogProcessor();
 *   const films = await processor.extractFilms('https://www.familysearch.org/en/search/catalog/559181');
 *   await processor.queueFilmsForProcessing(films);
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { Pool } = require('pg');

class FamilySearchCatalogProcessor {
    constructor(options = {}) {
        this.pool = options.pool || new Pool({ connectionString: process.env.DATABASE_URL });
        this.processedFilms = new Set(); // Track films already processed in this session

        // Film collections we've already processed
        this.completedFilms = options.completedFilms || ['008891444']; // Ravenel Papers Film 1
    }

    /**
     * Parse a FamilySearch catalog URL and extract film information
     */
    async extractFilms(catalogUrl) {
        console.log(`[FamilySearch Catalog] Analyzing: ${catalogUrl}`);

        try {
            // Extract catalog ID from URL
            const catalogMatch = catalogUrl.match(/catalog\/(\d+)/);
            if (!catalogMatch) {
                throw new Error('Invalid FamilySearch catalog URL - no catalog ID found');
            }
            const catalogId = catalogMatch[1];

            // Fetch the catalog page
            const response = await axios.get(catalogUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml'
                },
                timeout: 30000
            });

            const $ = cheerio.load(response.data);
            const films = [];

            // Try to extract film information from the page
            // FamilySearch uses various formats - try multiple selectors

            // Method 1: Look for film links
            $('a[href*="ark:/61903"]').each((i, el) => {
                const href = $(el).attr('href');
                const text = $(el).text().trim();
                const filmMatch = href.match(/3:1:([A-Z0-9-]+)/);
                if (filmMatch) {
                    films.push({
                        ark: filmMatch[1],
                        title: text,
                        url: href.startsWith('http') ? href : `https://www.familysearch.org${href}`,
                        catalogId: catalogId
                    });
                }
            });

            // Method 2: Look for film numbers in text
            const pageText = $('body').text();
            const filmNumberMatches = pageText.match(/\b\d{9,10}\b/g);
            if (filmNumberMatches) {
                const uniqueFilmNumbers = [...new Set(filmNumberMatches)];
                for (const filmNumber of uniqueFilmNumbers) {
                    // Only include if it looks like a valid film number (starts with 0 or 1)
                    if (filmNumber.startsWith('0') || filmNumber.startsWith('1')) {
                        const existing = films.find(f => f.filmNumber === filmNumber);
                        if (!existing) {
                            films.push({
                                filmNumber: filmNumber,
                                catalogId: catalogId
                            });
                        }
                    }
                }
            }

            // Known films for catalog 559181 (Ball/Ravenel papers)
            // Hardcode these as fallback since web scraping may miss some
            if (catalogId === '559181') {
                const knownFilms = [
                    { filmNumber: '1534237', title: 'Thomas Porcher Ravenel papers - Film 1', imageCount: 970 },
                    { filmNumber: '1534238', title: 'Thomas Porcher Ravenel papers - Film 2' },
                    { filmNumber: '1534239', title: 'Thomas Porcher Ravenel papers - Film 3' },
                    { filmNumber: '1534240', title: 'Thomas Porcher Ravenel & Henry Ravenel papers' },
                    { filmNumber: '1534241', title: 'Thomas Walter Payre, Samuel Barker, Gourdin-Gaillard papers' },
                    { filmNumber: '1534242', title: 'Gourdin-Gaillard family papers' },
                    { filmNumber: '1534243', title: 'Gourdin-Gaillard papers & Richmond overseer journal' },
                    { filmNumber: '1534244', title: 'Alonzo White, John B. Milliken, Paul D. Weston papers' },
                    { filmNumber: '1534245', title: 'Paul D. Weston, John Sparkman, Joshua John Ward papers' },
                    { filmNumber: '1534246', title: 'Daniel Webb plantation books & Glover family papers' }
                ];

                // Merge known films with extracted ones
                for (const known of knownFilms) {
                    const existing = films.find(f => f.filmNumber === known.filmNumber);
                    if (!existing) {
                        films.push({
                            ...known,
                            catalogId: catalogId,
                            url: `https://www.familysearch.org/search/film/00${known.filmNumber}?cat=${catalogId}`
                        });
                    } else {
                        // Enhance existing entry
                        Object.assign(existing, known);
                    }
                }
            }

            console.log(`[FamilySearch Catalog] Found ${films.length} films`);
            return {
                success: true,
                catalogId: catalogId,
                catalogUrl: catalogUrl,
                films: films,
                totalFilms: films.length
            };

        } catch (error) {
            console.error(`[FamilySearch Catalog] Fetch error: ${error.message}`);

            // If direct fetch fails, check if we have known films for this catalog
            const catalogMatch = catalogUrl.match(/catalog\/(\d+)/);
            const catalogId = catalogMatch ? catalogMatch[1] : null;

            if (catalogId === '559181') {
                console.log(`[FamilySearch Catalog] Using known films for catalog ${catalogId}`);
                const knownFilms = [
                    { filmNumber: '1534237', title: 'Thomas Porcher Ravenel papers - Film 1', imageCount: 970, imageGroup: '008891444' },
                    { filmNumber: '1534238', title: 'Thomas Porcher Ravenel papers - Film 2', imageGroup: '008891445' },
                    { filmNumber: '1534239', title: 'Thomas Porcher Ravenel papers - Film 3', imageGroup: '008891446' },
                    { filmNumber: '1534240', title: 'Thomas Porcher Ravenel & Henry Ravenel papers', imageGroup: '008891447' },
                    { filmNumber: '1534241', title: 'Thomas Walter Payre, Samuel Barker, Gourdin-Gaillard papers', imageGroup: '008891448' },
                    { filmNumber: '1534242', title: 'Gourdin-Gaillard family papers', imageGroup: '008123287' },
                    { filmNumber: '1534243', title: 'Gourdin-Gaillard papers & Richmond overseer journal', imageGroup: '008123288' },
                    { filmNumber: '1534244', title: 'Alonzo White, John B. Milliken, Paul D. Weston papers', imageGroup: '008891449' },
                    { filmNumber: '1534245', title: 'Paul D. Weston, John Sparkman, Joshua John Ward papers', imageGroup: '008891450' },
                    { filmNumber: '1534246', title: 'Daniel Webb plantation books & Glover family papers', imageGroup: '008218489' }
                ].map(film => ({
                    ...film,
                    catalogId: catalogId,
                    url: `https://www.familysearch.org/search/film/${film.imageGroup}?cat=${catalogId}`
                }));

                return {
                    success: true,
                    catalogId: catalogId,
                    catalogUrl: catalogUrl,
                    films: knownFilms,
                    totalFilms: knownFilms.length,
                    source: 'cached_metadata'
                };
            }

            return {
                success: false,
                error: error.message,
                catalogUrl: catalogUrl
            };
        }
    }

    /**
     * Queue films for background processing
     */
    async queueFilmsForProcessing(films, options = {}) {
        const results = {
            queued: [],
            skipped: [],
            errors: []
        };

        for (const film of films) {
            try {
                // Check if this film has already been processed
                if (this.completedFilms.includes(film.filmNumber)) {
                    results.skipped.push({
                        ...film,
                        reason: 'Already completed'
                    });
                    continue;
                }

                // Check database for existing extraction jobs
                const filmUrl = film.url || `https://www.familysearch.org/search/film/${film.imageGroup}?cat=${film.catalogId}`;
                // Search by imageGroup (which is in the URL) rather than filmNumber
                const searchTerm = film.imageGroup || film.filmNumber;

                const existing = await this.pool.query(`
                    SELECT COUNT(*) as count
                    FROM extraction_jobs
                    WHERE content_url LIKE $1
                    AND status IN ('pending', 'completed', 'processing')
                `, [`%${searchTerm}%`]);

                const count = parseInt(existing.rows[0].count, 10);

                if (count > 0) {
                    results.skipped.push({
                        ...film,
                        reason: 'Already in extraction queue'
                    });
                    continue;
                }

                // Queue the film for processing
                // extraction_jobs requires: extraction_id (UUID), content_url, method, and optionally content_type, ocr_config
                const { v4: uuidv4 } = require('uuid');
                const extractionId = uuidv4();
                const queueResult = await this.pool.query(`
                    INSERT INTO extraction_jobs (
                        extraction_id, content_url, content_type, method, status,
                        ocr_config, created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
                    RETURNING extraction_id
                `, [
                    extractionId,
                    filmUrl,
                    'familysearch_film',
                    'familysearch_ocr',
                    'pending',
                    JSON.stringify({
                        filmNumber: film.filmNumber,
                        title: film.title,
                        catalogId: film.catalogId,
                        imageGroup: film.imageGroup,
                        imageCount: film.imageCount || null
                    })
                ]);

                results.queued.push({
                    ...film,
                    jobId: queueResult.rows[0].extraction_id
                });

            } catch (error) {
                results.errors.push({
                    ...film,
                    error: error.message
                });
            }
        }

        console.log(`[FamilySearch Catalog] Queue results: ${results.queued.length} queued, ${results.skipped.length} skipped, ${results.errors.length} errors`);
        return results;
    }

    /**
     * Get processing status for a catalog
     */
    async getCatalogStatus(catalogId) {
        const jobs = await this.pool.query(`
            SELECT status, COUNT(*) as count
            FROM extraction_jobs
            WHERE ocr_config->>'catalogId' = $1
            GROUP BY status
        `, [catalogId]);

        const stats = {
            pending: 0,
            processing: 0,
            completed: 0,
            failed: 0
        };

        for (const row of jobs.rows) {
            stats[row.status] = parseInt(row.count);
        }

        return {
            catalogId,
            ...stats,
            total: stats.pending + stats.processing + stats.completed + stats.failed
        };
    }

    /**
     * Check if a URL is a FamilySearch catalog URL
     */
    static isCatalogUrl(url) {
        return url && url.includes('familysearch.org') && url.includes('catalog/');
    }

    /**
     * Check if a URL is a FamilySearch film viewer URL
     */
    static isFilmViewerUrl(url) {
        return url && url.includes('familysearch.org') &&
               (url.includes('ark:/61903') || url.includes('/search/film/'));
    }

    /**
     * Build the ARK URL for a specific film image
     */
    static buildImageUrl(filmNumber, imageIndex, catalogId) {
        // FamilySearch uses 0-indexed images
        return `https://www.familysearch.org/ark:/61903/3:1:3QHV-R3G9-${filmNumber}?i=${imageIndex}&cat=${catalogId}`;
    }
}

module.exports = FamilySearchCatalogProcessor;
