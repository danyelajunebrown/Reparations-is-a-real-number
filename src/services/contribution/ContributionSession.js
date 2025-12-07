/**
 * ContributionSession - Conversational Contribute Pipeline
 *
 * This service manages the human-guided contribution flow:
 * 1. URL Analysis - What kind of source is this?
 * 2. Content Description - Human describes what they see
 * 3. Structure Confirmation - System confirms understanding
 * 4. Extraction Strategy - Choose approach based on quality
 * 5. Iterative Extraction - OCR with human correction
 * 6. Validation & Storage - Final review and commit
 *
 * Key principle: Human expertise is the INPUT, not the backup.
 * Every correction becomes training data for future extractions.
 */

const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const cheerio = require('cheerio');

class ContributionSession {
    constructor(database, extractionWorker = null) {
        this.db = database;
        this.sessions = new Map(); // In-memory session cache
        this.extractionWorker = extractionWorker;

        // Stage definitions
        this.stages = [
            'url_analysis',
            'content_description',
            'structure_confirmation',
            'extraction_strategy',
            'extraction_in_progress',
            'human_review',
            'final_validation',
            'complete'
        ];

        // Document type classifications
        this.documentTypes = {
            primary: [
                'slave_schedule', 'compensation_petition', 'slave_manifest',
                'bill_of_sale', 'will_testament', 'estate_inventory',
                'court_record', 'tax_record', 'birth_register', 'death_register',
                'marriage_record', 'manumission_deed', 'runaway_advertisement',
                'plantation_record'
            ],
            secondary: [
                'genealogy_database', 'compiled_index', 'transcription',
                'family_tree', 'memorial', 'biographical_sketch'
            ],
            tertiary: [
                'encyclopedia', 'historical_article', 'academic_paper', 'book_excerpt'
            ]
        };

        // Known archive patterns for auto-detection
        // NOTE: sourceType describes the ARCHIVE TYPE, not confirmation status
        // Confirmation is ONLY determined by actual document content analysis
        this.archivePatterns = {
            'msa.maryland.gov': {
                archiveName: 'Maryland State Archives',
                sourceType: 'primary',  // Government archive - MAY contain primary docs
                contentAccess: 'pdf_link',
                pdfPattern: /\.\.\/pdf\/([^"']+\.pdf)/
            },
            'civilwardc.org': {
                archiveName: 'Civil War Washington DC',
                sourceType: 'primary',  // Government archive - MAY contain primary docs
                contentAccess: 'direct'
            },
            'ancestry.com': {
                archiveName: 'Ancestry.com',
                sourceType: 'secondary',  // Genealogy database
                contentAccess: 'auth_required'
            },
            'familysearch.org': {
                archiveName: 'FamilySearch',
                sourceType: 'secondary',  // Genealogy database
                contentAccess: 'mixed'
            },
            'findagrave.com': {
                archiveName: 'Find A Grave',
                sourceType: 'secondary',  // Memorial database
                contentAccess: 'direct'
            },
            'wikipedia.org': {
                archiveName: 'Wikipedia',
                sourceType: 'tertiary',  // Encyclopedia
                contentAccess: 'direct'
            }
        };

        // Confirmatory channels - ways that data can be confirmed
        // This list is designed to grow as new confirmation methods are added
        this.confirmatoryChannels = [
            {
                id: 'human_transcription',
                name: 'Human Transcription',
                description: 'User manually transcribed names from document',
                confidenceWeight: 0.95
            },
            {
                id: 'ocr_verified',
                name: 'OCR + Human Verification',
                description: 'OCR extraction reviewed and corrected by human',
                confidenceWeight: 0.90
            },
            {
                id: 'ocr_high_confidence',
                name: 'High-Confidence OCR',
                description: 'OCR extraction with >= 95% confidence score',
                confidenceWeight: 0.75
            },
            {
                id: 'page_metadata',
                name: 'Page Metadata',
                description: 'Structured data found on the hosting page',
                confidenceWeight: 0.60
            },
            {
                id: 'cross_reference',
                name: 'Cross-Reference Match',
                description: 'Name matches existing confirmed record',
                confidenceWeight: 0.70
            }
            // Add new confirmatory channels here as they become available
        ];
    }

    /**
     * Create a new contribution session
     */
    async createSession(url, contributorId = null) {
        const sessionId = uuidv4();

        const session = {
            sessionId,
            url,
            contributorId,
            currentStage: 'url_analysis',
            conversationHistory: [],
            sourceMetadata: null,
            contentStructure: null,
            extractionGuidance: null,
            processingInstructions: null,
            extractionResults: null,
            status: 'in_progress',
            createdAt: new Date(),
            updatedAt: new Date()
        };

        // Store in database
        await this.db.query(`
            INSERT INTO contribution_sessions
            (session_id, url, contributor_id, current_stage, status, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [sessionId, url, contributorId, 'url_analysis', 'in_progress', session.createdAt, session.updatedAt]);

        // Cache in memory
        this.sessions.set(sessionId, session);

        return session;
    }

    /**
     * Get session by ID
     */
    async getSession(sessionId) {
        // Check cache first
        if (this.sessions.has(sessionId)) {
            return this.sessions.get(sessionId);
        }

        // Load from database
        const result = await this.db.query(`
            SELECT * FROM contribution_sessions WHERE session_id = $1
        `, [sessionId]);

        if (result.rows.length === 0) {
            return null;
        }

        const row = result.rows[0];
        const session = {
            sessionId: row.session_id,
            url: row.url,
            contributorId: row.contributor_id,
            currentStage: row.current_stage,
            conversationHistory: row.conversation_history || [],
            sourceMetadata: row.source_metadata,
            contentStructure: row.content_structure,
            extractionGuidance: row.extraction_guidance,
            processingInstructions: row.processing_instructions,
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };

        this.sessions.set(sessionId, session);
        return session;
    }

    /**
     * Update session in database
     */
    async updateSession(session) {
        session.updatedAt = new Date();

        await this.db.query(`
            UPDATE contribution_sessions SET
                current_stage = $2,
                conversation_history = $3,
                source_metadata = $4,
                content_structure = $5,
                extraction_guidance = $6,
                processing_instructions = $7,
                status = $8,
                updated_at = $9
            WHERE session_id = $1
        `, [
            session.sessionId,
            session.currentStage,
            JSON.stringify(session.conversationHistory),
            JSON.stringify(session.sourceMetadata),
            JSON.stringify(session.contentStructure),
            JSON.stringify(session.extractionGuidance),
            JSON.stringify(session.processingInstructions),
            session.status,
            session.updatedAt
        ]);

        this.sessions.set(session.sessionId, session);
    }

    /**
     * Add message to conversation history
     */
    addToConversation(session, role, message, metadata = {}) {
        session.conversationHistory.push({
            role, // 'user' | 'system' | 'assistant'
            message,
            metadata,
            timestamp: new Date().toISOString()
        });
    }

    // ========================================
    // STAGE 1: URL ANALYSIS
    // ========================================

    /**
     * Analyze a submitted URL
     * Returns structured analysis and initial questions
     */
    async analyzeUrl(sessionId) {
        const session = await this.getSession(sessionId);
        if (!session) throw new Error('Session not found');

        const url = session.url;
        const analysis = {
            url,
            finalUrl: url,
            domain: null,
            archiveName: null,
            documentTitle: null,
            sourceType: 'unknown',
            contentAccess: 'unknown',
            contentUrl: null,
            hasIframe: false,
            hasPdfLink: false,
            pageTitle: null,
            contentType: 'unknown',
            pagination: { detected: false, currentPage: null, totalPages: null },
            errors: []
        };

        try {
            // Parse domain
            const urlObj = new URL(url);
            analysis.domain = urlObj.hostname.replace('www.', '');

            // Check known archives
            for (const [pattern, config] of Object.entries(this.archivePatterns)) {
                if (analysis.domain.includes(pattern)) {
                    Object.assign(analysis, config);
                    break;
                }
            }

            // SMART PDF DETECTION: Check if URL is a direct PDF link
            // This prevents timeout when trying to download large PDFs
            const isPdfUrl = url.toLowerCase().endsWith('.pdf') ||
                            url.toLowerCase().includes('.pdf?') ||
                            urlObj.pathname.toLowerCase().endsWith('.pdf');

            if (isPdfUrl) {
                // Direct PDF URL - don't download, just record metadata
                console.log(`[ContributionSession] Direct PDF detected: ${url}`);
                analysis.contentType = 'pdf';
                analysis.contentUrl = url;
                analysis.hasPdfLink = true;
                analysis.contentAccess = 'direct_pdf';
                analysis.pageTitle = urlObj.pathname.split('/').pop().replace('.pdf', '');
                analysis.documentTitle = analysis.pageTitle;

                // Try a HEAD request to get file size (with short timeout)
                try {
                    const headResponse = await axios.head(url, {
                        timeout: 5000,
                        headers: {
                            'User-Agent': 'Reparations Research Bot (Historical Genealogy Research)'
                        }
                    });
                    analysis.contentLength = headResponse.headers['content-length'];
                    analysis.lastModified = headResponse.headers['last-modified'];
                } catch (headError) {
                    // HEAD request failed - that's okay, proceed without size info
                    console.log(`[ContributionSession] HEAD request failed (likely protected): ${headError.message}`);
                    analysis.contentAccess = 'protected_pdf';
                }

                // Skip HTML parsing - go straight to storing analysis
            } else {
                // Not a direct PDF - fetch the HTML page
                const response = await axios.get(url, {
                    timeout: 30000,
                    headers: {
                        'User-Agent': 'Reparations Research Bot (Historical Genealogy Research)'
                    },
                    maxRedirects: 5
                });

                analysis.finalUrl = response.request.res.responseUrl || url;
                const html = response.data;
                const $ = cheerio.load(html);

                // Extract page title
                analysis.pageTitle = $('title').text().trim();

                // Look for document title in common patterns
                analysis.documentTitle = this.extractDocumentTitle($, analysis.domain);

                // Detect iframes
                const iframes = $('iframe');
                if (iframes.length > 0) {
                    analysis.hasIframe = true;
                    analysis.iframeSrc = iframes.first().attr('src');
                }

                // Detect PDF links (common in archives)
                const pdfLinks = $('a[href*=".pdf"]');
                if (pdfLinks.length > 0) {
                    analysis.hasPdfLink = true;
                    const pdfHref = pdfLinks.first().attr('href');
                    analysis.contentUrl = this.resolveUrl(pdfHref, url);
                }

                // Special handling for Maryland State Archives
                if (analysis.domain.includes('msa.maryland.gov')) {
                    const pdfMatch = html.match(/href="([^"]*\.pdf)"/i);
                    if (pdfMatch) {
                        analysis.contentUrl = this.resolveUrl(pdfMatch[1], url);
                        analysis.contentAccess = 'pdf_link';
                    }

                    // Extract collection info from URL
                    const collectionMatch = url.match(/sc(\d+)\/sc(\d+)\/(\d+)\/(\d+)/);
                    if (collectionMatch) {
                        analysis.collectionId = `sc${collectionMatch[1]}/sc${collectionMatch[2]}/${collectionMatch[3]}/${collectionMatch[4]}`;
                    }
                }

                // Detect pagination
                analysis.pagination = this.detectPagination($, url);

                // Determine content type
                analysis.contentType = this.determineContentType(analysis);
            }

        } catch (error) {
            analysis.errors.push({
                stage: 'url_fetch',
                message: error.message
            });
        }

        // Store analysis
        session.sourceMetadata = analysis;
        session.currentStage = 'content_description';

        // Generate response message
        const responseMessage = this.generateAnalysisResponse(analysis);

        this.addToConversation(session, 'system', responseMessage, { analysisComplete: true });
        await this.updateSession(session);

        return {
            session,
            analysis,
            message: responseMessage,
            nextStage: 'content_description',
            questions: this.generateInitialQuestions(analysis)
        };
    }

    /**
     * Extract document title from page
     */
    extractDocumentTitle($, domain) {
        // Try common patterns
        const selectors = [
            'h1',
            '.document-title',
            '.page-title',
            '#title',
            'meta[property="og:title"]',
            'meta[name="title"]'
        ];

        for (const selector of selectors) {
            const el = $(selector).first();
            if (el.length) {
                const text = el.attr('content') || el.text();
                if (text && text.trim().length > 0 && text.trim().length < 200) {
                    return text.trim();
                }
            }
        }

        return null;
    }

    /**
     * Detect pagination patterns
     */
    detectPagination($, url) {
        const pagination = {
            detected: false,
            currentPage: null,
            totalPages: null,
            pattern: null,
            nextUrl: null,
            prevUrl: null
        };

        // Look for page numbers in URL
        const pageMatch = url.match(/--(\d+)\.html$/);
        if (pageMatch) {
            pagination.detected = true;
            pagination.currentPage = parseInt(pageMatch[1]);
            pagination.pattern = url.replace(/--\d+\.html$/, '--{page}.html');
        }

        // Look for next/prev links
        const nextLink = $('a:contains("Next")').attr('href') ||
                         $('a[rel="next"]').attr('href');
        const prevLink = $('a:contains("Previous")').attr('href') ||
                         $('a[rel="prev"]').attr('href');

        if (nextLink) {
            pagination.detected = true;
            pagination.nextUrl = this.resolveUrl(nextLink, url);
        }
        if (prevLink) {
            pagination.prevUrl = this.resolveUrl(prevLink, url);
        }

        return pagination;
    }

    /**
     * Determine content type from analysis
     */
    determineContentType(analysis) {
        if (analysis.contentUrl && analysis.contentUrl.endsWith('.pdf')) {
            return 'pdf';
        }
        if (analysis.hasIframe) {
            return 'iframe';
        }
        if (analysis.domain.includes('wikipedia')) {
            return 'html_article';
        }
        return 'html_page';
    }

    /**
     * Resolve relative URL to absolute
     */
    resolveUrl(href, baseUrl) {
        if (!href) return null;
        if (href.startsWith('http')) return href;

        try {
            return new URL(href, baseUrl).href;
        } catch {
            return null;
        }
    }

    /**
     * Generate human-readable analysis response
     */
    generateAnalysisResponse(analysis) {
        let response = `I've analyzed this URL. Here's what I found:\n\n`;

        response += `**Source:** ${analysis.archiveName || analysis.domain}\n`;

        if (analysis.documentTitle) {
            response += `**Document:** ${analysis.documentTitle}\n`;
        }

        if (analysis.contentUrl) {
            response += `**Content:** The actual document is a ${analysis.contentType === 'pdf' ? 'PDF' : 'separate file'}\n`;
        }

        if (analysis.hasIframe) {
            response += `**Note:** Content is loaded in an iframe\n`;
        }

        // Source type assessment - describes WHERE the document is from, NOT confirmation status
        // Confirmation can ONLY come from actual document content (OCR, human input, etc.)
        const typeDescriptions = {
            'primary': '**GOVERNMENT/INSTITUTIONAL ARCHIVE** - May contain primary source documents',
            'secondary': '**GENEALOGY DATABASE** - Compiled/indexed records',
            'tertiary': '**REFERENCE SOURCE** - Encyclopedia or article',
            'unknown': '**UNKNOWN SOURCE TYPE** - Needs your help to classify'
        };
        response += `\n${typeDescriptions[analysis.sourceType] || typeDescriptions.unknown}\n`;
        response += `\n*Note: Document confirmation status will be determined by the actual content, not the source domain.*\n`;

        if (analysis.pagination?.detected) {
            response += `\n**Pagination:** This appears to be page ${analysis.pagination.currentPage || '?'} of a multi-page document\n`;
        }

        if (analysis.errors.length > 0) {
            response += `\n**Issues:** ${analysis.errors.map(e => e.message).join(', ')}\n`;
        }

        response += `\nBefore I try to extract data, I need to understand what you're seeing. Can you describe the document layout?`;

        return response;
    }

    /**
     * Generate initial clarifying questions
     */
    generateInitialQuestions(analysis) {
        const questions = [];

        // Always ask about layout
        questions.push({
            id: 'layout_type',
            question: 'What type of layout do you see?',
            options: [
                { value: 'table', label: 'Table with columns and rows' },
                { value: 'list', label: 'List of names/entries' },
                { value: 'prose', label: 'Paragraph text / narrative' },
                { value: 'form', label: 'Filled-out form' },
                { value: 'image_only', label: 'Just an image / scan' },
                { value: 'mixed', label: 'Mix of different formats' }
            ],
            required: true
        });

        // If PDF or scanned document
        if (analysis.contentType === 'pdf' || analysis.contentUrl?.endsWith('.pdf')) {
            questions.push({
                id: 'scan_quality',
                question: 'How is the document quality?',
                options: [
                    { value: 'excellent', label: 'Excellent - very clear' },
                    { value: 'good', label: 'Good - mostly readable' },
                    { value: 'fair', label: 'Fair - some parts hard to read' },
                    { value: 'poor', label: 'Poor - significant portions illegible' }
                ],
                required: true
            });

            questions.push({
                id: 'handwriting_type',
                question: 'Is the document handwritten or printed?',
                options: [
                    { value: 'printed', label: 'Printed / Typed' },
                    { value: 'cursive', label: 'Handwritten - Cursive' },
                    { value: 'print_hand', label: 'Handwritten - Print/Block' },
                    { value: 'mixed', label: 'Mix of printed and handwritten' }
                ],
                required: true
            });
        }

        // Source type confirmation if unknown
        if (analysis.sourceType === 'unknown') {
            questions.push({
                id: 'source_type',
                question: 'What type of source is this?',
                options: [
                    { value: 'primary', label: 'Primary - Original historical document (census, deed, will, petition)' },
                    { value: 'secondary', label: 'Secondary - Database, index, or transcription' },
                    { value: 'tertiary', label: 'Tertiary - Encyclopedia, article, or summary' }
                ],
                required: true
            });
        }

        return questions;
    }

    // ========================================
    // STAGE 2: CONTENT DESCRIPTION
    // ========================================

    /**
     * Process user's description of what they see
     */
    async processContentDescription(sessionId, userInput) {
        const session = await this.getSession(sessionId);
        if (!session) throw new Error('Session not found');

        // Add user message to conversation
        this.addToConversation(session, 'user', userInput);

        // Parse the description - captures EVERYTHING
        const parsed = this.parseContentDescription(userInput);

        // Initialize content structure if not exists
        if (!session.contentStructure) {
            session.contentStructure = {
                layoutType: null,
                columns: [],
                scanQuality: null,
                handwritingType: null,
                visibleArea: {},
                orientation: 'normal',
                physicalDescription: {},
                auxiliaryData: {},
                humanReadings: [],
                rawInputHistory: []
            };
        }

        // CRITICAL: Store the raw input - never lose human-provided data
        session.contentStructure.rawInputHistory = session.contentStructure.rawInputHistory || [];
        session.contentStructure.rawInputHistory.push({
            input: userInput,
            timestamp: new Date().toISOString(),
            parsed: parsed
        });

        // Merge parsed info (preserving arrays by concatenation)
        if (parsed.columns && parsed.columns.length > 0) {
            session.contentStructure.columns = parsed.columns;
        }
        if (parsed.layoutType) session.contentStructure.layoutType = parsed.layoutType;
        if (parsed.scanQuality) session.contentStructure.scanQuality = parsed.scanQuality;
        if (parsed.handwritingType) session.contentStructure.handwritingType = parsed.handwritingType;
        if (parsed.visibleArea) session.contentStructure.visibleArea = parsed.visibleArea;
        if (parsed.hasPartialView) session.contentStructure.hasPartialView = parsed.hasPartialView;

        // Merge physical description
        if (parsed.physicalDescription) {
            session.contentStructure.physicalDescription = {
                ...session.contentStructure.physicalDescription,
                ...parsed.physicalDescription
            };
        }

        // Merge auxiliary data (deep merge to preserve all collected info)
        if (parsed.auxiliaryData) {
            session.contentStructure.auxiliaryData = this.deepMerge(
                session.contentStructure.auxiliaryData || {},
                parsed.auxiliaryData
            );
        }

        // Append human readings (never overwrite - accumulate)
        if (parsed.humanReadings && parsed.humanReadings.length > 0) {
            session.contentStructure.humanReadings = [
                ...(session.contentStructure.humanReadings || []),
                ...parsed.humanReadings
            ];
        }

        // Merge keywords (unique only)
        if (parsed.keywords && parsed.keywords.length > 0) {
            const existingKeywords = session.contentStructure.keywords || [];
            session.contentStructure.keywords = [...new Set([...existingKeywords, ...parsed.keywords])];
        }

        // Stockpile auxiliary data to database for future use
        await this.stockpileAuxiliaryData(session, parsed);

        // Generate follow-up questions based on what we learned
        const followUp = this.generateFollowUpQuestions(session);

        // Generate response
        let response = this.generateDescriptionResponse(parsed, followUp);

        this.addToConversation(session, 'assistant', response);

        // Advance stage if we have enough info
        if (this.hasEnoughContentInfo(session)) {
            session.currentStage = 'structure_confirmation';
        }

        await this.updateSession(session);

        return {
            session,
            parsed,
            message: response,
            questions: followUp.questions,
            nextStage: session.currentStage
        };
    }

    /**
     * Deep merge two objects, concatenating arrays
     */
    deepMerge(target, source) {
        const result = { ...target };
        for (const key of Object.keys(source)) {
            if (Array.isArray(source[key])) {
                result[key] = [...(target[key] || []), ...source[key]];
            } else if (source[key] && typeof source[key] === 'object') {
                result[key] = this.deepMerge(target[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }
        return result;
    }

    /**
     * Stockpile auxiliary data to database for future reference
     * This preserves ALL human-provided information, even if not immediately used
     */
    async stockpileAuxiliaryData(session, parsed) {
        try {
            // Store raw human input as OCR training data
            if (parsed.humanReadings && parsed.humanReadings.length > 0) {
                for (const reading of parsed.humanReadings) {
                    await this.db.query(`
                        INSERT INTO human_readings
                        (session_id, document_url, reading_type, exact_text, confidence, metadata, created_at)
                        VALUES ($1, $2, $3, $4, $5, $6, NOW())
                        ON CONFLICT DO NOTHING
                    `, [
                        session.sessionId,
                        session.url,
                        reading.type,
                        JSON.stringify(reading.exactText),
                        reading.confidence,
                        JSON.stringify(reading)
                    ]);
                }
            }

            // Store auxiliary data for the document
            if (parsed.auxiliaryData && Object.keys(parsed.auxiliaryData).length > 0) {
                await this.db.query(`
                    INSERT INTO document_auxiliary_data
                    (session_id, document_url, data_type, data_content, raw_input, created_at)
                    VALUES ($1, $2, 'parsed_auxiliary', $3, $4, NOW())
                `, [
                    session.sessionId,
                    session.url,
                    JSON.stringify(parsed.auxiliaryData),
                    parsed.rawHumanInput
                ]);
            }

            // Store physical description
            if (parsed.physicalDescription && Object.keys(parsed.physicalDescription).length > 0) {
                await this.db.query(`
                    INSERT INTO document_auxiliary_data
                    (session_id, document_url, data_type, data_content, raw_input, created_at)
                    VALUES ($1, $2, 'physical_description', $3, $4, NOW())
                `, [
                    session.sessionId,
                    session.url,
                    JSON.stringify(parsed.physicalDescription),
                    parsed.rawHumanInput
                ]);
            }
        } catch (error) {
            // Log but don't fail - stockpiling is enhancement, not critical path
            console.error('Error stockpiling auxiliary data:', error.message);
            // Tables might not exist yet - that's okay
        }
    }

    /**
     * Parse natural language content description
     *
     * DESIGN PRINCIPLE: Every piece of human-provided information is precious.
     * We capture EVERYTHING - even details we don't immediately use - because:
     * 1. Human readings serve as ground truth for OCR validation/training
     * 2. "Irrelevant" details (printers, dimensions, military columns) may be
     *    invaluable for future research, cross-referencing, or system improvements
     * 3. The human took time to provide this - never discard it
     */
    parseContentDescription(text) {
        const parsed = {
            // Always store the raw input - this is sacred
            rawHumanInput: text,
            rawInputTimestamp: new Date().toISOString(),

            // Structured extractions
            columns: [],
            keywords: [],

            // Document physical characteristics
            physicalDescription: {},

            // All extracted details, even "unused" ones
            auxiliaryData: {},

            // Human-provided exact text (OCR ground truth)
            humanReadings: []
        };

        const lower = text.toLowerCase();

        // ========================================
        // LAYOUT DETECTION
        // ========================================
        // Check for explicit layout_type answer first (from frontend form)
        const layoutTypeMatch = text.match(/layout_type:\s*(prose|table|list|form|image_only|mixed)/i);
        if (layoutTypeMatch) {
            parsed.layoutType = layoutTypeMatch[1].toLowerCase();
        }
        // Check for negative patterns first ("not tables", "no table")
        else if (lower.match(/\b(?:not?\s+table|no\s+table|isn't\s+(?:a\s+)?table|aren't\s+tables)/)) {
            parsed.layoutType = 'prose';
        }
        // Check for "narrative" or "prose" explicitly
        else if (lower.includes('narrative') || lower.includes('prose')) {
            parsed.layoutType = 'prose';
        }
        // Check for paragraph text indicators
        else if (lower.includes('paragraph') && !lower.includes('table')) {
            parsed.layoutType = 'prose';
        }
        // Only then check for table indicators
        else if (lower.includes('table') || lower.includes('column') || lower.includes('row')) {
            parsed.layoutType = 'table';
        } else if (lower.includes('list')) {
            parsed.layoutType = 'list';
        } else if (lower.includes('text') && !lower.match(/\bcolumn|row|table\b/)) {
            parsed.layoutType = 'prose';
        }

        // Detect book/page layout
        if (lower.includes('open book') || lower.includes('two pages') || lower.includes('spread')) {
            parsed.physicalDescription.layout = 'book_spread';
            parsed.physicalDescription.pagesVisible = 2;
        }
        if (lower.includes('spine')) {
            parsed.physicalDescription.hasSpine = true;
        }
        if (lower.includes('spreads across') || lower.includes('spans both')) {
            parsed.physicalDescription.contentSpansBothPages = true;
        }

        // ========================================
        // COLUMN HEADER EXTRACTION (EXACT TEXT)
        // ========================================
        // Look for quoted column headers - these are GROUND TRUTH
        // This is the preferred parsing method when user uses quotes
        const quotedHeaders = text.match(/"([^"]+)"/g);
        if (quotedHeaders && quotedHeaders.length > 0) {
            const headers = quotedHeaders.map(h => h.replace(/"/g, '').trim());

            parsed.humanReadings.push({
                type: 'column_headers',
                exactText: headers,
                confidence: 'human_provided'
            });

            // Use quoted headers as column definitions (prioritize over unquoted parsing)
            parsed.columns = headers.map((header, idx) => ({
                position: idx + 1,
                headerExact: header,
                headerGuess: header,
                dataType: this.inferDataType(header),
                humanProvided: true
            }));
        }

        // Parse column headers from structured lists ONLY if no quoted headers found
        // (e.g., "from left to right: Date, Owner, Slave")
        if (parsed.columns.length === 0) {
            const headerListMatch = text.match(/(?:from left to right|columns?(?:\s+are)?|headings?(?:\s+are)?)[:\s]+([^#\n]+)/i);
            if (headerListMatch) {
                const headerText = headerListMatch[1];
                // Split by comma or semicolon (NOT period - too common in abbreviations)
                const headers = headerText.split(/[,;]/)
                    .map(h => h.trim())
                    .filter(h => h.length > 0 && h.length < 100);

                if (headers.length > 0) {
                    parsed.columns = headers.map((header, idx) => ({
                        position: idx + 1,
                        headerExact: header,
                        headerGuess: header,
                        dataType: this.inferDataType(header),
                        humanProvided: true
                    }));

                    parsed.humanReadings.push({
                        type: 'column_header_sequence',
                        exactText: headers,
                        confidence: 'human_provided'
                    });
                }
            }
        }

        // Detect subcolumns (e.g., "(sub columns Day. Month. Year.)")
        const subcolumnMatch = text.match(/\(sub\s*columns?\s+([^)]+)\)/gi);
        if (subcolumnMatch) {
            subcolumnMatch.forEach(match => {
                const subCols = match.match(/\(sub\s*columns?\s+([^)]+)\)/i);
                if (subCols) {
                    const parentContext = text.substring(
                        Math.max(0, text.indexOf(match) - 100),
                        text.indexOf(match)
                    );

                    parsed.auxiliaryData.subcolumns = parsed.auxiliaryData.subcolumns || [];
                    parsed.auxiliaryData.subcolumns.push({
                        parentContext: parentContext.trim(),
                        subcolumnNames: subCols[1].split(/[.,]/).map(s => s.trim()).filter(s => s)
                    });
                }
            });
        }

        // ========================================
        // PHYSICAL DIMENSIONS
        // ========================================
        const dimensionMatch = text.match(/(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)\s*(inches?|in|cm|mm|pixels?|px)?/i);
        if (dimensionMatch) {
            parsed.physicalDescription.dimensions = {
                width: parseFloat(dimensionMatch[1]),
                height: parseFloat(dimensionMatch[2]),
                unit: dimensionMatch[3] || 'unknown'
            };
        }

        // ========================================
        // PRINTER/PUBLISHER INFORMATION
        // ========================================
        const printerMatch = text.match(/(?:printer|publisher|printed by|published by)[:\s]+([^.;\n]+)/i);
        if (printerMatch) {
            parsed.auxiliaryData.printer = printerMatch[1].trim();
        }

        // Also catch inline mentions like "Murphy & Co Printers"
        const printerInlineMatch = text.match(/([A-Z][a-z]+(?:\s*&\s*[A-Z][a-z]+)?(?:\s+(?:Printers?|Publishers?|Stationers?|Co\.?))+[^.]*)/);
        if (printerInlineMatch) {
            parsed.auxiliaryData.printer = parsed.auxiliaryData.printer || printerInlineMatch[1].trim();
            parsed.humanReadings.push({
                type: 'printer_text',
                exactText: printerInlineMatch[1].trim(),
                confidence: 'human_provided',
                note: 'Fine print detected'
            });
        }

        // ========================================
        // QUALITY & LEGIBILITY DETAILS
        // ========================================
        if (lower.includes('faded') || lower.includes('hard to read')) {
            parsed.scanQuality = 'fair';
        }
        if (lower.includes('illegible') || lower.includes('can\'t read') || lower.includes('cannot read')) {
            parsed.scanQuality = 'poor';
        }
        if (lower.includes('clear') || lower.includes('readable')) {
            parsed.scanQuality = 'good';
        }
        if (lower.includes('excellent') || lower.includes('very clear')) {
            parsed.scanQuality = 'excellent';
        }

        // Capture specific legibility notes
        const legibilityMatch = text.match(/(?:only|except|but)\s+(?:the\s+)?([^.]+?)(?:gets?\s+)?(?:blurry|faded|illegible|hard to read)/i);
        if (legibilityMatch) {
            parsed.auxiliaryData.legibilityNotes = parsed.auxiliaryData.legibilityNotes || [];
            parsed.auxiliaryData.legibilityNotes.push({
                issue: 'partial_illegibility',
                description: legibilityMatch[1].trim(),
                fullContext: legibilityMatch[0]
            });
        }

        // ========================================
        // HANDWRITING TYPE
        // ========================================
        if (lower.includes('handwritten') || lower.includes('cursive')) {
            parsed.handwritingType = 'cursive';
        }
        if (lower.includes('printed') || lower.includes('typed') || lower.includes('typewritten')) {
            parsed.handwritingType = 'printed';
        }

        // Detect mixed (e.g., "entries are handwritten, column titles are typewritten")
        if ((lower.includes('entries') || lower.includes('data')) &&
            (lower.includes('handwritten') || lower.includes('cursive')) &&
            (lower.includes('titles') || lower.includes('headers') || lower.includes('headings')) &&
            (lower.includes('printed') || lower.includes('typed'))) {
            parsed.handwritingType = 'mixed';
            parsed.auxiliaryData.handwritingDetails = {
                entries: 'handwritten',
                headers: 'printed'
            };
        }

        // ========================================
        // MILITARY / CIVIL WAR SPECIFIC DATA
        // ========================================
        const militaryKeywords = ['military', 'regiment', 'enlisted', 'u.s. service', 'compensation', 'servitude'];
        const foundMilitaryKeywords = militaryKeywords.filter(kw => lower.includes(kw));
        if (foundMilitaryKeywords.length > 0) {
            parsed.auxiliaryData.militaryContext = {
                detected: true,
                keywords: foundMilitaryKeywords
            };

            // This is likely a Civil War compensation record
            if (lower.includes('compensation') && lower.includes('military')) {
                parsed.auxiliaryData.documentSubtype = 'civil_war_compensation_record';
            }
        }

        // ========================================
        // DATE DETECTION
        // ========================================
        const datePatterns = [
            /\b(18\d{2})\b/g,  // Years like 1860
            /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s*\d{4}/gi
        ];

        parsed.auxiliaryData.datesFound = [];
        for (const pattern of datePatterns) {
            let dateMatch;
            while ((dateMatch = pattern.exec(text)) !== null) {
                parsed.auxiliaryData.datesFound.push(dateMatch[0]);
            }
        }

        // ========================================
        // KEYWORD EXTRACTION (EXPANDED)
        // ========================================
        const keywordMap = {
            'owner': ['owner', 'slaveholder', 'master', 'former ownership'],
            'enslaved': ['slave', 'enslaved', 'servant', 'negro', 'colored'],
            'date': ['date', 'day', 'month', 'year', 'when'],
            'age': ['age', 'years old'],
            'name': ['name'],
            'location': ['location', 'county', 'place', 'residence', 'address'],
            'gender': ['sex', 'gender', 'male', 'female', 'm', 'f'],
            'physical': ['physical', 'condition', 'description', 'complexion', 'height'],
            'military': ['military', 'regiment', 'enlisted', 'service'],
            'compensation': ['compensation', 'payment', 'received', 'amount'],
            'witness': ['witness', 'proven', 'attested', 'sworn']
        };

        for (const [category, terms] of Object.entries(keywordMap)) {
            for (const term of terms) {
                if (lower.includes(term)) {
                    if (!parsed.keywords.includes(category)) {
                        parsed.keywords.push(category);
                    }
                }
            }
        }

        // ========================================
        // PARTIAL VISIBILITY
        // ========================================
        const partialMatch = lower.match(/(\d+(?:\.\d+)?)\s*columns?/);
        if (partialMatch) {
            parsed.visibleArea = {
                columnsVisible: parseFloat(partialMatch[1])
            };
        }
        if (lower.includes('partial') || lower.includes('can only see') || lower.includes('sliver')) {
            parsed.hasPartialView = true;
        }

        // ========================================
        // ANNOTATION MARKERS (for special sections)
        // ========================================
        // Detect user's structured markers like #LAYOUT#, #QUALITY#, etc.
        const markerPattern = /#([A-Z]+)#\s*([^#]+?)(?=#[A-Z]+#|$)/gi;
        let markerMatch;
        while ((markerMatch = markerPattern.exec(text)) !== null) {
            const markerName = markerMatch[1].toLowerCase();
            const markerContent = markerMatch[2].trim();
            parsed.auxiliaryData.userMarkers = parsed.auxiliaryData.userMarkers || {};
            parsed.auxiliaryData.userMarkers[markerName] = markerContent;
        }

        return parsed;
    }

    /**
     * Parse column position from text
     */
    parseColumnPosition(text) {
        const positions = {
            'first': 1, '1st': 1, 'column 1': 1,
            'second': 2, '2nd': 2, 'column 2': 2,
            'third': 3, '3rd': 3, 'column 3': 3,
            'fourth': 4, '4th': 4, 'column 4': 4,
            'fifth': 5, '5th': 5, 'column 5': 5
        };
        return positions[text.toLowerCase()] || parseInt(text.match(/\d+/)?.[0]) || null;
    }

    /**
     * Infer data type from description/header text
     */
    inferDataType(description) {
        const lower = description.toLowerCase();

        // Owner/slaveholder identification
        if (lower.includes('owner') || lower.includes('slaveholder') || lower.includes('master')) {
            return 'owner_name';
        }
        // Enslaved person identification
        if (lower.includes('slave') || lower.includes('enslaved')) {
            return 'enslaved_name';
        }
        // Date fields
        if (lower.includes('date') || lower === 'day' || lower === 'month' || lower === 'year' || lower.includes('when')) {
            return 'date';
        }
        // Age
        if (lower.includes('age') || lower.includes('old')) {
            return 'age';
        }
        // Gender/Sex
        if (lower.includes('gender') || lower === 'sex' || lower === 'sex.') {
            return 'gender';
        }
        // Physical condition/description
        if (lower.includes('physical') || lower.includes('condition') || lower.includes('complexion') || lower.includes('description')) {
            return 'physical_condition';
        }
        // Term of service/servitude
        if (lower.includes('term') || lower.includes('servitude') || lower.includes('service')) {
            return 'term_of_service';
        }
        // Military/regiment
        if (lower.includes('regiment') || lower.includes('military') || lower.includes('enlisted') || lower.includes('u.s. service')) {
            return 'military';
        }
        // Compensation
        if (lower.includes('compensation') || lower.includes('payment') || lower.includes('received')) {
            return 'compensation';
        }
        // Witness/proof
        if (lower.includes('witness') || lower.includes('proven') || lower.includes('ownership proven') || lower.includes('by whom')) {
            return 'witness';
        }
        // Generic name field
        if (lower.includes('name')) {
            return 'name';
        }
        // Location
        if (lower.includes('location') || lower.includes('county') || lower.includes('place')) {
            return 'location';
        }
        // Remarks/notes
        if (lower.includes('remark') || lower.includes('note') || lower.includes('comment')) {
            return 'remarks';
        }

        return 'unknown';
    }

    /**
     * Extract likely header text from description
     */
    extractHeaderGuess(description) {
        // Look for quoted text or ALL CAPS
        const quoted = description.match(/"([^"]+)"|'([^']+)'/);
        if (quoted) return quoted[1] || quoted[2];

        const caps = description.match(/\b([A-Z]{2,}(?:\s+[A-Z]{2,})*)\b/);
        if (caps) return caps[1];

        return null;
    }

    /**
     * Check if we have enough content info to proceed
     */
    hasEnoughContentInfo(session) {
        const cs = session.contentStructure;
        if (!cs) return false;

        // Need layout type at minimum
        if (!cs.layoutType) return false;

        // For tables, need at least some column info
        if (cs.layoutType === 'table' && (!cs.columns || cs.columns.length === 0)) return false;

        return true;
    }

    /**
     * Generate follow-up questions based on current knowledge
     */
    generateFollowUpQuestions(session) {
        const questions = [];
        const cs = session.contentStructure;

        // Safety check - ensure contentStructure exists
        if (!cs) {
            return { questions: [], complete: false };
        }

        // If table layout but no columns defined
        if (cs.layoutType === 'table' && (!cs.columns || cs.columns.length === 0)) {
            questions.push({
                id: 'column_count',
                question: 'How many columns can you see (fully or partially)?',
                type: 'number',
                required: true
            });
        }

        // If columns defined but types unknown - limit to first 3 unknown columns
        // to avoid overwhelming the user with too many questions
        const unknownColumns = (cs.columns || []).filter(c => c.dataType === 'unknown').slice(0, 3);
        for (const col of unknownColumns) {
            const headerHint = col.headerGuess ? ` ("${col.headerGuess}")` : '';
            questions.push({
                id: `column_${col.position}_type`,
                question: `What does column ${col.position}${headerHint} contain?`,
                options: [
                    { value: 'owner_name', label: 'Slaveholder/Owner names' },
                    { value: 'enslaved_name', label: 'Enslaved person names' },
                    { value: 'date', label: 'Dates' },
                    { value: 'age', label: 'Ages' },
                    { value: 'gender', label: 'Gender/Sex' },
                    { value: 'location', label: 'Locations' },
                    { value: 'physical_condition', label: 'Physical condition' },
                    { value: 'military', label: 'Military/Regiment info' },
                    { value: 'compensation', label: 'Compensation amounts' },
                    { value: 'remarks', label: 'Remarks/Notes' },
                    { value: 'other', label: 'Something else (can ignore)' }
                ],
                required: false  // Not required - user can skip if unclear
            });
        }

        // If quality not assessed
        if (!cs.scanQuality) {
            questions.push({
                id: 'scan_quality',
                question: 'Overall, how legible is the document?',
                options: [
                    { value: 'excellent', label: 'Excellent - very clear' },
                    { value: 'good', label: 'Good - mostly readable' },
                    { value: 'fair', label: 'Fair - some parts hard to read' },
                    { value: 'poor', label: 'Poor - significant portions illegible' }
                ],
                required: true
            });
        }

        return { questions, complete: questions.length === 0 };
    }

    /**
     * Generate response to content description
     */
    generateDescriptionResponse(parsed, followUp) {
        let response = '';

        if (parsed.layoutType) {
            if (parsed.layoutType === 'prose') {
                response += `Got it - this is a **narrative/prose** document (not tabular).\n\n`;
                response += `I'll use AI-powered entity extraction to identify:\n`;
                response += `- Slaveholder names\n`;
                response += `- Enslaved persons\n`;
                response += `- Dates and transactions\n`;
                response += `- Relationships and context\n\n`;
            } else {
                response += `Got it - this is a **${parsed.layoutType}** format document.\n\n`;
            }
        }

        if (parsed.columns.length > 0) {
            response += `I understood these columns:\n`;
            response += `| Position | Type | Header |\n`;
            response += `|----------|------|--------|\n`;
            for (const col of parsed.columns) {
                response += `| ${col.position} | ${col.dataType} | ${col.headerGuess || '?'} |\n`;
            }
            response += '\n';
        }

        if (parsed.scanQuality) {
            response += `Quality assessment: **${parsed.scanQuality}**\n`;
        }

        if (parsed.hasPartialView) {
            response += `\nI noticed you mentioned a partial view - I'll account for that in extraction.\n`;
        }

        if (followUp.questions.length > 0) {
            response += `\nI have a few more questions to make sure I understand correctly:\n`;
        } else {
            response += `\nI think I have enough information to proceed. Let me confirm the structure with you.`;
        }

        return response;
    }

    // ========================================
    // STAGE 3: STRUCTURE CONFIRMATION
    // ========================================

    /**
     * Present structure summary for user confirmation
     */
    async confirmStructure(sessionId, userConfirmation) {
        const session = await this.getSession(sessionId);
        if (!session) throw new Error('Session not found');

        // If user provides corrections, apply them
        if (userConfirmation.corrections) {
            this.applyStructureCorrections(session, userConfirmation.corrections);
        }

        // Generate extraction guidance from confirmed structure
        session.extractionGuidance = this.generateExtractionGuidance(session);

        // Move to extraction strategy stage
        session.currentStage = 'extraction_strategy';

        const response = this.generateStructureConfirmation(session);
        this.addToConversation(session, 'assistant', response);

        await this.updateSession(session);

        return {
            session,
            message: response,
            extractionOptions: this.getExtractionOptions(session),
            nextStage: 'extraction_strategy'
        };
    }

    /**
     * Apply corrections to content structure
     */
    applyStructureCorrections(session, corrections) {
        const cs = session.contentStructure;

        for (const [key, value] of Object.entries(corrections)) {
            if (key.startsWith('column_')) {
                const colNum = parseInt(key.match(/column_(\d+)/)[1]);
                const col = cs.columns.find(c => c.position === colNum);
                if (col) {
                    if (key.includes('_type')) col.dataType = value;
                    if (key.includes('_header')) col.headerGuess = value;
                }
            } else {
                cs[key] = value;
            }
        }
    }

    /**
     * Generate extraction guidance from structure
     */
    generateExtractionGuidance(session) {
        const cs = session.contentStructure;
        const sm = session.sourceMetadata;

        return {
            containsOwners: cs.columns.some(c => c.dataType === 'owner_name'),
            containsEnslaved: cs.columns.some(c => c.dataType === 'enslaved_name'),
            containsDates: cs.columns.some(c => c.dataType === 'date'),
            containsAges: cs.columns.some(c => c.dataType === 'age'),
            containsLocations: cs.columns.some(c => c.dataType === 'location'),

            ownerColumnIndex: cs.columns.find(c => c.dataType === 'owner_name')?.position,
            enslavedColumnIndex: cs.columns.find(c => c.dataType === 'enslaved_name')?.position,

            expectedDifficulty: this.assessExtractionDifficulty(cs),
            recommendedMethod: this.recommendExtractionMethod(cs, sm),

            columnMapping: cs.columns.reduce((acc, col) => {
                acc[col.position] = col.dataType;
                return acc;
            }, {})
        };
    }

    /**
     * Assess how difficult extraction will be
     */
    assessExtractionDifficulty(contentStructure) {
        let score = 0;

        if (contentStructure.scanQuality === 'poor') score += 3;
        else if (contentStructure.scanQuality === 'fair') score += 2;
        else if (contentStructure.scanQuality === 'good') score += 1;

        if (contentStructure.handwritingType === 'cursive') score += 2;
        else if (contentStructure.handwritingType === 'mixed') score += 1;

        if (contentStructure.hasPartialView) score += 1;

        if (score >= 5) return 'high';
        if (score >= 3) return 'medium';
        return 'low';
    }

    /**
     * Recommend extraction method based on assessment
     */
    recommendExtractionMethod(contentStructure, sourceMetadata) {
        const difficulty = this.assessExtractionDifficulty(contentStructure);

        if (difficulty === 'high') {
            return 'guided_entry';
        }

        if (difficulty === 'medium') {
            return 'auto_ocr_with_review';
        }

        if (sourceMetadata?.contentType === 'html_page') {
            return 'html_extraction';
        }

        return 'auto_ocr';
    }

    /**
     * Generate structure confirmation message
     */
    generateStructureConfirmation(session) {
        const cs = session.contentStructure;
        const eg = session.extractionGuidance;

        let response = `**Structure Confirmed**\n\n`;

        response += `**Document Layout:** ${cs.layoutType}\n`;
        response += `**Quality:** ${cs.scanQuality || 'Not assessed'}\n`;
        response += `**Handwriting:** ${cs.handwritingType || 'Not specified'}\n\n`;

        if (cs.columns.length > 0) {
            response += `**Column Mapping:**\n`;
            for (const col of cs.columns) {
                const icon = col.dataType === 'owner_name' ? '**' :
                            col.dataType === 'enslaved_name' ? '**' : '';
                response += `  Column ${col.position}: ${icon}${col.dataType}${icon}`;
                if (col.headerGuess) response += ` (${col.headerGuess})`;
                response += '\n';
            }
            response += '\n';
        }

        response += `**Extraction Assessment:**\n`;
        response += `  Difficulty: ${eg.expectedDifficulty}\n`;
        response += `  Recommended approach: ${eg.recommendedMethod}\n\n`;

        response += `How would you like to proceed?`;

        return response;
    }

    /**
     * Get available extraction options
     */
    getExtractionOptions(session) {
        const eg = session.extractionGuidance;
        const recommended = eg.recommendedMethod;

        // Check if this is a protected URL (like Maryland Archives)
        const isProtectedUrl = session.sourceMetadata?.domain?.includes('msa.maryland.gov') ||
                             session.sourceMetadata?.domain?.includes('ancestry.com');

        return [
            {
                id: 'auto_ocr',
                label: 'Auto-OCR',
                description: 'I\'ll run OCR and show you results to correct',
                recommended: recommended === 'auto_ocr' || recommended === 'auto_ocr_with_review',
                bestFor: 'Clear, printed documents from accessible URLs',
                available: !isProtectedUrl // Not available for protected sites
            },
            {
                id: 'browser_based_ocr',
                label: 'Browser-Based OCR',
                description: 'Use browser automation to access protected documents',
                recommended: isProtectedUrl, // Recommended for protected URLs
                bestFor: 'Websites that block direct downloads (like Maryland Archives)',
                available: true
            },
            {
                id: 'manual_text',
                label: 'Manual Text Copy',
                description: 'Copy and paste text from the document yourself',
                recommended: false,
                bestFor: 'When you can access the document but automation fails',
                available: true
            },
            {
                id: 'screenshot_upload',
                label: 'Screenshot Upload',
                description: 'Upload screenshots of the document pages',
                recommended: false,
                bestFor: 'Multi-page documents or complex layouts',
                available: true
            },
            {
                id: 'guided_entry',
                label: 'Guided Entry',
                description: 'I\'ll show you the image, you type what you see row by row',
                recommended: recommended === 'guided_entry',
                bestFor: 'Difficult handwriting, high-value documents',
                available: true
            },
            {
                id: 'sample_learn',
                label: 'Sample & Learn',
                description: 'You give me 5-10 example rows, I learn the pattern and extract the rest',
                recommended: false,
                bestFor: 'Consistent formatting with quirks',
                available: true
            },
            {
                id: 'csv_upload',
                label: 'CSV Upload',
                description: 'You transcribe to a spreadsheet, I import it',
                recommended: false,
                bestFor: 'Already transcribed data',
                available: true
            }
        ].filter(option => option.available !== false); // Filter out unavailable options
    }

    // ========================================
    // STAGE 4: EXTRACTION STRATEGY
    // ========================================

    /**
     * Start extraction with chosen method
     */
    async startExtraction(sessionId, method, options = {}) {
        const session = await this.getSession(sessionId);
        if (!session) throw new Error('Session not found');

        // Create extraction job with options stored in ocr_config
        const extractionId = uuidv4();

        await this.db.query(`
            INSERT INTO extraction_jobs
            (extraction_id, session_id, content_url, content_type, method, status, ocr_config, created_at)
            VALUES ($1, $2, $3, $4, $5, 'pending', $6, NOW())
        `, [
            extractionId,
            sessionId,
            session.sourceMetadata.contentUrl || session.url,
            session.sourceMetadata.contentType,
            method,
            JSON.stringify(options) // Store page selection and other options
        ]);

        session.currentStage = 'extraction_in_progress';
        session.processingInstructions = {
            extractionId,
            method,
            options,
            startedAt: new Date()
        };

        await this.updateSession(session);

        // Trigger actual OCR extraction based on method
        if (this.extractionWorker) {
            try {
                if (method === 'auto_ocr') {
                    // Don't await - let it run async
                    this.extractionWorker.processExtraction(extractionId).catch(err => {
                        console.error('Auto OCR extraction failed:', err);
                        this.handleExtractionError(extractionId, err, method);
                    });
                }
                else if (method === 'browser_based_ocr') {
                    // Don't await - let it run async
                    this.extractionWorker.processBrowserBasedExtraction(extractionId).catch(err => {
                        console.error('Browser-based OCR extraction failed:', err);
                        this.handleExtractionError(extractionId, err, method);
                    });
                }
                else if (method === 'manual_text') {
                    // Manual text processing will be handled separately
                    await this.db.query(`
                        UPDATE extraction_jobs
                        SET status = 'awaiting_manual_input', status_message = 'Waiting for user to provide text'
                        WHERE extraction_id = $1
                    `, [extractionId]);
                }
                else if (method === 'screenshot_upload') {
                    // Screenshot upload will be handled separately
                    await this.db.query(`
                        UPDATE extraction_jobs
                        SET status = 'awaiting_upload', status_message = 'Waiting for user to upload screenshots'
                        WHERE extraction_id = $1
                    `, [extractionId]);
                }
            } catch (error) {
                console.error('Extraction startup failed:', error);
                await this.db.query(`
                    UPDATE extraction_jobs
                    SET status = 'failed', error_message = $1
                    WHERE extraction_id = $2
                `, [error.message, extractionId]);
            }
        }

        // Return immediately - extraction happens async
        return {
            session,
            extractionId,
            method,
            message: this.generateExtractionStartMessage(method),
            nextStage: 'extraction_in_progress'
        };
    }

    /**
     * Handle extraction errors and provide fallback options
     */
    async handleExtractionError(extractionId, error, attemptedMethod) {
        const errorMessage = error.message || 'Unknown extraction error';

        // Update job status
        await this.db.query(`
            UPDATE extraction_jobs
            SET status = 'failed', error_message = $1
            WHERE extraction_id = $2
        `, [errorMessage, extractionId]);

        // Check if this was a download failure (403)
        if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
            // For protected URLs, suggest browser-based OCR
            await this.db.query(`
                UPDATE extraction_jobs
                SET suggested_fallback = 'browser_based_ocr',
                    status_message = 'Direct download failed. Try: browser_based_ocr'
                WHERE extraction_id = $1
            `, [extractionId]);
        }
    }

    /**
     * Generate appropriate start message for each extraction method
     */
    generateExtractionStartMessage(method) {
        const messages = {
            'auto_ocr': 'Starting auto-OCR extraction. I\'ll show you results as they come in.',
            'browser_based_ocr': 'Starting browser-based OCR. This may take a moment as I navigate to the protected document...',
            'manual_text': 'Ready for manual text input. Please copy and paste the document text when ready.',
            'screenshot_upload': 'Ready for screenshot upload. Please upload document images when ready.',
            'guided_entry': 'Starting guided entry mode. I\'ll show you the document and guide you through data entry.',
            'sample_learn': 'Starting sample & learn mode. Please provide 5-10 example rows to teach me the pattern.',
            'csv_upload': 'Ready for CSV upload. Please upload your transcribed spreadsheet when ready.'
        };

        return messages[method] || `Starting ${method} extraction. I'll show you results as they come in.`;
    }

    // ========================================
    // ALTERNATIVE EXTRACTION METHODS
    // ========================================

    /**
     * Process manually copied text when PDF download fails
     */
    async processManualText(extractionId, text) {
        try {
            // Get extraction job
            const jobResult = await this.db.query(`
                SELECT * FROM extraction_jobs WHERE extraction_id = $1
            `, [extractionId]);

            if (jobResult.rows.length === 0) {
                throw new Error('Extraction job not found');
            }

            const job = jobResult.rows[0];
            const session = await this.getSession(job.session_id);

            // Get column structure
            const columns = session.contentStructure?.columns || [];

            // Process text using OCR processor
            const ocrResults = await this.extractionWorker.runOCR(Buffer.from(text, 'utf8'));

            // Parse OCR text into rows
            const parsedRows = await this.extractionWorker.parseOCRtoRows(ocrResults.text, columns);

            // Calculate average confidence
            const avgConfidence = parsedRows.length > 0
                ? parsedRows.reduce((sum, row) => sum + row.confidence, 0) / parsedRows.length
                : 0;

            // Update job with results
            await this.db.query(`
                UPDATE extraction_jobs
                SET
                    status = 'completed',
                    progress = 100,
                    raw_ocr_text = $1,
                    parsed_rows = $2,
                    row_count = $3,
                    avg_confidence = $4,
                    completed_at = NOW()
                WHERE extraction_id = $5
            `, [
                ocrResults.text,
                JSON.stringify(parsedRows),
                parsedRows.length,
                parseFloat(avgConfidence.toFixed(2)),
                extractionId
            ]);

            return {
                success: true,
                rowCount: parsedRows.length,
                avgConfidence,
                parsedRows
            };

        } catch (error) {
            console.error('Manual text processing error:', error);
            throw error;
        }
    }

    /**
     * Process uploaded screenshots when PDF download fails
     */
    async processScreenshots(extractionId, imageFiles) {
        try {
            // Get extraction job
            const jobResult = await this.db.query(`
                SELECT * FROM extraction_jobs WHERE extraction_id = $1
            `, [extractionId]);

            if (jobResult.rows.length === 0) {
                throw new Error('Extraction job not found');
            }

            const job = jobResult.rows[0];
            const session = await this.getSession(job.session_id);

            // Get column structure
            const columns = session.contentStructure?.columns || [];

            // Process each image
            const allParsedRows = [];
            let combinedText = '';

            for (const file of imageFiles) {
                // Process image using OCR processor
                const ocrResults = await this.extractionWorker.runOCR(file.buffer);

                // Parse OCR text into rows
                const parsedRows = await this.extractionWorker.parseOCRtoRows(ocrResults.text, columns);

                // Add to combined results
                allParsedRows.push(...parsedRows);
                combinedText += ocrResults.text + '\n\n';
            }

            // Calculate average confidence
            const avgConfidence = allParsedRows.length > 0
                ? allParsedRows.reduce((sum, row) => sum + row.confidence, 0) / allParsedRows.length
                : 0;

            // Update job with results
            await this.db.query(`
                UPDATE extraction_jobs
                SET
                    status = 'completed',
                    progress = 100,
                    raw_ocr_text = $1,
                    parsed_rows = $2,
                    row_count = $3,
                    avg_confidence = $4,
                    completed_at = NOW()
                WHERE extraction_id = $5
            `, [
                combinedText,
                JSON.stringify(allParsedRows),
                allParsedRows.length,
                parseFloat(avgConfidence.toFixed(2)),
                extractionId
            ]);

            return {
                success: true,
                rowCount: allParsedRows.length,
                avgConfidence,
                parsedRows: allParsedRows
            };

        } catch (error) {
            console.error('Screenshot processing error:', error);
            throw error;
        }
    }

    // ========================================
    // UTILITY METHODS
    // ========================================

    /**
     * Get session summary for display
     */
    getSessionSummary(session) {
        return {
            sessionId: session.sessionId,
            url: session.url,
            stage: session.currentStage,
            stageIndex: this.stages.indexOf(session.currentStage),
            totalStages: this.stages.length,
            source: session.sourceMetadata?.archiveName || session.sourceMetadata?.domain,
            documentTitle: session.sourceMetadata?.documentTitle,
            status: session.status,
            messageCount: session.conversationHistory.length,
            lastActivity: session.updatedAt
        };
    }
}

module.exports = ContributionSession;
