/**
 * Bibliography Manager
 *
 * Comprehensive system for tracking all intellectual sources, databases,
 * archives, researchers, technologies, and contributors to the project.
 *
 * Features:
 * - Tracks pending citations (flagged but not yet fully cited)
 * - Detects copy/paste patterns that suggest external sources
 * - Formats citations in multiple academic styles (APA, Chicago, MLA, BibTeX)
 * - Tracks source relationships and dependencies
 * - Maintains contributor/participant records
 */

const crypto = require('crypto');

class BibliographyManager {
    constructor(pool = null) {
        this.pool = pool;

        // Source type hierarchy
        this.sourceTypes = {
            primary: {
                description: 'Original documents, firsthand accounts',
                confidence: 0.95,
                examples: ['wills', 'census records', 'slave schedules', 'estate inventories']
            },
            secondary: {
                description: 'Compiled data, digitized collections, databases',
                confidence: 0.75,
                examples: ['genealogy databases', 'compiled indexes', 'transcriptions']
            },
            tertiary: {
                description: 'Reference works, encyclopedias',
                confidence: 0.50,
                examples: ['Wikipedia', 'encyclopedias', 'textbooks']
            },
            technology: {
                description: 'Software libraries, APIs, tools',
                confidence: 1.0,
                examples: ['OCR services', 'blockchain', 'NLP libraries']
            },
            intellectual: {
                description: 'Researchers, scholars, thought leaders',
                confidence: 0.90,
                examples: ['researchers', 'advisors', 'historians']
            }
        };

        // Known archives with citation templates
        this.knownArchives = {
            'msa.maryland.gov': {
                name: 'Maryland State Archives',
                location: 'Annapolis, MD',
                citationTemplate: (doc) =>
                    `Maryland State Archives. "${doc.title || 'Document'}." ${doc.collection || 'Collection'}. MSA, Annapolis, MD. ${doc.url || ''}`
            },
            'civilwardc.org': {
                name: 'Civil War Washington',
                location: 'Washington, DC',
                institution: 'George Washington University',
                citationTemplate: (doc) =>
                    `Civil War Washington. "${doc.title || 'Document'}." George Washington University, Washington, DC. ${doc.url || ''}`
            },
            'familysearch.org': {
                name: 'FamilySearch',
                location: 'Salt Lake City, UT',
                institution: 'The Church of Jesus Christ of Latter-day Saints',
                citationTemplate: (doc) =>
                    `FamilySearch. "${doc.title || 'Record'}." The Church of Jesus Christ of Latter-day Saints, Salt Lake City, UT. ${doc.url || ''} (accessed ${new Date().toLocaleDateString()}).`
            },
            'ancestry.com': {
                name: 'Ancestry.com',
                location: 'Lehi, UT',
                citationTemplate: (doc) =>
                    `Ancestry.com. "${doc.title || 'Record'}." Ancestry.com Operations, Inc., Lehi, UT. ${doc.url || ''} (accessed ${new Date().toLocaleDateString()}).`
            },
            'archives.gov': {
                name: 'National Archives and Records Administration',
                location: 'Washington, DC',
                citationTemplate: (doc) =>
                    `National Archives and Records Administration. "${doc.title || 'Record'}." NARA, Washington, DC. ${doc.recordGroup ? `Record Group ${doc.recordGroup}.` : ''} ${doc.url || ''}`
            },
            'findagrave.com': {
                name: 'Find A Grave',
                citationTemplate: (doc) =>
                    `Find A Grave. "${doc.title || 'Memorial'}." Ancestry.com Operations, Inc. ${doc.url || ''} (accessed ${new Date().toLocaleDateString()}).`
            },
            'beyondkin.org': {
                name: 'Beyond Kin',
                citationTemplate: (doc) =>
                    `Beyond Kin. "${doc.title || 'Enslaved Populations Directory Entry'}." ${doc.url || ''} (accessed ${new Date().toLocaleDateString()}).`
            },
            'rootsweb.com': {
                name: 'RootsWeb',
                citationTemplate: (doc) =>
                    `${doc.author || 'RootsWeb contributor'}. "${doc.title || 'Page'}." RootsWeb. ${doc.url || ''} (accessed ${new Date().toLocaleDateString()}).`
            },
            'wikipedia.org': {
                name: 'Wikipedia',
                citationTemplate: (doc) =>
                    `Wikipedia contributors. "${doc.title || 'Article'}." Wikipedia, The Free Encyclopedia. ${doc.url || ''} (accessed ${new Date().toLocaleDateString()}).`
            }
        };

        // Patterns that suggest copy/pasted content
        this.copyPasteIndicators = [
            // URLs in text
            /https?:\/\/[^\s]+/g,
            // Citation markers
            /\[citation needed\]/gi,
            /\[\d+\]/g,
            // Academic phrasing
            /according to [A-Z][a-z]+ \(\d{4}\)/g,
            /as [A-Z][a-z]+ notes/gi,
            // Quoted text blocks
            /"[^"]{100,}"/g,
            // Reference numbers
            /\(p\.\s*\d+\)/g,
            /\(pp\.\s*\d+-\d+\)/g,
            // Data patterns suggesting tables
            /\|\s*[^|]+\s*\|/g,
            // Structured data formats
            /^\s*\d+\.\s+[A-Z]/gm
        ];

        // In-memory storage (fallback when no database)
        this.inMemoryStore = {
            entries: [],
            pending: [],
            participants: [],
            copyPasteFlags: []
        };
    }

    /**
     * Generate a unique bibliography entry ID
     */
    generateId(prefix = 'bib') {
        return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
    }

    /**
     * Add a new bibliography entry
     */
    async addEntry(entry) {
        const id = this.generateId();
        const now = new Date().toISOString();

        const bibliographyEntry = {
            id,
            title: entry.title,
            sourceType: entry.sourceType || 'secondary',
            category: entry.category || 'general',

            // Source details
            author: entry.author,
            url: entry.url,
            archiveName: entry.archiveName,
            collectionName: entry.collectionName,
            collectionId: entry.collectionId,
            location: entry.location,

            // Dates
            publicationDate: entry.publicationDate,
            accessDate: entry.accessDate || now,

            // Content
            description: entry.description,
            notes: entry.notes,

            // Generated citations
            citations: this.generateCitations(entry),

            // Metadata
            confidence: this.sourceTypes[entry.sourceType]?.confidence || 0.5,
            usedIn: entry.usedIn || [],
            addedAt: now,
            addedBy: entry.addedBy || 'system'
        };

        if (this.pool) {
            try {
                await this.pool.query(`
                    INSERT INTO bibliography (
                        citation_id, title, source_type, category,
                        author, source_url, archive_name, collection_name, collection_id,
                        location, publication_date, access_date,
                        description, notes, formatted_apa, formatted_chicago, formatted_mla,
                        confidence, used_in, created_at, created_by
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
                    RETURNING *
                `, [
                    id, bibliographyEntry.title, bibliographyEntry.sourceType, bibliographyEntry.category,
                    bibliographyEntry.author, bibliographyEntry.url, bibliographyEntry.archiveName,
                    bibliographyEntry.collectionName, bibliographyEntry.collectionId, bibliographyEntry.location,
                    bibliographyEntry.publicationDate, bibliographyEntry.accessDate,
                    bibliographyEntry.description, bibliographyEntry.notes,
                    bibliographyEntry.citations.apa, bibliographyEntry.citations.chicago, bibliographyEntry.citations.mla,
                    bibliographyEntry.confidence, JSON.stringify(bibliographyEntry.usedIn),
                    bibliographyEntry.addedAt, bibliographyEntry.addedBy
                ]);
            } catch (error) {
                console.warn('Database not available, using in-memory storage:', error.message);
                this.inMemoryStore.entries.push(bibliographyEntry);
            }
        } else {
            this.inMemoryStore.entries.push(bibliographyEntry);
        }

        return bibliographyEntry;
    }

    /**
     * Flag a pending citation (source used but not yet fully cited)
     */
    async flagPendingCitation(pendingEntry) {
        const id = this.generateId('pending');
        const now = new Date().toISOString();

        const pending = {
            id,
            title: pendingEntry.title || 'Untitled Source',
            type: pendingEntry.type || 'unknown', // copy-paste, quote, document, data, methodology
            url: pendingEntry.url,
            context: pendingEntry.context,
            usedIn: pendingEntry.usedIn || [],
            detectedPatterns: pendingEntry.detectedPatterns || [],
            flaggedAt: now,
            flaggedBy: pendingEntry.flaggedBy || 'system',
            status: 'pending', // pending, in_progress, resolved
            resolvedCitationId: null
        };

        if (this.pool) {
            try {
                await this.pool.query(`
                    INSERT INTO pending_citations (
                        pending_id, title, citation_type, source_url, context,
                        used_in, detected_patterns, flagged_at, flagged_by, status
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    RETURNING *
                `, [
                    id, pending.title, pending.type, pending.url, pending.context,
                    JSON.stringify(pending.usedIn), JSON.stringify(pending.detectedPatterns),
                    pending.flaggedAt, pending.flaggedBy, pending.status
                ]);
            } catch (error) {
                console.warn('Database not available, using in-memory storage:', error.message);
                this.inMemoryStore.pending.push(pending);
            }
        } else {
            this.inMemoryStore.pending.push(pending);
        }

        return pending;
    }

    /**
     * Analyze text for potential copy/paste content that needs citation
     */
    analyzeForCopyPaste(text, context = {}) {
        const flags = [];

        for (const pattern of this.copyPasteIndicators) {
            const matches = text.match(pattern);
            if (matches) {
                matches.forEach(match => {
                    // Check if this URL matches a known archive
                    let archiveInfo = null;
                    for (const [domain, info] of Object.entries(this.knownArchives)) {
                        if (match.includes(domain)) {
                            archiveInfo = info;
                            break;
                        }
                    }

                    flags.push({
                        pattern: pattern.toString(),
                        match: match.substring(0, 200), // Truncate long matches
                        position: text.indexOf(match),
                        suggestedAction: archiveInfo
                            ? `Add citation for ${archiveInfo.name}`
                            : 'Verify source and add citation',
                        knownArchive: archiveInfo?.name || null,
                        context: context
                    });
                });
            }
        }

        // Check for long text blocks that might be quotes
        const longBlocks = text.split('\n\n').filter(block => block.length > 300);
        longBlocks.forEach(block => {
            // Heuristic: if a block has certain academic markers, flag it
            if (/\b(according|stated|noted|wrote|argued|claimed)\b/i.test(block)) {
                flags.push({
                    pattern: 'Long text block with academic markers',
                    match: block.substring(0, 200) + '...',
                    suggestedAction: 'Review for potential quote or paraphrase requiring citation',
                    context: context
                });
            }
        });

        return {
            hasFlags: flags.length > 0,
            flagCount: flags.length,
            flags,
            recommendation: flags.length > 0
                ? 'Content appears to contain material that may need citation'
                : 'No obvious citation needs detected'
        };
    }

    /**
     * Generate citations in multiple academic formats
     */
    generateCitations(entry) {
        const accessDate = new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        // Try to use known archive template
        let archiveTemplate = null;
        if (entry.url) {
            for (const [domain, info] of Object.entries(this.knownArchives)) {
                if (entry.url.includes(domain)) {
                    archiveTemplate = info;
                    break;
                }
            }
        }

        // Generate APA 7th edition
        const apa = this.formatAPA(entry, accessDate, archiveTemplate);

        // Generate Chicago 17th edition (Notes-Bibliography)
        const chicago = this.formatChicago(entry, accessDate, archiveTemplate);

        // Generate MLA 9th edition
        const mla = this.formatMLA(entry, accessDate, archiveTemplate);

        // Generate BibTeX
        const bibtex = this.formatBibTeX(entry);

        return { apa, chicago, mla, bibtex };
    }

    formatAPA(entry, accessDate, archiveTemplate) {
        if (archiveTemplate && !entry.author) {
            return archiveTemplate.citationTemplate(entry);
        }

        const author = entry.author || entry.archiveName || 'Unknown';
        const year = entry.publicationDate
            ? new Date(entry.publicationDate).getFullYear()
            : 'n.d.';
        const title = entry.title || 'Untitled';
        const url = entry.url ? ` Retrieved from ${entry.url}` : '';

        if (entry.sourceType === 'technology') {
            return `${author}. (${year}). ${title} [Software]. ${url}`;
        }

        return `${author}. (${year}). ${title}.${url}`;
    }

    formatChicago(entry, accessDate, archiveTemplate) {
        const author = entry.author || entry.archiveName || 'Unknown';
        const title = entry.title || 'Untitled';
        const year = entry.publicationDate
            ? new Date(entry.publicationDate).getFullYear()
            : 'n.d.';
        const url = entry.url ? ` ${entry.url}.` : '';
        const accessed = entry.url ? ` Accessed ${accessDate}.` : '';

        return `${author}. "${title}." ${entry.location || ''} ${year}.${url}${accessed}`;
    }

    formatMLA(entry, accessDate, archiveTemplate) {
        const author = entry.author || entry.archiveName || '';
        const title = `"${entry.title || 'Untitled'}"`;
        const container = entry.archiveName || entry.collectionName || '';
        const url = entry.url || '';

        let citation = '';
        if (author) citation += `${author}. `;
        citation += `${title}. `;
        if (container) citation += `${container}, `;
        if (url) citation += `${url}. `;
        citation += `Accessed ${accessDate}.`;

        return citation;
    }

    formatBibTeX(entry) {
        const key = (entry.author || entry.archiveName || 'unknown')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '')
            .substring(0, 20) +
            (entry.publicationDate ? new Date(entry.publicationDate).getFullYear() : '');

        const type = entry.sourceType === 'technology' ? 'software' : 'misc';

        return `@${type}{${key},
    author = {${entry.author || entry.archiveName || 'Unknown'}},
    title = {${entry.title || 'Untitled'}},
    year = {${entry.publicationDate ? new Date(entry.publicationDate).getFullYear() : 'n.d.'}},
    url = {${entry.url || ''}},
    note = {Accessed: ${new Date().toISOString().split('T')[0]}}
}`;
    }

    /**
     * Add a participant/contributor
     */
    async addParticipant(participant) {
        const id = this.generateId('participant');
        const now = new Date().toISOString();

        const entry = {
            id,
            name: participant.name,
            role: participant.role || 'contributor',
            affiliation: participant.affiliation,
            contribution: participant.contribution,
            startDate: participant.startDate || now,
            contributions: participant.contributions || [],
            addedAt: now
        };

        if (this.pool) {
            try {
                await this.pool.query(`
                    INSERT INTO participants (
                        participant_id, name, role, affiliation, contribution,
                        start_date, contributions, added_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    RETURNING *
                `, [
                    id, entry.name, entry.role, entry.affiliation, entry.contribution,
                    entry.startDate, JSON.stringify(entry.contributions), entry.addedAt
                ]);
            } catch (error) {
                console.warn('Database not available, using in-memory storage:', error.message);
                this.inMemoryStore.participants.push(entry);
            }
        } else {
            this.inMemoryStore.participants.push(entry);
        }

        return entry;
    }

    /**
     * Get all bibliography entries
     */
    async getAllEntries(options = {}) {
        const { sourceType, category, search } = options;

        if (this.pool) {
            try {
                let query = 'SELECT * FROM bibliography WHERE 1=1';
                const params = [];
                let paramCount = 0;

                if (sourceType) {
                    params.push(sourceType);
                    query += ` AND source_type = $${++paramCount}`;
                }
                if (category) {
                    params.push(category);
                    query += ` AND category = $${++paramCount}`;
                }
                if (search) {
                    params.push(`%${search}%`);
                    query += ` AND (title ILIKE $${++paramCount} OR description ILIKE $${paramCount})`;
                }

                query += ' ORDER BY created_at DESC';

                const result = await this.pool.query(query, params);
                return result.rows;
            } catch (error) {
                console.warn('Database query failed, using in-memory:', error.message);
            }
        }

        // Fallback to in-memory
        let entries = [...this.inMemoryStore.entries];

        if (sourceType) {
            entries = entries.filter(e => e.sourceType === sourceType);
        }
        if (category) {
            entries = entries.filter(e => e.category === category);
        }
        if (search) {
            const searchLower = search.toLowerCase();
            entries = entries.filter(e =>
                e.title?.toLowerCase().includes(searchLower) ||
                e.description?.toLowerCase().includes(searchLower)
            );
        }

        return entries;
    }

    /**
     * Get all pending citations
     */
    async getPendingCitations() {
        if (this.pool) {
            try {
                const result = await this.pool.query(`
                    SELECT * FROM pending_citations
                    WHERE status = 'pending'
                    ORDER BY flagged_at DESC
                `);
                return result.rows;
            } catch (error) {
                console.warn('Database query failed, using in-memory:', error.message);
            }
        }

        return this.inMemoryStore.pending.filter(p => p.status === 'pending');
    }

    /**
     * Get all participants
     */
    async getParticipants() {
        if (this.pool) {
            try {
                const result = await this.pool.query(`
                    SELECT * FROM participants ORDER BY added_at DESC
                `);
                return result.rows;
            } catch (error) {
                console.warn('Database query failed, using in-memory:', error.message);
            }
        }

        return this.inMemoryStore.participants;
    }

    /**
     * Resolve a pending citation by linking it to a full bibliography entry
     */
    async resolvePendingCitation(pendingId, citationId) {
        if (this.pool) {
            try {
                await this.pool.query(`
                    UPDATE pending_citations
                    SET status = 'resolved', resolved_citation_id = $1
                    WHERE pending_id = $2
                `, [citationId, pendingId]);
            } catch (error) {
                console.warn('Database update failed:', error.message);
            }
        }

        // Update in-memory store too
        const pending = this.inMemoryStore.pending.find(p => p.id === pendingId);
        if (pending) {
            pending.status = 'resolved';
            pending.resolvedCitationId = citationId;
        }
    }

    /**
     * Generate a full bibliography export
     */
    async exportBibliography(format = 'json') {
        const entries = await this.getAllEntries();
        const pending = await this.getPendingCitations();
        const participants = await this.getParticipants();

        const exportData = {
            project: 'Reparations Is A Real Number',
            exportDate: new Date().toISOString(),
            statistics: {
                totalEntries: entries.length,
                byType: this.countByField(entries, 'sourceType'),
                byCategory: this.countByField(entries, 'category'),
                pendingCitations: pending.length,
                participants: participants.length
            },
            entries,
            pending,
            participants
        };

        switch (format) {
            case 'bibtex':
                return entries.map(e => e.citations?.bibtex || this.formatBibTeX(e)).join('\n\n');
            case 'apa':
                return entries.map(e => e.citations?.apa || this.formatAPA(e, new Date().toLocaleDateString(), null)).join('\n\n');
            case 'chicago':
                return entries.map(e => e.citations?.chicago || this.formatChicago(e, new Date().toLocaleDateString(), null)).join('\n\n');
            case 'json':
            default:
                return exportData;
        }
    }

    countByField(items, field) {
        return items.reduce((acc, item) => {
            const value = item[field] || 'unknown';
            acc[value] = (acc[value] || 0) + 1;
            return acc;
        }, {});
    }

    /**
     * Auto-generate citations for a URL
     */
    async generateCitationFromUrl(url) {
        // Find matching archive
        for (const [domain, info] of Object.entries(this.knownArchives)) {
            if (url.includes(domain)) {
                return {
                    archiveName: info.name,
                    location: info.location,
                    institution: info.institution,
                    sourceType: domain.includes('wikipedia') ? 'tertiary' : 'secondary',
                    url: url,
                    suggestedCitation: info.citationTemplate({ url, title: 'Document' }),
                    needsMoreInfo: ['title', 'author', 'publicationDate']
                };
            }
        }

        return {
            archiveName: null,
            sourceType: 'unknown',
            url: url,
            needsMoreInfo: ['title', 'author', 'publicationDate', 'archiveName'],
            message: 'Unknown source - please provide additional details'
        };
    }

    /**
     * Get bibliography statistics
     */
    async getStatistics() {
        const entries = await this.getAllEntries();
        const pending = await this.getPendingCitations();
        const participants = await this.getParticipants();

        return {
            totalEntries: entries.length,
            bySourceType: this.countByField(entries, 'sourceType'),
            byCategory: this.countByField(entries, 'category'),
            pendingCitations: pending.length,
            participants: participants.length,
            recentAdditions: entries.slice(0, 5).map(e => ({
                id: e.id,
                title: e.title,
                addedAt: e.addedAt
            }))
        };
    }
}

// Export for different environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BibliographyManager;
} else if (typeof window !== 'undefined') {
    window.BibliographyManager = BibliographyManager;
}
