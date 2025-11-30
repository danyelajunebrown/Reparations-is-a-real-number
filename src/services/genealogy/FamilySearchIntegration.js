/**
 * FamilySearch API Integration Module
 * Handles authentication, genealogy data retrieval, and descendant tracking
 */

/**
 * FamilySearch API Integration Module
 * Now supports OAuth login flow for manual consent
 */

class FamilySearchIntegration {
    constructor(config = {}) {
        this.apiKey = config.apiKey || null;
        this.baseUrl = config.baseUrl || 'https://api.familysearch.org';
        this.sandboxUrl = 'https://sandbox.familysearch.org';
        this.isSandbox = config.sandbox || true;
        this.accessToken = null;
        this.sessionId = null;
        
        // OAuth configuration
        this.oauth = {
            clientId: config.clientId || 'YOUR_CLIENT_ID', // You'll get this from FamilySearch
            redirectUri: config.redirectUri || window.location.origin + '/callback',
            state: this.generateState()
        };
        
        // Rate limiting
        this.requestCount = 0;
        this.lastRequestTime = 0;
        this.maxRequestsPerSecond = 5;
        
        // Cache
        this.personCache = new Map();
        this.relationshipCache = new Map();
    }
    
    /**
     * Generate random state for OAuth security
     */
    generateState() {
        return Math.random().toString(36).substring(2, 15) + 
               Math.random().toString(36).substring(2, 15);
    }
    
    /**
     * Initiate OAuth login flow (opens FamilySearch login in new window)
     */
    initiateOAuthLogin() {
        const authUrl = `${this.getBaseUrl()}/platform/oauth/authorize?` + 
            `response_type=code&` +
            `client_id=${this.oauth.clientId}&` +
            `redirect_uri=${encodeURIComponent(this.oauth.redirectUri)}&` +
            `state=${this.oauth.state}`;
        
        console.log('Opening FamilySearch login...');
        
        // Open in popup window
        const popup = window.open(
            authUrl,
            'FamilySearch Login',
            'width=600,height=700,scrollbars=yes'
        );
        
        // Listen for callback
        return new Promise((resolve, reject) => {
            window.addEventListener('message', (event) => {
                if (event.data.type === 'familysearch_oauth_callback') {
                    popup.close();
                    
                    if (event.data.code) {
                        this.exchangeCodeForToken(event.data.code)
                            .then(resolve)
                            .catch(reject);
                    } else {
                        reject(new Error('OAuth failed: ' + event.data.error));
                    }
                }
            });
            
            // Check if popup was blocked
            if (!popup || popup.closed || typeof popup.closed === 'undefined') {
                reject(new Error('Popup blocked. Please allow popups for this site.'));
            }
        });
    }
    
    /**
     * Exchange authorization code for access token
     */
    async exchangeCodeForToken(code) {
        const tokenUrl = `${this.getBaseUrl()}/platform/oauth/token`;
        
        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                client_id: this.oauth.clientId,
                redirect_uri: this.oauth.redirectUri
            })
        });
        
        if (!response.ok) {
            throw new Error('Token exchange failed');
        }
        
        const data = await response.json();
        this.accessToken = data.access_token;
        
        console.log('FamilySearch OAuth login successful');
        return true;
    }
    
    /**
     * Check if user is logged in
     */
    isLoggedIn() {
        return !!this.accessToken;
    }
    
    /**
     * Manual login with username/password (for testing without OAuth setup)
     */
    async manualLogin(username, password) {
        console.log('Attempting manual FamilySearch login...');
        
        // FamilySearch doesn't actually support username/password via API
        // This is a placeholder - you'll need OAuth
        console.warn('Manual login not supported. Use OAuth flow instead.');
        
        // For testing purposes, simulate login
        this.accessToken = 'TEST_TOKEN_' + Date.now();
        return true;
    }

    // ... rest of existing FamilySearch methods ...

class FamilySearchIntegration {
  // NEW METHOD
  async extractSlaveOwnershipData(personId) {
    const person = await this.getPerson(personId);
    const ancestors = await this.getAncestors(personId, 10);
    
    const potentialOwners = [];
    
    for (const ancestor of ancestors) {
      const indicators = await this.checkSlaveOwnershipIndicators(ancestor);
      
      if (indicators.hasEvidence) {
        potentialOwners.push({
          person: ancestor,
          indicators: indicators,
          needsDocumentVerification: true,
          confidence: this.calculateInitialConfidence(indicators)
        });
      }
    }
    
    return potentialOwners;
  }
  
  async checkSlaveOwnershipIndicators(person) {
    const evidence = {
      hasEvidence: false,
      indicators: [],
      documents: [],
      citations: []
    };
    
    // Check location (Southern states pre-1865)
    if (this.isSouthernState(person.birthPlace) && person.deathYear < 1865) {
      evidence.indicators.push('southern_location_pre_emancipation');
    }
    
    // Check occupation in FamilySearch
    if (person.occupation && 
        ['planter', 'plantation owner', 'farmer'].includes(person.occupation.toLowerCase())) {
      evidence.indicators.push('relevant_occupation');
    }
    
    // Check for attached documents mentioning slavery
    const attachedDocs = await this.getPersonDocuments(person.id);
    for (const doc of attachedDocs) {
      if (this.documentMentionsSlavery(doc)) {
        evidence.documents.push(doc);
        evidence.indicators.push('document_evidence');
      }
    }
    
    // CRITICAL: Check for MISSING citations
    const memories = await this.getPersonMemories(person.id);
    if (memories.length === 0 && person.deathYear < 1865) {
      evidence.citations.push({
        type: 'MISSING',
        needed: 'will_or_probate',
        priority: 'HIGH',
        reason: 'No attached documents for person in slavery era'
      });
    }
    
    evidence.hasEvidence = evidence.indicators.length > 0;
    return evidence;
  }
  
  // MARK EMPTY CITATIONS
  identifyResearchGaps(person, evidence) {
    const gaps = [];
    
    // No will attached but died pre-1865 in South
    if (!evidence.documents.find(d => d.type === 'will') && 
        person.deathYear < 1865) {
      gaps.push({
        type: 'MISSING_WILL',
        person: person.fullName,
        location: person.deathPlace,
        expectedYear: person.deathYear,
        priority: 'HIGH',
        searchHints: [
          `${person.deathPlace} probate records ${person.deathYear}`,
          `Maryland State Archives` // etc based on location
        ]
      });
    }
    
    // Has will but no census records
    if (evidence.documents.find(d => d.type === 'will') &&
        !evidence.documents.find(d => d.type === 'census')) {
      gaps.push({
        type: 'MISSING_CENSUS',
        person: person.fullName,
        neededYears: this.calculateCensusYears(person.birthYear, person.deathYear),
        priority: 'MEDIUM'
      });
    }
    
    return gaps;
  }
}
    /**
     * Initialize with Beta API key received from FamilySearch
     */
    async initialize(betaApiKey) {
        this.apiKey = betaApiKey;
        console.log('FamilySearch Beta API initialized');
        return true;
    }

    /**
     * Authenticate with FamilySearch (OAuth 2.0)
     */
    async authenticate(username, password) {
        const url = `${this.getBaseUrl()}/platform/collections/tree`;
        
        try {
            const response = await this.makeRequest(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Accept': 'application/x-fs-v1+json'
                }
            });

            if (response.ok) {
                this.accessToken = this.apiKey; // Beta API might work differently
                console.log('Authenticated with FamilySearch');
                return true;
            }
            
            throw new Error('Authentication failed');
        } catch (error) {
            console.error('FamilySearch authentication error:', error);
            return false;
        }
    }

    /**
     * Search for a person by name and dates
     */
    async searchPerson(givenName, familyName, birthYear = null, deathYear = null) {
        await this.rateLimitCheck();
        
        const params = new URLSearchParams({
            q: `name:"${givenName} ${familyName}"`
        });
        
        if (birthYear) {
            params.append('q', `birth_year:${birthYear}`);
        }
        if (deathYear) {
            params.append('q', `death_year:${deathYear}`);
        }

        const url = `${this.getBaseUrl()}/platform/tree/search?${params}`;
        
        try {
            const response = await this.makeRequest(url, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Accept': 'application/x-fs-v1+json'
                }
            });

            const data = await response.json();
            return this.parseSearchResults(data);
        } catch (error) {
            console.error('Search error:', error);
            return [];
        }
    }

    /**
     * Get person details by FamilySearch ID
     */
    async getPerson(personId) {
        // Check cache first
        if (this.personCache.has(personId)) {
            return this.personCache.get(personId);
        }

        await this.rateLimitCheck();
        
        const url = `${this.getBaseUrl()}/platform/tree/persons/${personId}`;
        
        try {
            const response = await this.makeRequest(url, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Accept': 'application/x-fs-v1+json'
                }
            });

            const data = await response.json();
            const personData = this.parsePersonData(data);
            
            // Cache the result
            this.personCache.set(personId, personData);
            
            return personData;
        } catch (error) {
            console.error('Error fetching person:', error);
            return null;
        }
    }

    /**
     * Get all descendants of a person (this is the key function for your use case)
     */
    async getDescendants(personId, maxGenerations = 5) {
        const descendants = [];
        const visited = new Set();
        
        await this.getDescendantsRecursive(personId, 0, maxGenerations, descendants, visited);
        
        return descendants;
    }

    /**
     * Recursively fetch descendants
     */
    async getDescendantsRecursive(personId, currentGeneration, maxGenerations, descendants, visited) {
        if (currentGeneration >= maxGenerations || visited.has(personId)) {
            return;
        }
        
        visited.add(personId);
        
        // Get person's children
        const children = await this.getChildren(personId);
        
        for (const child of children) {
            if (!visited.has(child.id)) {
                const personData = await this.getPerson(child.id);
                
                if (personData) {
                    descendants.push({
                        ...personData,
                        generation: currentGeneration + 1,
                        ancestorId: personId
                    });
                    
                    // Recursively get their descendants
                    await this.getDescendantsRecursive(
                        child.id, 
                        currentGeneration + 1, 
                        maxGenerations, 
                        descendants, 
                        visited
                    );
                }
            }
        }
    }

    /**
     * Get children of a person
     */
    async getChildren(personId) {
        await this.rateLimitCheck();
        
        const url = `${this.getBaseUrl()}/platform/tree/persons/${personId}/children`;
        
        try {
            const response = await this.makeRequest(url, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Accept': 'application/x-fs-v1+json'
                }
            });

            const data = await response.json();
            return this.parseChildrenData(data);
        } catch (error) {
            console.error('Error fetching children:', error);
            return [];
        }
    }

    /**
     * Get ancestors of a person (for building ancestry chains)
     */
    async getAncestors(personId, maxGenerations = 5) {
        const ancestors = [];
        const visited = new Set();
        
        await this.getAncestorsRecursive(personId, 0, maxGenerations, ancestors, visited);
        
        return ancestors;
    }

    /**
     * Recursively fetch ancestors
     */
    async getAncestorsRecursive(personId, currentGeneration, maxGenerations, ancestors, visited) {
        if (currentGeneration >= maxGenerations || visited.has(personId)) {
            return;
        }
        
        visited.add(personId);
        
        const parents = await this.getParents(personId);
        
        for (const parent of parents) {
            if (!visited.has(parent.id)) {
                const personData = await this.getPerson(parent.id);
                
                if (personData) {
                    ancestors.push({
                        ...personData,
                        generation: currentGeneration + 1,
                        descendantId: personId
                    });
                    
                    await this.getAncestorsRecursive(
                        parent.id, 
                        currentGeneration + 1, 
                        maxGenerations, 
                        ancestors, 
                        visited
                    );
                }
            }
        }
    }

    /**
     * Get parents of a person
     */
    async getParents(personId) {
        await this.rateLimitCheck();
        
        const url = `${this.getBaseUrl()}/platform/tree/persons/${personId}/parents`;
        
        try {
            const response = await this.makeRequest(url, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Accept': 'application/x-fs-v1+json'
                }
            });

            const data = await response.json();
            return this.parseParentsData(data);
        } catch (error) {
            console.error('Error fetching parents:', error);
            return [];
        }
    }

    /**
     * Find living descendants (Beta API feature)
     * Note: This might require special permissions
     */
    async getLivingDescendants(personId) {
        // This is a sensitive operation that requires special handling
        console.warn('Requesting living descendants - ensure proper permissions and privacy compliance');
        
        const allDescendants = await this.getDescendants(personId, 10);
        
        // Filter for likely living people (born after 1900, no death date)
        const likelyLiving = allDescendants.filter(person => {
            const birthYear = person.birthYear;
            const deathYear = person.deathYear;
            
            return birthYear && 
                   birthYear > 1900 && 
                   !deathYear &&
                   (new Date().getFullYear() - birthYear) < 120; // Reasonable age limit
        });
        
        return likelyLiving;
    }

    /**
     * Calculate descendant distribution for reparations
     */
    async calculateDescendantShares(ancestorId) {
        const descendants = await this.getDescendants(ancestorId);
        
        // Group by generation to apply weighting if needed
        const generationGroups = descendants.reduce((groups, person) => {
            const gen = person.generation;
            if (!groups[gen]) groups[gen] = [];
            groups[gen].push(person);
            return groups;
        }, {});

        // Simple equal distribution for now
        const totalDescendants = descendants.length;
        const sharePerDescendant = totalDescendants > 0 ? 10000 / totalDescendants : 0;

        return descendants.map(person => ({
            familySearchId: person.id,
            fullName: person.fullName,
            generation: person.generation,
            sharePercentage: Math.floor(sharePerDescendant),
            birthYear: person.birthYear,
            isLikeLiving: this.isLikelyLiving(person)
        }));
    }

    /**
     * Helper function to determine if person is likely living
     */
    isLikelyLiving(person) {
        const currentYear = new Date().getFullYear();
        return person.birthYear && 
               person.birthYear > 1900 && 
               !person.deathYear &&
               (currentYear - person.birthYear) < 120;
    }

    /**
     * Rate limiting helper
     */
    async rateLimitCheck() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        
        if (timeSinceLastRequest < (1000 / this.maxRequestsPerSecond)) {
            const waitTime = (1000 / this.maxRequestsPerSecond) - timeSinceLastRequest;
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        this.lastRequestTime = Date.now();
        this.requestCount++;
    }

    /**
     * Make HTTP request with error handling
     */
    async makeRequest(url, options = {}) {
        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    'User-Agent': 'ReparationsBlockchain/1.0',
                    ...options.headers
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return response;
        } catch (error) {
            console.error('Request failed:', error);
            throw error;
        }
    }

    /**
     * Get appropriate base URL
     */
    getBaseUrl() {
        return this.isSandbox ? this.sandboxUrl : this.baseUrl;
    }

    /**
     * Parse search results from FamilySearch API
     */
    parseSearchResults(data) {
        if (!data.entries) return [];
        
        return data.entries.map(entry => ({
            id: entry.id,
            fullName: entry.title,
            givenName: this.extractGivenName(entry),
            familyName: this.extractFamilyName(entry),
            birthYear: this.extractBirthYear(entry),
            deathYear: this.extractDeathYear(entry),
            birthPlace: this.extractBirthPlace(entry),
            deathPlace: this.extractDeathPlace(entry)
        }));
    }

    /**
     * Parse detailed person data
     */
    parsePersonData(data) {
        if (!data.persons || data.persons.length === 0) return null;
        
        const person = data.persons[0];
        
        return {
            id: person.id,
            fullName: this.extractFullName(person),
            givenName: this.extractGivenName(person),
            familyName: this.extractFamilyName(person),
            birthYear: this.extractBirthYear(person),
            deathYear: this.extractDeathYear(person),
            birthPlace: this.extractBirthPlace(person),
            deathPlace: this.extractDeathPlace(person),
            gender: this.extractGender(person)
        };
    }

    /**
     * Parse children data
     */
    parseChildrenData(data) {
        if (!data.childRelationships) return [];
        
        return data.childRelationships.map(rel => ({
            id: rel.child.resourceId,
            relationshipId: rel.id
        }));
    }

    /**
     * Parse parents data
     */
    parseParentsData(data) {
        if (!data.childRelationships) return [];
        
        const parents = [];
        data.childRelationships.forEach(rel => {
            if (rel.father) {
                parents.push({
                    id: rel.father.resourceId,
                    type: 'father'
                });
            }
            if (rel.mother) {
                parents.push({
                    id: rel.mother.resourceId,
                    type: 'mother'
                });
            }
        });
        
        return parents;
    }

    // Data extraction helpers (these will need adjustment based on actual API responses)
    extractFullName(person) {
        if (person.names && person.names.length > 0) {
            return person.names[0].nameForms[0].fullText;
        }
        return 'Unknown';
    }

    extractGivenName(person) {
        if (person.names && person.names.length > 0) {
            const parts = person.names[0].nameForms[0].parts;
            const givenPart = parts.find(p => p.type === 'http://gedcomx.org/Given');
            return givenPart ? givenPart.value : '';
        }
        return '';
    }

    extractFamilyName(person) {
        if (person.names && person.names.length > 0) {
            const parts = person.names[0].nameForms[0].parts;
            const familyPart = parts.find(p => p.type === 'http://gedcomx.org/Surname');
            return familyPart ? familyPart.value : '';
        }
        return '';
    }

    extractBirthYear(person) {
        const birthFact = this.extractFact(person, 'http://gedcomx.org/Birth');
        return birthFact ? this.extractYear(birthFact.date) : null;
    }

    extractDeathYear(person) {
        const deathFact = this.extractFact(person, 'http://gedcomx.org/Death');
        return deathFact ? this.extractYear(deathFact.date) : null;
    }

    extractBirthPlace(person) {
        const birthFact = this.extractFact(person, 'http://gedcomx.org/Birth');
        return birthFact && birthFact.place ? birthFact.place.original : '';
    }

    extractDeathPlace(person) {
        const deathFact = this.extractFact(person, 'http://gedcomx.org/Death');
        return deathFact && deathFact.place ? deathFact.place.original : '';
    }

    extractGender(person) {
        if (person.gender && person.gender.type) {
            return person.gender.type.includes('Male') ? 'Male' : 'Female';
        }
        return 'Unknown';
    }

    extractFact(person, factType) {
        if (person.facts) {
            return person.facts.find(fact => fact.type === factType);
        }
        return null;
    }

    extractYear(dateString) {
        if (!dateString) return null;
        const match = dateString.match(/(\d{4})/);
        return match ? parseInt(match[1]) : null;
    }

    /**
     * Export descendant data for blockchain submission
     */
    exportForBlockchain(descendants) {
        return descendants.map(descendant => ({
            walletAddress: '0x0000000000000000000000000000000000000000', // Placeholder - will be updated when they connect wallet
            familySearchId: descendant.familySearchId,
            fullName: descendant.fullName,
            sharePercentage: descendant.sharePercentage,
            generation: descendant.generation,
            birthYear: descendant.birthYear,
            isLikelyLiving: descendant.isLikeLiving,
            verificationStatus: 'pending'
        }));
    }

    /**
     * Generate verification report for descendants
     */
    generateVerificationReport(ancestorId, descendants) {
        const report = {
            ancestorId,
            totalDescendants: descendants.length,
            livingDescendants: descendants.filter(d => d.isLikelyLiving).length,
            generationBreakdown: {},
            verificationTimestamp: new Date().toISOString(),
            dataSource: 'FamilySearch Beta API',
            confidenceLevel: this.calculateConfidenceLevel(descendants)
        };

        // Group by generation
        descendants.forEach(descendant => {
            const gen = descendant.generation;
            if (!report.generationBreakdown[gen]) {
                report.generationBreakdown[gen] = 0;
            }
            report.generationBreakdown[gen]++;
        });

        return report;
    }

    /**
     * Calculate confidence level based on data completeness
     */
    calculateConfidenceLevel(descendants) {
        let totalScore = 0;
        let maxScore = 0;

        descendants.forEach(descendant => {
            let score = 0;
            maxScore += 5; // Maximum possible score per person

            if (descendant.fullName && descendant.fullName !== 'Unknown') score += 2;
            if (descendant.birthYear) score += 1;
            if (descendant.generation <= 3) score += 1; // Closer generations more reliable
            if (descendant.familySearchId) score += 1;

            totalScore += score;
        });

        return maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
    }

    /**
     * Find potential wallet addresses for descendants (if they've used blockchain services)
     */
    async findDescendantWallets(descendants) {
        // This is speculative - in practice, you'd need integration with identity services
        // For now, return descendants with placeholder addresses that need manual update
        
        return descendants.map(descendant => ({
            ...descendant,
            walletAddress: null, // Will be null until they connect their wallet
            needsWalletConnection: true,
            contactMethod: 'pending', // Email, phone, etc. - would need additional data sources
            notificationSent: false
        }));
    }

    /**
     * Privacy-compliant contact method for living descendants
     */
    generateContactStrategy(livingDescendants) {
        return {
            totalToContact: livingDescendants.length,
            contactMethods: [
                'Public genealogy websites (with consent)',
                'Social media research (public profiles only)',
                'Professional genealogy services',
                'Family reunion networks',
                'Obituary connections (for recent deceased family members)'
            ],
            legalConsiderations: [
                'Obtain explicit consent before collecting wallet addresses',
                'Provide clear explanation of reparations program',
                'Allow opt-out at any time',
                'Protect privacy of those who decline participation',
                'Follow applicable privacy laws (GDPR, CCPA, etc.)'
            ],
            recommendedApproach: 'Start with known family connections and expand through voluntary participation'
        };
    }

    /**
     * Create notification message for descendants
     */
    generateDescendantNotification(ancestorName, calculatedReparations, descendantShare) {
        return {
            subject: `Reparations Notification - ${ancestorName} Ancestry`,
            message: `
Dear Family Member,

You have been identified as a descendant of ${ancestorName} through genealogical research using FamilySearch records. 

A reparations calculation has been completed for the unpaid labor and harm caused during the slavery period. Based on historical economic analysis:

- Total calculated reparations: ${calculatedReparations.toLocaleString()}
- Your estimated share: ${descendantShare.toLocaleString()}

This is part of a blockchain-based reparations tracking system that ensures transparent and verifiable distribution of reparations to verified descendants.

NEXT STEPS:
1. Review the genealogical evidence (attached)
2. If you agree with the findings, you can participate by connecting a cryptocurrency wallet
3. Verification process will confirm your descendant status
4. Upon verification, you'll be eligible to receive your share

IMPORTANT:
- Participation is entirely voluntary
- Your privacy will be protected throughout the process
- You can opt out at any time
- No personal information is shared without your consent

For questions or to begin the verification process, please contact: [contact information]

Respectfully,
Reparations Accountability Project
            `,
            attachments: [
                'Genealogical evidence packet',
                'Reparations calculation methodology',
                'Privacy policy and terms',
                'Wallet setup instructions'
            ]
        };
    }

    /**
     * Integration with blockchain contract
     */
    async submitToBlockchain(reparationsContract, ancestorData, descendants) {
        if (!reparationsContract) {
            throw new Error('Blockchain contract not connected');
        }

        try {
            // Submit ancestry record
            const recordId = await reparationsContract.submitAncestryRecord(
                ancestorData.name,
                ancestorData.familySearchId,
                ancestorData.genealogyHash,
                ancestorData.totalReparations,
                `FamilySearch verified ancestry record with ${descendants.length} identified descendants`
            );

            // Prepare descendant data for blockchain
            const blockchainDescendants = this.exportForBlockchain(descendants);
            
            const walletAddresses = blockchainDescendants.map(d => d.walletAddress);
            const familySearchIds = blockchainDescendants.map(d => d.familySearchId);
            const fullNames = blockchainDescendants.map(d => d.fullName);
            const sharePercentages = blockchainDescendants.map(d => d.sharePercentage);

            // Add descendants to the record
            await reparationsContract.addDescendants(
                recordId,
                walletAddresses,
                familySearchIds,
                fullNames,
                sharePercentages
            );

            return {
                success: true,
                recordId,
                descendantCount: descendants.length,
                transactionHash: recordId // Simplified for demo
            };

        } catch (error) {
            console.error('Blockchain submission error:', error);
            throw error;
        }
    }

    /**
     * Search for slave owner records specifically
     */
    async searchSlaveOwners(ownerName, location, timeframe) {
        // This would be a specialized search focusing on historical records
        // that indicate slave ownership
        
        const searchTerms = [
            `name:"${ownerName}"`,
            `occupation:planter`,
            `occupation:plantation`,
            `occupation:"slave owner"`,
            location ? `place:"${location}"` : null,
            timeframe ? `birth_year:${timeframe.start}-${timeframe.end}` : null
        ].filter(Boolean);

        const results = await this.searchPerson(
            ownerName.split(' ')[0], // Given name
            ownerName.split(' ').slice(1).join(' '), // Family name
            timeframe ? timeframe.start : null
        );

        // Filter and rank results based on slave ownership indicators
        return results.filter(person => {
            // Look for indicators in the data that suggest slave ownership
            const indicators = [
                person.birthPlace && person.birthPlace.includes('Virginia'),
                person.birthPlace && person.birthPlace.includes('Carolina'),
                person.birthPlace && person.birthPlace.includes('Georgia'),
                person.birthPlace && person.birthPlace.includes('Alabama'),
                person.birthPlace && person.birthPlace.includes('Mississippi'),
                person.deathYear && person.deathYear < 1865, // Pre-emancipation
                person.birthYear && person.birthYear < 1800   // Born during slavery era
            ];
            
            return indicators.some(indicator => indicator);
        });
    }

    /**
     * Get API usage statistics
     */
    getUsageStats() {
        return {
            totalRequests: this.requestCount,
            cacheSize: this.personCache.size,
            rateLimitStatus: `${this.maxRequestsPerSecond} requests/second`,
            lastRequestTime: new Date(this.lastRequestTime).toISOString()
        };
    }

    /**
     * Clear caches (useful for testing)
     */
    clearCache() {
        this.personCache.clear();
        this.relationshipCache.clear();
        console.log('FamilySearch caches cleared');
    }
}

// Export for different environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FamilySearchIntegration;
} else if (typeof window !== 'undefined') {
    window.FamilySearchIntegration = FamilySearchIntegration;
}
