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
    constructor(database) {
        this.db = database;
        this.sessions = new Map(); // In-memory session cache

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
        this.archivePatterns = {
            'msa.maryland.gov': {
                archiveName: 'Maryland State Archives',
                sourceType: 'primary',
                contentAccess: 'pdf_link',
                pdfPattern: /\.\.\/pdf\/([^"']+\.pdf)/
            },
            'civilwardc.org': {
                archiveName: 'Civil War Washington DC',
                sourceType: 'primary',
                contentAccess: 'direct'
            },
            'ancestry.com': {
                archiveName: 'Ancestry.com',
                sourceType: 'secondary',
                contentAccess: 'auth_required'
            },
            'familysearch.org': {
                archiveName: 'FamilySearch',
                sourceType: 'secondary',
                contentAccess: 'mixed'
            },
            'findagrave.com': {
                archiveName: 'Find A Grave',
                sourceType: 'secondary',
                contentAccess: 'direct'
            },
            'wikipedia.org': {
                archiveName: 'Wikipedia',
                sourceType: 'tertiary',
                contentAccess: 'direct'
            }
        };
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

            // Fetch the page
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

        // Source type assessment
        const typeEmoji = {
            'primary': '**PRIMARY SOURCE** - Can CONFIRM slaveholder/enslaved relationships',
            'secondary': '**SECONDARY SOURCE** - Needs verification with primary documents',
            'tertiary': '**TERTIARY SOURCE** - Reference only, requires verification',
            'unknown': '**UNKNOWN SOURCE TYPE** - Needs your help to classify'
        };
        response += `\n${typeEmoji[analysis.sourceType] || typeEmoji.unknown}\n`;

        if (analysis.pagination.detected) {
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

        // Parse the description
        const parsed = this.parseContentDescription(userInput);

        // Initialize content structure if not exists
        if (!session.contentStructure) {
            session.contentStructure = {
                layoutType: null,
                columns: [],
                scanQuality: null,
                handwritingType: null,
                visibleArea: {},
                orientation: 'normal'
            };
        }

        // Merge parsed info
        Object.assign(session.contentStructure, parsed);

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
     * Parse natural language content description
     */
    parseContentDescription(text) {
        const parsed = {
            columns: [],
            keywords: []
        };

        const lower = text.toLowerCase();

        // Detect layout type
        if (lower.includes('table') || lower.includes('column') || lower.includes('row')) {
            parsed.layoutType = 'table';
        } else if (lower.includes('list')) {
            parsed.layoutType = 'list';
        } else if (lower.includes('paragraph') || lower.includes('text')) {
            parsed.layoutType = 'prose';
        }

        // Parse column descriptions
        // Pattern: "first column is X", "second column is Y", etc.
        const columnPattern = /(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|column\s*\d+)\s+(?:column\s+)?(?:is\s+)?(?:(?:a\s+)?(?:narrow|wide|thin)\s+)?(?:(?:column\s+)?(?:for|of|with|called|labeled|named|titled|contains?)?\s*)?([^,.]+)/gi;

        let match;
        while ((match = columnPattern.exec(text)) !== null) {
            const position = this.parseColumnPosition(match[1]);
            const description = match[2].trim();

            parsed.columns.push({
                position,
                description,
                dataType: this.inferDataType(description),
                headerGuess: this.extractHeaderGuess(description)
            });
        }

        // Detect specific data types mentioned
        if (lower.includes('owner') || lower.includes('slaveholder')) {
            parsed.keywords.push('owner');
        }
        if (lower.includes('slave') || lower.includes('enslaved')) {
            parsed.keywords.push('enslaved');
        }
        if (lower.includes('date')) {
            parsed.keywords.push('date');
        }
        if (lower.includes('age')) {
            parsed.keywords.push('age');
        }
        if (lower.includes('name')) {
            parsed.keywords.push('name');
        }

        // Detect quality indicators
        if (lower.includes('faded') || lower.includes('hard to read')) {
            parsed.scanQuality = 'fair';
        }
        if (lower.includes('illegible') || lower.includes('can\'t read')) {
            parsed.scanQuality = 'poor';
        }
        if (lower.includes('clear') || lower.includes('readable')) {
            parsed.scanQuality = 'good';
        }

        // Detect handwriting
        if (lower.includes('handwritten') || lower.includes('cursive')) {
            parsed.handwritingType = 'cursive';
        }
        if (lower.includes('printed') || lower.includes('typed')) {
            parsed.handwritingType = 'printed';
        }

        // Detect partial visibility
        const partialMatch = lower.match(/(\d+(?:\.\d+)?)\s*columns?/);
        if (partialMatch) {
            parsed.visibleArea = {
                columnsVisible: parseFloat(partialMatch[1])
            };
        }
        if (lower.includes('partial') || lower.includes('can only see') || lower.includes('sliver')) {
            parsed.hasPartialView = true;
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
     * Infer data type from description
     */
    inferDataType(description) {
        const lower = description.toLowerCase();

        if (lower.includes('owner') || lower.includes('slaveholder') || lower.includes('master')) {
            return 'owner_name';
        }
        if (lower.includes('slave') || lower.includes('enslaved')) {
            return 'enslaved_name';
        }
        if (lower.includes('date') || lower.includes('year') || lower.includes('when')) {
            return 'date';
        }
        if (lower.includes('age') || lower.includes('old')) {
            return 'age';
        }
        if (lower.includes('name')) {
            return 'name';
        }
        if (lower.includes('location') || lower.includes('county') || lower.includes('place')) {
            return 'location';
        }
        if (lower.includes('remark') || lower.includes('note') || lower.includes('comment')) {
            return 'remarks';
        }
        if (lower.includes('gender') || lower.includes('sex') || lower.includes('male') || lower.includes('female')) {
            return 'gender';
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
        if (cs.layoutType === 'table' && cs.columns.length === 0) return false;

        return true;
    }

    /**
     * Generate follow-up questions based on current knowledge
     */
    generateFollowUpQuestions(session) {
        const questions = [];
        const cs = session.contentStructure;

        // If table layout but no columns defined
        if (cs.layoutType === 'table' && cs.columns.length === 0) {
            questions.push({
                id: 'column_count',
                question: 'How many columns can you see (fully or partially)?',
                type: 'number',
                required: true
            });
        }

        // If columns defined but types unknown
        const unknownColumns = cs.columns.filter(c => c.dataType === 'unknown');
        for (const col of unknownColumns) {
            questions.push({
                id: `column_${col.position}_type`,
                question: `What does column ${col.position} contain?`,
                options: [
                    { value: 'owner_name', label: 'Slaveholder/Owner names' },
                    { value: 'enslaved_name', label: 'Enslaved person names' },
                    { value: 'date', label: 'Dates' },
                    { value: 'age', label: 'Ages' },
                    { value: 'location', label: 'Locations' },
                    { value: 'remarks', label: 'Remarks/Notes' },
                    { value: 'other', label: 'Something else' }
                ],
                required: true
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
            response += `Got it - this is a **${parsed.layoutType}** format document.\n\n`;
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

        return [
            {
                id: 'auto_ocr',
                label: 'Auto-OCR',
                description: 'I\'ll run OCR and show you results to correct',
                recommended: recommended === 'auto_ocr' || recommended === 'auto_ocr_with_review',
                bestFor: 'Clear, printed documents'
            },
            {
                id: 'guided_entry',
                label: 'Guided Entry',
                description: 'I\'ll show you the image, you type what you see row by row',
                recommended: recommended === 'guided_entry',
                bestFor: 'Difficult handwriting, high-value documents'
            },
            {
                id: 'sample_learn',
                label: 'Sample & Learn',
                description: 'You give me 5-10 example rows, I learn the pattern and extract the rest',
                recommended: false,
                bestFor: 'Consistent formatting with quirks'
            },
            {
                id: 'csv_upload',
                label: 'CSV Upload',
                description: 'You transcribe to a spreadsheet, I import it',
                recommended: false,
                bestFor: 'Already transcribed data'
            }
        ];
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

        // Create extraction job
        const extractionId = uuidv4();

        await this.db.query(`
            INSERT INTO extraction_jobs
            (extraction_id, session_id, content_url, content_type, method, status, created_at)
            VALUES ($1, $2, $3, $4, $5, 'pending', NOW())
        `, [
            extractionId,
            sessionId,
            session.sourceMetadata.contentUrl || session.url,
            session.sourceMetadata.contentType,
            method
        ]);

        session.currentStage = 'extraction_in_progress';
        session.processingInstructions = {
            extractionId,
            method,
            options,
            startedAt: new Date()
        };

        await this.updateSession(session);

        // Return immediately - extraction happens async
        return {
            session,
            extractionId,
            method,
            message: `Starting ${method} extraction. I'll show you results as they come in.`,
            nextStage: 'extraction_in_progress'
        };
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
