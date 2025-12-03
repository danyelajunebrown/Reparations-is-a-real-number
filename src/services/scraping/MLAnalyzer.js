/**
 * ML Analyzer - Machine Learning Analysis Engine for Web Scraping
 *
 * This system:
 * 1. Analyzes page content using NLP techniques
 * 2. Classifies entities (owners, enslaved, locations, dates)
 * 3. Calculates confidence scores
 * 4. Determines source types and document categories
 * 5. Provides intelligent content analysis
 */

const natural = require('natural');
const { WordTokenizer, SentenceTokenizer } = require('natural');
const { TfIdf } = require('natural');
const { BayesClassifier } = require('natural');

class MLAnalyzer {
    constructor() {
        this.tokenizer = new WordTokenizer();
        this.sentenceTokenizer = new SentenceTokenizer();
        this.classifier = new BayesClassifier();
        this.tfidf = new TfIdf();

        // Initialize ML models
        this.initializeModels();
    }

    /**
     * Initialize ML models with training data
     */
    initializeModels() {
        // Train classifier for entity types
        this.classifier.addDocument('slaveholder owned plantation', 'owner');
        this.classifier.addDocument('owner of slaves', 'owner');
        this.classifier.addDocument('plantation master', 'owner');
        this.classifier.addDocument('estate owner', 'owner');
        this.classifier.addDocument('proprietor of', 'owner');

        this.classifier.addDocument('enslaved person named', 'enslaved');
        this.classifier.addDocument('slave named', 'enslaved');
        this.classifier.addDocument('negro man', 'enslaved');
        this.classifier.addDocument('colored servant', 'enslaved');
        this.classifier.addDocument('bondsperson', 'enslaved');

        this.classifier.addDocument('born in 1820', 'date');
        this.classifier.addDocument('died 1865', 'date');
        this.classifier.addDocument('date of birth', 'date');
        this.classifier.addDocument('passed away 1845', 'date');

        this.classifier.addDocument('in Virginia', 'location');
        this.classifier.addDocument('from South Carolina', 'location');
        this.classifier.addDocument('at the plantation', 'location');
        this.classifier.addDocument('County, VA', 'location');

        this.classifier.train();

        // Add documents to TF-IDF for keyword analysis
        this.tfidf.addDocument('slaveholder records from 1860 census');
        this.tfidf.addDocument('enslaved persons in Virginia plantations');
        this.tfidf.addDocument('DC emancipation petitions and documents');
        this.tfidf.addDocument('African American genealogy research');
    }

    /**
     * Analyze page content and extract intelligence
     */
    analyzePageContent(text, url) {
        const startTime = Date.now();
        console.log('🧠 ML Analysis started...');

        const analysis = {
            entities: this.extractEntities(text),
            sentiment: this.analyzeSentiment(text),
            keywords: this.extractKeywords(text),
            confidence: this.calculateConfidence(text, url),
            sourceType: this.determineSourceType(url),
            documentType: this.determineDocumentType(text, url),
            isPrimarySource: this.isPrimarySource(url),
            contentQuality: this.assessContentQuality(text),
            analysisDuration: 0
        };

        analysis.analysisDuration = Date.now() - startTime;
        console.log(`🧠 ML Analysis completed in ${analysis.analysisDuration}ms`);

        return analysis;
    }

    /**
     * Extract entities using ML classification
     */
    extractEntities(text) {
        const entities = {
            owners: [],
            enslaved: [],
            locations: [],
            dates: [],
            relationships: []
        };

        // Split text into sentences for analysis
        const sentences = this.sentenceTokenizer.tokenize(text);

        sentences.forEach(sentence => {
            const classification = this.classifier.classify(sentence);

            if (classification === 'owner') {
                const names = this.extractNames(sentence);
                entities.owners.push(...names);
            } else if (classification === 'enslaved') {
                const names = this.extractNames(sentence);
                entities.enslaved.push(...names);
            } else if (classification === 'date') {
                const dates = this.extractDates(sentence);
                entities.dates.push(...dates);
            } else if (classification === 'location') {
                const locations = this.extractLocations(sentence);
                entities.locations.push(...locations);
            }

            // Extract relationships
            const relationships = this.extractRelationships(sentence);
            entities.relationships.push(...relationships);
        });

        // Deduplicate entities
        entities.owners = [...new Set(entities.owners)];
        entities.enslaved = [...new Set(entities.enslaved)];
        entities.locations = [...new Set(entities.locations)];
        entities.dates = [...new Set(entities.dates)];

        return entities;
    }

    /**
     * Extract names from text
     */
    extractNames(text) {
        const names = [];
        // Pattern for capitalized names (2-4 words)
        const pattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/g;
        let match;

        while ((match = pattern.exec(text)) !== null) {
            const name = match[1];
            // Filter out common false positives
            if (!this.isCommonWord(name) && name.length > 3) {
                names.push(name);
            }
        }

        return names;
    }

    /**
     * Extract dates from text
     */
    extractDates(text) {
        const dates = [];
        // Pattern for years (1700-1900)
        const yearPattern = /\b(1[789]\d{2})\b/g;
        let match;

        while ((match = yearPattern.exec(text)) !== null) {
            dates.push(match[1]);
        }

        return dates;
    }

    /**
     * Extract locations from text
     */
    extractLocations(text) {
        const locations = [];
        // US State patterns
        const statePattern = /(?:Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)/gi;

        let match;
        while ((match = statePattern.exec(text)) !== null) {
            if (!locations.includes(match[0])) {
                locations.push(match[0]);
            }
        }

        return locations;
    }

    /**
     * Extract relationships from text
     */
    extractRelationships(text) {
        const relationships = [];
        // Pattern for owner-enslaved relationships
        const relationshipPatterns = [
            /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:owned|enslaved|servant of)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi,
            /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+was\s+(?:owned|enslaved)\s+by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi
        ];

        relationshipPatterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                relationships.push({
                    owner: match[1],
                    enslaved: match[2],
                    type: 'enslaver-enslaved'
                });
            }
        });

        return relationships;
    }

    /**
     * Analyze sentiment of text
     */
    analyzeSentiment(text) {
        // Simple sentiment analysis based on keywords
        const positiveWords = ['freedom', 'emancipation', 'liberation', 'rights', 'justice'];
        const negativeWords = ['slavery', 'enslaved', 'bondage', 'oppression', 'cruelty'];

        let positiveCount = 0;
        let negativeCount = 0;

        positiveWords.forEach(word => {
            if (text.toLowerCase().includes(word)) positiveCount++;
        });

        negativeWords.forEach(word => {
            if (text.toLowerCase().includes(word)) negativeCount++;
        });

        const sentimentScore = positiveCount - negativeCount;
        const total = positiveCount + negativeCount;

        if (total === 0) return 'neutral';

        const sentiment = sentimentScore / total;

        if (sentiment > 0.3) return 'positive';
        if (sentiment < -0.3) return 'negative';
        return 'neutral';
    }

    /**
     * Extract keywords using TF-IDF
     */
    extractKeywords(text) {
        // Add current text to TF-IDF
        this.tfidf.addDocument(text);

        // Get top terms
        const terms = this.tfidf.listTerms(0).slice(0, 10); // Top 10 terms

        return terms.map(term => ({
            term: term.term,
            tfidf: term.tfidf
        }));
    }

    /**
     * Calculate confidence score
     */
    calculateConfidence(text, url) {
        // Base confidence from URL
        let confidence = this.getBaseConfidence(url);

        // Adjust based on content analysis
        const ownerCount = (text.match(/owner|slaveholder|plantation/gi) || []).length;
        const enslavedCount = (text.match(/enslaved|slave|negro|servant/gi) || []).length;
        const dateCount = (text.match(/\b(1[789]\d{2})\b/g) || []).length;
        const locationCount = (text.match(/Alabama|Virginia|South Carolina|Georgia|North Carolina|Maryland|Louisiana|Mississippi|Texas|Arkansas|Tennessee|Kentucky|Missouri|Florida|Alabama/gi) || []).length;

        // Content quality indicators
        confidence += (ownerCount * 0.01);
        confidence += (enslavedCount * 0.01);
        confidence += (dateCount * 0.005);
        confidence += (locationCount * 0.005);

        // Cap confidence at 95% for ML analysis
        return Math.min(confidence, 0.95);
    }

    /**
     * Get base confidence from URL
     */
    getBaseConfidence(url) {
        if (url.includes('rootsweb.com') || url.includes('civilwardc.org')) {
            return 0.8; // Primary sources start high
        } else if (url.includes('beyondkin.org') || url.includes('familysearch.org')) {
            return 0.6; // Secondary sources
        } else if (url.includes('wikipedia.org') || url.includes('britannica.com')) {
            return 0.5; // Tertiary sources
        } else {
            return 0.4; // Generic sources
        }
    }

    /**
     * Determine source type
     */
    determineSourceType(url) {
        if (url.includes('rootsweb.com') || url.includes('civilwardc.org')) {
            return 'primary';
        } else if (url.includes('beyondkin.org') || url.includes('familysearch.org') || url.includes('ancestry.com')) {
            return 'secondary';
        } else if (url.includes('wikipedia.org') || url.includes('britannica.com')) {
            return 'tertiary';
        } else {
            return 'unknown';
        }
    }

    /**
     * Determine document type
     */
    determineDocumentType(text, url) {
        if (url.includes('rootsweb.com')) {
            return 'census';
        } else if (url.includes('civilwardc.org')) {
            return 'petition';
        } else if (url.includes('beyondkin.org')) {
            return 'directory';
        } else if (url.includes('wikipedia.org')) {
            return 'article';
        } else if (url.includes('findagrave.com')) {
            return 'memorial';
        } else if (url.includes('archive.org')) {
            return 'archive';
        } else {
            // Analyze text content
            if (text.includes('slave schedule') || text.includes('census')) {
                return 'census';
            } else if (text.includes('petition') || text.includes('court record')) {
                return 'petition';
            } else if (text.includes('directory') || text.includes('index')) {
                return 'directory';
            } else {
                return 'generic';
            }
        }
    }

    /**
     * Check if source is primary
     */
    isPrimarySource(url) {
        return this.determineSourceType(url) === 'primary';
    }

    /**
     * Assess content quality
     */
    assessContentQuality(text) {
        // Calculate content quality score (0-1)
        const wordCount = text.split(/\s+/).length;
        const sentenceCount = this.sentenceTokenizer.tokenize(text).length;
        const avgSentenceLength = wordCount / Math.max(sentenceCount, 1);

        // Quality indicators
        const hasDates = text.match(/\b(1[789]\d{2})\b/) !== null;
        const hasNames = text.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/) !== null;
        const hasLocations = text.match(/Alabama|Virginia|South Carolina|Georgia|North Carolina|Maryland|Louisiana|Mississippi|Texas|Arkansas|Tennessee|Kentucky|Missouri|Florida|Alabama/i) !== null;

        let quality = 0.5; // Base quality

        // Adjust based on content characteristics
        if (wordCount > 500) quality += 0.1;
        if (sentenceCount > 20) quality += 0.1;
        if (avgSentenceLength > 10 && avgSentenceLength < 30) quality += 0.1;
        if (hasDates) quality += 0.1;
        if (hasNames) quality += 0.1;
        if (hasLocations) quality += 0.1;

        return Math.min(quality, 1.0);
    }

    /**
     * Check if word is common (filter for names)
     */
    isCommonWord(word) {
        const commonWords = [
            'The', 'This', 'That', 'These', 'Those', 'January', 'February', 'March',
            'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November',
            'December', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
            'Saturday', 'Sunday', 'County', 'State', 'City', 'United', 'States',
            'American', 'Civil', 'War', 'Act', 'Congress', 'Government', 'Federal'
        ];
        return commonWords.includes(word);
    }
}

module.exports = MLAnalyzer;
