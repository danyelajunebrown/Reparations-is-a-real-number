/**
 * SourceAnalyzer - Intelligent Source Analysis System
 *
 * When a new URL is submitted, this system:
 * 1. Analyzes the source structure (download links, data formats, APIs)
 * 2. Identifies what data fields exist and how they're organized
 * 3. Determines the best extraction strategy
 * 4. Assesses data quality and completeness
 * 5. Generates a processing plan
 *
 * This mimics the manual analysis done for sources like the Louisiana Slave Database.
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

class SourceAnalyzer {
    constructor(db = null) {
        this.db = db;

        // Known source type patterns
        this.sourcePatterns = {
            // Structured data downloads
            zipArchive: {
                patterns: [/\.zip$/i, /download.*\.zip/i],
                dataTypes: ['dbf', 'csv', 'xlsx', 'mdb', 'sav'],
                priority: 'high'
            },
            // FamilySearch-style film viewers
            familysearchFilm: {
                patterns: [/familysearch\.org.*film/i, /familysearch\.org.*ark:/i],
                dataTypes: ['images'],
                requiresAuth: true,
                priority: 'high'
            },
            // State archive collections
            stateArchive: {
                patterns: [/msa\.maryland\.gov/i, /archives\./i, /state.*archives/i],
                dataTypes: ['images', 'pdf', 'html'],
                priority: 'high'
            },
            // Academic databases
            academicDatabase: {
                patterns: [/ibiblio\.org/i, /jstor/i, /ancestry/i, /fold3/i],
                dataTypes: ['structured'],
                priority: 'high'
            },
            // Census/government records
            censusRecords: {
                patterns: [/census/i, /1860.*slaveholders/i, /slave.*schedule/i],
                dataTypes: ['tabular'],
                priority: 'high'
            },
            // General web pages
            webPage: {
                patterns: [/.*/],
                dataTypes: ['html'],
                priority: 'low'
            }
        };

        // Data field patterns we look for
        this.fieldPatterns = {
            // Person identification
            name: {
                patterns: [/name/i, /slave.*name/i, /owner/i, /master/i],
                importance: 'critical'
            },
            age: {
                patterns: [/age/i, /years.*old/i, /born/i],
                importance: 'high'
            },
            sex: {
                patterns: [/sex/i, /gender/i, /male|female/i],
                importance: 'high'
            },
            race: {
                patterns: [/race/i, /color/i, /mulatto|black|grif/i],
                importance: 'high'
            },
            // Origins
            birthplace: {
                patterns: [/birthplace/i, /origin/i, /nation/i, /born.*in/i, /african/i],
                importance: 'high'
            },
            // Skills/occupation
            occupation: {
                patterns: [/skill/i, /occupation/i, /trade/i, /work/i],
                importance: 'medium'
            },
            // Transaction data
            price: {
                patterns: [/price/i, /value/i, /cost/i, /sold.*for/i, /piastre/i, /dollar/i],
                importance: 'medium'
            },
            // Family
            family: {
                patterns: [/mother/i, /father/i, /child/i, /family/i, /spouse/i, /mate/i],
                importance: 'high'
            },
            // Document metadata
            date: {
                patterns: [/date/i, /year/i, /when/i],
                importance: 'high'
            },
            location: {
                patterns: [/location/i, /parish/i, /county/i, /state/i, /place/i],
                importance: 'high'
            },
            // Status
            status: {
                patterns: [/runaway/i, /maroon/i, /free/i, /emancipat/i],
                importance: 'high'
            }
        };
    }

    /**
     * Analyze a source URL and generate a processing plan
     */
    async analyzeSource(url) {
        console.log(`\n${'='.repeat(70)}`);
        console.log(`SOURCE ANALYZER: Analyzing ${url}`);
        console.log(`${'='.repeat(70)}\n`);

        const analysis = {
            url,
            timestamp: new Date().toISOString(),
            sourceType: null,
            dataFormat: null,
            availableDownloads: [],
            detectedFields: [],
            estimatedRecordCount: null,
            qualityIndicators: {},
            processingPlan: null,
            customScraperNeeded: false,
            recommendations: []
        };

        try {
            // Step 1: Fetch and analyze the page
            console.log('Step 1: Fetching page content...');
            const pageContent = await this.fetchPage(url);

            // Step 2: Identify source type
            console.log('Step 2: Identifying source type...');
            analysis.sourceType = this.identifySourceType(url, pageContent);
            console.log(`   Source type: ${analysis.sourceType.type} (${analysis.sourceType.priority} priority)`);

            // Step 3: Find downloadable data
            console.log('Step 3: Finding downloadable data...');
            analysis.availableDownloads = this.findDownloads(url, pageContent);
            console.log(`   Found ${analysis.availableDownloads.length} potential downloads`);

            // Step 4: Detect data fields from page content
            console.log('Step 4: Detecting data fields...');
            analysis.detectedFields = this.detectFields(pageContent);
            console.log(`   Detected ${analysis.detectedFields.length} field types`);

            // Step 5: Analyze documentation if present
            console.log('Step 5: Looking for documentation...');
            analysis.documentation = this.findDocumentation(pageContent);

            // Step 6: Estimate data volume
            console.log('Step 6: Estimating data volume...');
            analysis.estimatedRecordCount = this.estimateRecordCount(pageContent);

            // Step 7: Assess quality indicators
            console.log('Step 7: Assessing quality indicators...');
            analysis.qualityIndicators = this.assessQuality(analysis);

            // Step 8: Generate processing plan
            console.log('Step 8: Generating processing plan...');
            analysis.processingPlan = this.generateProcessingPlan(analysis);

            // Step 9: Determine if custom scraper needed
            analysis.customScraperNeeded = this.needsCustomScraper(analysis);

            // Step 10: Generate recommendations
            analysis.recommendations = this.generateRecommendations(analysis);

            // Log summary
            this.logAnalysisSummary(analysis);

            return analysis;

        } catch (error) {
            console.error('Analysis error:', error.message);
            analysis.error = error.message;
            analysis.recommendations.push({
                type: 'error',
                message: `Failed to analyze source: ${error.message}`,
                action: 'Try manual screenshot upload or text paste'
            });
            return analysis;
        }
    }

    /**
     * Fetch page content
     */
    fetchPage(url) {
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const protocol = parsedUrl.protocol === 'https:' ? https : http;

            const options = {
                hostname: parsedUrl.hostname,
                path: parsedUrl.pathname + parsedUrl.search,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; ReparationsBot/1.0; Research)',
                    'Accept': 'text/html,application/xhtml+xml,*/*'
                },
                timeout: 30000
            };

            const req = protocol.get(options, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    // Follow redirect
                    this.fetchPage(res.headers.location)
                        .then(resolve)
                        .catch(reject);
                    return;
                }

                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
        });
    }

    /**
     * Identify the type of source
     */
    identifySourceType(url, content) {
        for (const [type, config] of Object.entries(this.sourcePatterns)) {
            for (const pattern of config.patterns) {
                if (pattern.test(url) || pattern.test(content)) {
                    return {
                        type,
                        ...config,
                        matchedPattern: pattern.toString()
                    };
                }
            }
        }
        return { type: 'unknown', priority: 'low' };
    }

    /**
     * Find downloadable files
     */
    findDownloads(baseUrl, content) {
        const downloads = [];
        const baseUrlObj = new URL(baseUrl);

        // Find ZIP files
        const zipMatches = content.match(/href=["']([^"']*\.zip)["']/gi) || [];
        zipMatches.forEach(match => {
            const href = match.match(/href=["']([^"']+)["']/i)?.[1];
            if (href) {
                const fullUrl = href.startsWith('http') ? href : `${baseUrlObj.origin}${href.startsWith('/') ? '' : '/'}${href}`;
                downloads.push({
                    url: fullUrl,
                    type: 'zip',
                    name: href.split('/').pop(),
                    priority: 'high'
                });
            }
        });

        // Find CSV files
        const csvMatches = content.match(/href=["']([^"']*\.csv)["']/gi) || [];
        csvMatches.forEach(match => {
            const href = match.match(/href=["']([^"']+)["']/i)?.[1];
            if (href) {
                const fullUrl = href.startsWith('http') ? href : `${baseUrlObj.origin}${href}`;
                downloads.push({ url: fullUrl, type: 'csv', name: href.split('/').pop(), priority: 'high' });
            }
        });

        // Find TXT files (often documentation)
        const txtMatches = content.match(/href=["']([^"']*\.txt)["']/gi) || [];
        txtMatches.forEach(match => {
            const href = match.match(/href=["']([^"']+)["']/i)?.[1];
            if (href) {
                const fullUrl = href.startsWith('http') ? href : `${baseUrlObj.origin}${href}`;
                downloads.push({ url: fullUrl, type: 'txt', name: href.split('/').pop(), priority: 'medium' });
            }
        });

        // Find PDF files
        const pdfMatches = content.match(/href=["']([^"']*\.pdf)["']/gi) || [];
        pdfMatches.forEach(match => {
            const href = match.match(/href=["']([^"']+)["']/i)?.[1];
            if (href) {
                const fullUrl = href.startsWith('http') ? href : `${baseUrlObj.origin}${href}`;
                downloads.push({ url: fullUrl, type: 'pdf', name: href.split('/').pop(), priority: 'medium' });
            }
        });

        return downloads;
    }

    /**
     * Detect data fields present in the source
     */
    detectFields(content) {
        const detected = [];
        const contentLower = content.toLowerCase();

        for (const [field, config] of Object.entries(this.fieldPatterns)) {
            let matchCount = 0;
            let matchedPatterns = [];

            for (const pattern of config.patterns) {
                const matches = contentLower.match(new RegExp(pattern.source, 'gi'));
                if (matches) {
                    matchCount += matches.length;
                    matchedPatterns.push(pattern.source);
                }
            }

            if (matchCount > 0) {
                detected.push({
                    field,
                    importance: config.importance,
                    matchCount,
                    matchedPatterns,
                    confidence: Math.min(matchCount / 5, 1) // Cap at 100%
                });
            }
        }

        // Sort by importance and match count
        return detected.sort((a, b) => {
            const importanceOrder = { critical: 0, high: 1, medium: 2, low: 3 };
            if (importanceOrder[a.importance] !== importanceOrder[b.importance]) {
                return importanceOrder[a.importance] - importanceOrder[b.importance];
            }
            return b.matchCount - a.matchCount;
        });
    }

    /**
     * Find documentation files
     */
    findDocumentation(content) {
        const docs = [];

        // Look for code/readme files
        const codeFilePatterns = [
            /codes?\.txt/i,
            /readme/i,
            /documentation/i,
            /instructions/i,
            /data.*dictionary/i
        ];

        for (const pattern of codeFilePatterns) {
            if (pattern.test(content)) {
                docs.push({
                    type: 'codebook',
                    pattern: pattern.source
                });
            }
        }

        return docs;
    }

    /**
     * Estimate record count from page content
     */
    estimateRecordCount(content) {
        // Look for numbers followed by "records", "entries", "individuals", etc.
        const patterns = [
            /(\d{1,3}(?:,\d{3})*)\s*(?:records?|entries?|individuals?|persons?|slaves?|people)/gi,
            /(?:over|more than|approximately|about)\s*(\d{1,3}(?:,\d{3})*)/gi
        ];

        let maxCount = null;

        for (const pattern of patterns) {
            const matches = [...content.matchAll(pattern)];
            for (const match of matches) {
                const num = parseInt(match[1].replace(/,/g, ''), 10);
                if (!isNaN(num) && (maxCount === null || num > maxCount)) {
                    maxCount = num;
                }
            }
        }

        return maxCount;
    }

    /**
     * Assess quality indicators
     */
    assessQuality(analysis) {
        const quality = {
            hasStructuredData: false,
            hasDocumentation: false,
            hasPrimarySource: false,
            hasCodebook: false,
            fieldCoverage: 0,
            overallScore: 0
        };

        // Check for structured data
        quality.hasStructuredData = analysis.availableDownloads.some(d =>
            ['zip', 'csv', 'xlsx', 'dbf'].includes(d.type)
        );

        // Check for documentation
        quality.hasDocumentation = analysis.documentation && analysis.documentation.length > 0;

        // Check for codebook
        quality.hasCodebook = analysis.availableDownloads.some(d =>
            d.name && (/code/i.test(d.name) || /readme/i.test(d.name))
        );

        // Calculate field coverage
        const criticalFields = analysis.detectedFields.filter(f => f.importance === 'critical');
        const highFields = analysis.detectedFields.filter(f => f.importance === 'high');
        quality.fieldCoverage = (criticalFields.length * 2 + highFields.length) / 10;

        // Primary source indicators
        quality.hasPrimarySource = analysis.sourceType.priority === 'high';

        // Overall score
        let score = 0;
        if (quality.hasStructuredData) score += 30;
        if (quality.hasDocumentation) score += 15;
        if (quality.hasCodebook) score += 20;
        if (quality.hasPrimarySource) score += 20;
        score += quality.fieldCoverage * 15;
        quality.overallScore = Math.min(score, 100);

        return quality;
    }

    /**
     * Generate processing plan
     */
    generateProcessingPlan(analysis) {
        const plan = {
            strategy: null,
            steps: [],
            estimatedTime: null,
            toolsNeeded: [],
            priority: analysis.sourceType.priority
        };

        // Determine strategy based on source type
        if (analysis.availableDownloads.some(d => d.type === 'zip')) {
            plan.strategy = 'bulk_download';
            plan.steps.push('Download ZIP archive(s)');
            plan.steps.push('Extract and identify data files');
            plan.steps.push('Parse codebook/documentation');
            plan.steps.push('Import structured data');
            plan.toolsNeeded.push('adm-zip', 'dbffile', 'csv-parser');

        } else if (analysis.sourceType.type === 'familysearchFilm') {
            plan.strategy = 'authenticated_scraping';
            plan.steps.push('Authenticate with FamilySearch');
            plan.steps.push('Navigate film viewer');
            plan.steps.push('Capture images with OCR');
            plan.steps.push('Parse extracted text');
            plan.toolsNeeded.push('puppeteer', 'google-vision');

        } else if (analysis.sourceType.type === 'stateArchive') {
            plan.strategy = 'page_scraping';
            plan.steps.push('Navigate archive pages');
            plan.steps.push('Capture document images');
            plan.steps.push('Process with OCR');
            plan.steps.push('Structure extracted data');
            plan.toolsNeeded.push('puppeteer', 'tesseract');

        } else {
            plan.strategy = 'generic_extraction';
            plan.steps.push('Fetch page content');
            plan.steps.push('Extract text and structure');
            plan.steps.push('Identify persons and relationships');
            plan.toolsNeeded.push('cheerio');
        }

        // Estimate time
        if (analysis.estimatedRecordCount) {
            const recordsPerMinute = plan.strategy === 'bulk_download' ? 1000 : 10;
            plan.estimatedTime = Math.ceil(analysis.estimatedRecordCount / recordsPerMinute);
        }

        return plan;
    }

    /**
     * Determine if a custom scraper is needed
     */
    needsCustomScraper(analysis) {
        // Custom scraper needed for:
        // 1. High-value structured data with codebooks
        // 2. Sources with complex authentication
        // 3. Sources with 10,000+ records

        return (
            (analysis.qualityIndicators.hasCodebook && analysis.qualityIndicators.hasStructuredData) ||
            (analysis.sourceType.requiresAuth) ||
            (analysis.estimatedRecordCount && analysis.estimatedRecordCount > 10000)
        );
    }

    /**
     * Generate recommendations
     */
    generateRecommendations(analysis) {
        const recommendations = [];

        // High-value source
        if (analysis.qualityIndicators.overallScore >= 70) {
            recommendations.push({
                type: 'priority',
                message: 'HIGH VALUE SOURCE: Contains structured data with documentation',
                action: 'Process immediately with dedicated scraper'
            });
        }

        // Custom scraper needed
        if (analysis.customScraperNeeded) {
            recommendations.push({
                type: 'action',
                message: 'Custom scraper recommended for optimal extraction',
                action: 'Create specialized scraper for this source type'
            });
        }

        // Structured downloads available
        if (analysis.availableDownloads.length > 0) {
            const dataFiles = analysis.availableDownloads.filter(d => ['zip', 'csv', 'xlsx'].includes(d.type));
            if (dataFiles.length > 0) {
                recommendations.push({
                    type: 'data',
                    message: `Found ${dataFiles.length} downloadable data file(s)`,
                    downloads: dataFiles.map(d => d.url)
                });
            }
        }

        // Documentation available
        if (analysis.qualityIndicators.hasCodebook) {
            recommendations.push({
                type: 'info',
                message: 'Codebook/documentation available - use for field mapping',
                action: 'Parse code files before data import'
            });
        }

        // Missing critical fields
        const hasCritical = analysis.detectedFields.some(f => f.importance === 'critical');
        if (!hasCritical) {
            recommendations.push({
                type: 'warning',
                message: 'No critical fields (names) detected - may need manual review',
                action: 'Verify source contains person records'
            });
        }

        return recommendations;
    }

    /**
     * Log analysis summary
     */
    logAnalysisSummary(analysis) {
        console.log(`
${'═'.repeat(70)}
SOURCE ANALYSIS SUMMARY
${'═'.repeat(70)}

URL: ${analysis.url}
Source Type: ${analysis.sourceType.type} (${analysis.sourceType.priority} priority)
Quality Score: ${analysis.qualityIndicators.overallScore}/100

DOWNLOADS FOUND (${analysis.availableDownloads.length}):
${analysis.availableDownloads.map(d => `  - ${d.name} (${d.type})`).join('\n') || '  (none)'}

DETECTED FIELDS (${analysis.detectedFields.length}):
${analysis.detectedFields.slice(0, 8).map(f =>
    `  - ${f.field} (${f.importance}, ${(f.confidence * 100).toFixed(0)}% confidence)`
).join('\n') || '  (none)'}

PROCESSING PLAN:
  Strategy: ${analysis.processingPlan.strategy}
  Steps: ${analysis.processingPlan.steps.length}
  Tools: ${analysis.processingPlan.toolsNeeded.join(', ')}
  ${analysis.estimatedRecordCount ? `Est. Records: ${analysis.estimatedRecordCount.toLocaleString()}` : ''}

RECOMMENDATIONS:
${analysis.recommendations.map(r => `  [${r.type.toUpperCase()}] ${r.message}`).join('\n')}

Custom Scraper Needed: ${analysis.customScraperNeeded ? 'YES' : 'No'}
${'═'.repeat(70)}
`);
    }

    /**
     * Store analysis results in database
     */
    async saveAnalysis(analysis) {
        if (!this.db) return;

        try {
            await this.db.query(`
                INSERT INTO source_analyses (
                    url, source_type, quality_score, detected_fields,
                    available_downloads, processing_plan, recommendations,
                    custom_scraper_needed, analyzed_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                ON CONFLICT (url) DO UPDATE SET
                    source_type = EXCLUDED.source_type,
                    quality_score = EXCLUDED.quality_score,
                    detected_fields = EXCLUDED.detected_fields,
                    processing_plan = EXCLUDED.processing_plan,
                    recommendations = EXCLUDED.recommendations,
                    analyzed_at = NOW()
            `, [
                analysis.url,
                analysis.sourceType.type,
                analysis.qualityIndicators.overallScore,
                JSON.stringify(analysis.detectedFields),
                JSON.stringify(analysis.availableDownloads),
                JSON.stringify(analysis.processingPlan),
                JSON.stringify(analysis.recommendations),
                analysis.customScraperNeeded
            ]);
        } catch (error) {
            console.error('Failed to save analysis:', error.message);
        }
    }
}

module.exports = SourceAnalyzer;
