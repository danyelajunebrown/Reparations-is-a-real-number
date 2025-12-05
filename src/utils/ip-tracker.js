/**
 * Intellectual Property Tracker
 *
 * Monitors for copy/paste content, extended references, and data inputs
 * that should be tracked in the bibliography system.
 *
 * Integrates with:
 * - Contribution pipeline (ContributionSession)
 * - Chat/conversation interfaces
 * - Document uploads
 * - User inputs
 *
 * Key Features:
 * 1. Detects URLs and automatically flags them for citation
 * 2. Identifies long text blocks that may be quotes or data
 * 3. Recognizes academic/scholarly citation patterns
 * 4. Auto-associates with known archives (MSA, FamilySearch, etc.)
 * 5. Tracks user references for later follow-up
 */

const BibliographyManager = require('./bibliography-manager');

class IPTracker {
    constructor(pool = null) {
        this.bibliographyManager = new BibliographyManager(pool);
        this.pool = pool;

        // Thresholds for detection
        this.thresholds = {
            minTextLengthForQuote: 150, // Characters - potential quote
            minTextLengthForCopyPaste: 500, // Characters - likely copy/paste
            minUrlsForFlag: 1, // Flag if any URLs present
            minNumbersForDataFlag: 5 // Flag if many numbers (likely data)
        };

        // Session tracking for repeated references
        this.sessionReferences = new Map(); // sessionId -> references[]

        // Known archive patterns
        this.archivePatterns = {
            'msa.maryland.gov': { name: 'Maryland State Archives', type: 'primary' },
            'civilwardc.org': { name: 'Civil War DC', type: 'primary' },
            'familysearch.org': { name: 'FamilySearch', type: 'secondary' },
            'ancestry.com': { name: 'Ancestry.com', type: 'secondary' },
            'findagrave.com': { name: 'Find A Grave', type: 'secondary' },
            'archives.gov': { name: 'National Archives', type: 'primary' },
            'lva.virginia.gov': { name: 'Library of Virginia', type: 'primary' },
            'beyondkin.org': { name: 'Beyond Kin', type: 'secondary' },
            'rootsweb.com': { name: 'RootsWeb', type: 'secondary' },
            'wikipedia.org': { name: 'Wikipedia', type: 'tertiary' },
            'slavevoyages.org': { name: 'Slave Voyages', type: 'secondary' },
            'freedmensbureau.com': { name: 'Freedmen\'s Bureau', type: 'secondary' }
        };

        // Detection patterns
        this.patterns = {
            // URLs
            url: /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi,

            // Academic citations
            inTextCitation: /\([A-Z][a-z]+(?:,\s*\d{4}|\s+\d{4})\)/g,
            ibid: /\b(ibid\.?|op\.?\s*cit\.?|loc\.?\s*cit\.?)\b/gi,

            // Data patterns
            tabulatedData: /(?:^\s*(?:\d+[.,]\d*|\d+)\s*[|,\t])+/gm,
            censusCounts: /\d+\s*(?:male|female|negro|slave|person|colored)/gi,

            // Quote markers
            blockQuote: /[""][^""]{100,}[""]|'{2}[^']{100,}'{2}/g,
            attributedQuote: /(?:according to|as .+ (?:wrote|stated|noted|observed))/gi,

            // Document markers
            archiveReference: /(?:box|folder|file|series|record group|rg)\s*(?:#|number|no\.?)?\s*\d+/gi,
            pageReference: /\b(?:p\.?|pp\.?|page|pages)\s*\d+(?:-\d+)?/gi
        };
    }

    /**
     * Analyze user input for potential intellectual property references
     * Returns flags and suggestions
     */
    analyzeInput(text, context = {}) {
        const flags = [];
        const suggestions = [];

        if (!text || typeof text !== 'string') {
            return { flags, suggestions, hasReferences: false };
        }

        // 1. Detect URLs
        const urls = text.match(this.patterns.url) || [];
        urls.forEach(url => {
            const archiveInfo = this.identifyArchive(url);
            flags.push({
                type: 'url',
                content: url,
                archive: archiveInfo?.name || null,
                sourceType: archiveInfo?.type || 'unknown',
                priority: archiveInfo ? 'high' : 'medium',
                action: 'add_to_bibliography'
            });

            if (archiveInfo) {
                suggestions.push({
                    message: `URL from ${archiveInfo.name} detected - this is a ${archiveInfo.type} source`,
                    action: 'auto_cite'
                });
            }
        });

        // 2. Detect long text blocks (potential copy/paste)
        if (text.length >= this.thresholds.minTextLengthForCopyPaste) {
            // Check for signs of copied content
            const hasMultipleParagraphs = (text.match(/\n\n+/g) || []).length >= 2;
            const hasFormattedData = this.patterns.tabulatedData.test(text);
            const hasQuotes = this.patterns.blockQuote.test(text);

            if (hasMultipleParagraphs || hasFormattedData || hasQuotes) {
                flags.push({
                    type: 'copy_paste',
                    content: text.substring(0, 200) + '...',
                    length: text.length,
                    hasData: hasFormattedData,
                    hasQuotes: hasQuotes,
                    priority: 'high',
                    action: 'flag_for_citation'
                });

                suggestions.push({
                    message: 'Long text block detected - please provide source information',
                    action: 'prompt_for_source'
                });
            }
        }

        // 3. Detect academic citation patterns
        const inTextCitations = text.match(this.patterns.inTextCitation) || [];
        if (inTextCitations.length > 0) {
            flags.push({
                type: 'academic_citation',
                citations: inTextCitations,
                count: inTextCitations.length,
                priority: 'medium',
                action: 'add_to_bibliography'
            });

            suggestions.push({
                message: `Found ${inTextCitations.length} academic citation(s) - consider adding to bibliography`,
                action: 'parse_citations'
            });
        }

        // 4. Detect census/statistical data
        const censusMatches = text.match(this.patterns.censusCounts) || [];
        if (censusMatches.length >= 3) {
            flags.push({
                type: 'census_data',
                patterns: censusMatches,
                priority: 'high',
                action: 'flag_for_citation'
            });

            suggestions.push({
                message: 'Census or statistical data detected - primary source citation required',
                action: 'prompt_for_census_source'
            });
        }

        // 5. Detect archive references
        const archiveRefs = text.match(this.patterns.archiveReference) || [];
        if (archiveRefs.length > 0) {
            flags.push({
                type: 'archive_reference',
                references: archiveRefs,
                priority: 'medium',
                action: 'add_to_bibliography'
            });
        }

        // 6. Track in session if context provided
        if (context.sessionId) {
            this.trackSessionReference(context.sessionId, {
                text: text.substring(0, 500),
                flags,
                timestamp: new Date().toISOString(),
                context
            });
        }

        return {
            flags,
            suggestions,
            hasReferences: flags.length > 0,
            summary: this.generateSummary(flags),
            autoActions: this.determineAutoActions(flags)
        };
    }

    /**
     * Identify which archive a URL belongs to
     */
    identifyArchive(url) {
        try {
            const hostname = new URL(url).hostname.toLowerCase();

            for (const [pattern, info] of Object.entries(this.archivePatterns)) {
                if (hostname.includes(pattern)) {
                    return info;
                }
            }
        } catch (e) {
            // Invalid URL
        }
        return null;
    }

    /**
     * Generate summary of detected references
     */
    generateSummary(flags) {
        if (flags.length === 0) {
            return 'No intellectual property references detected';
        }

        const types = [...new Set(flags.map(f => f.type))];
        const highPriority = flags.filter(f => f.priority === 'high').length;

        let summary = `Detected ${flags.length} reference(s): `;
        summary += types.join(', ');

        if (highPriority > 0) {
            summary += ` (${highPriority} high priority)`;
        }

        return summary;
    }

    /**
     * Determine automatic actions based on flags
     */
    determineAutoActions(flags) {
        const actions = [];

        // Auto-add URLs from known archives
        flags.filter(f => f.type === 'url' && f.archive).forEach(flag => {
            actions.push({
                action: 'auto_add_bibliography',
                data: {
                    url: flag.content,
                    archiveName: flag.archive,
                    sourceType: flag.sourceType
                }
            });
        });

        // Flag copy/paste for manual review
        flags.filter(f => f.type === 'copy_paste').forEach(flag => {
            actions.push({
                action: 'create_pending_citation',
                data: {
                    type: 'copy-paste',
                    context: flag.content,
                    needsReview: true
                }
            });
        });

        return actions;
    }

    /**
     * Track references within a session (for repeated references)
     */
    trackSessionReference(sessionId, reference) {
        if (!this.sessionReferences.has(sessionId)) {
            this.sessionReferences.set(sessionId, []);
        }

        const refs = this.sessionReferences.get(sessionId);
        refs.push(reference);

        // Check for repeated references (same source mentioned multiple times)
        const urlCounts = {};
        refs.forEach(r => {
            r.flags.filter(f => f.type === 'url').forEach(f => {
                urlCounts[f.content] = (urlCounts[f.content] || 0) + 1;
            });
        });

        // Flag sources mentioned 3+ times as important
        const repeatedSources = Object.entries(urlCounts)
            .filter(([url, count]) => count >= 3)
            .map(([url, count]) => ({ url, count }));

        return repeatedSources;
    }

    /**
     * Get session summary for bibliography follow-up
     */
    getSessionSummary(sessionId) {
        const refs = this.sessionReferences.get(sessionId) || [];

        // Aggregate all flags
        const allFlags = refs.flatMap(r => r.flags);

        // Group by type
        const byType = {};
        allFlags.forEach(flag => {
            if (!byType[flag.type]) {
                byType[flag.type] = [];
            }
            byType[flag.type].push(flag);
        });

        // Count unique URLs
        const uniqueUrls = [...new Set(
            allFlags.filter(f => f.type === 'url').map(f => f.content)
        )];

        return {
            sessionId,
            totalReferences: refs.length,
            uniqueUrls: uniqueUrls.length,
            byType,
            pendingCitations: allFlags.filter(f => f.priority === 'high').length,
            needsFollowUp: allFlags.some(f => f.action === 'flag_for_citation')
        };
    }

    /**
     * Process and auto-flag detected references
     * Returns pending citations created
     */
    async processAndFlag(text, context = {}) {
        const analysis = this.analyzeInput(text, context);

        const pending = [];

        for (const action of analysis.autoActions) {
            if (action.action === 'auto_add_bibliography' && action.data.url) {
                // Check if already in bibliography
                const existing = await this.bibliographyManager.getAllEntries({
                    search: action.data.url
                });

                if (existing.length === 0) {
                    // Add to bibliography
                    const entry = await this.bibliographyManager.addEntry({
                        title: `Reference from ${action.data.archiveName}`,
                        sourceType: action.data.sourceType,
                        category: 'archives',
                        url: action.data.url,
                        archiveName: action.data.archiveName,
                        addedBy: context.userId || 'ip_tracker'
                    });

                    pending.push({
                        type: 'added',
                        entry
                    });
                }
            }

            if (action.action === 'create_pending_citation') {
                const pendingCitation = await this.bibliographyManager.flagPendingCitation({
                    title: 'Detected Reference',
                    type: action.data.type,
                    context: action.data.context,
                    usedIn: context.location ? [context.location] : [],
                    flaggedBy: 'ip_tracker'
                });

                pending.push({
                    type: 'pending',
                    citation: pendingCitation
                });
            }
        }

        return {
            analysis,
            created: pending
        };
    }

    /**
     * Analyze a contribution session for IP references
     */
    async analyzeContributionSession(session) {
        const allText = [
            session.sourceMetadata?.url || '',
            session.sourceMetadata?.archiveName || '',
            session.sourceMetadata?.collectionName || '',
            session.contentDescription || '',
            ...(session.messages || []).map(m => m.content || '')
        ].join(' ');

        const analysis = this.analyzeInput(allText, {
            sessionId: session.sessionId,
            location: 'contribution_session'
        });

        // Auto-add the source URL if it's a known archive
        if (session.sourceMetadata?.url) {
            const archiveInfo = this.identifyArchive(session.sourceMetadata.url);
            if (archiveInfo) {
                await this.bibliographyManager.addEntry({
                    title: session.sourceMetadata.documentTitle ||
                           `Document from ${archiveInfo.name}`,
                    sourceType: archiveInfo.type,
                    category: 'archives',
                    url: session.sourceMetadata.url,
                    archiveName: archiveInfo.name,
                    collectionName: session.sourceMetadata.collectionName,
                    collectionId: session.sourceMetadata.collectionId,
                    description: session.contentDescription,
                    addedBy: session.userId || 'contribution_pipeline',
                    usedIn: [session.sessionId]
                });
            }
        }

        return analysis;
    }

    /**
     * Clear session tracking
     */
    clearSession(sessionId) {
        this.sessionReferences.delete(sessionId);
    }

    /**
     * Get all active sessions with pending references
     */
    getActiveSessionsWithPending() {
        const sessions = [];

        for (const [sessionId, refs] of this.sessionReferences.entries()) {
            const hasHighPriority = refs.some(r =>
                r.flags.some(f => f.priority === 'high')
            );

            if (hasHighPriority) {
                sessions.push({
                    sessionId,
                    referenceCount: refs.length,
                    highPriorityCount: refs.filter(r =>
                        r.flags.some(f => f.priority === 'high')
                    ).length
                });
            }
        }

        return sessions;
    }
}

// Export for different environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = IPTracker;
} else if (typeof window !== 'undefined') {
    window.IPTracker = IPTracker;
}
