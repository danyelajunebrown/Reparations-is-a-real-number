/**
 * FamilySearch Reparations Integration
 * Processes FamilySearch data to identify enslaved ancestors and calculate descendant shares
 */

class FamilySearchReparationsIntegration {
    constructor(config = {}) {
        this.apiKey = config.apiKey || null;
        this.baseUrl = 'https://api.familysearch.org';
        this.accessToken = null;
        
        // Database connection (would be IndexedDB or server)
        this.db = config.database;
        
        // Cache for API responses
        this.personCache = new Map();
        this.descendantCache = new Map();
        
        // Reparations calculation settings
        this.baseReparationAmount = config.baseAmount || 1000000; // $1M per enslaved ancestor
        this.generationMultipliers = {
            1: 1.0,    // Direct children
            2: 0.5,    // Grandchildren
            3: 0.33,   // Great-grandchildren
            4: 0.25,   // Great-great-grandchildren
            5: 0.20    // 5th generation
        };
        
        // Rate limiting
        this.requestQueue = [];
        this.processing = false;
    }
    
    /**
     * Parse a FamilySearch person from UI/API data
     */
    parsePerson(data) {
        // Handle both API format and manual input
        return {
            personId: data.personId || data.id,
            fullName: data.fullName || data.name,
            givenName: data.givenName,
            familyName: data.familyName,
            birth: {
                year: data.birthYear || this.extractYear(data.birth),
                place: data.birthPlace || data.birth?.place
            },
            death: {
                year: data.deathYear || this.extractYear(data.death),
                place: data.deathPlace || data.death?.place,
                isDeceased: data.isDeceased !== false
            },
            marriage: data.marriage ? {
                date: data.marriage.date,
                place: data.marriage.place,
                spouseName: data.marriage.spouseName
            } : null,
            children: data.children || [],
            sources: data.sources || [],
            metadata: {
                importedAt: new Date().toISOString(),
                confidence: this.calculateConfidence(data)
            }
        };
    }
    
    extractYear(dateString) {
        if (!dateString) return null;
        if (typeof dateString === 'number') return dateString;
        const match = dateString.match(/\b(1[6-9]\d{2}|20[0-2]\d)\b/);
        return match ? parseInt(match[0]) : null;
    }
    
    /**
     * Process James Hopewell's data from the screenshots
     */
    processJamesHopewell() {
        const jamesData = {
            personId: 'MTRV-272',
            fullName: 'James Hopewell',
            givenName: 'James',
            familyName: 'Hopewell',
            birthYear: 1780,
            deathYear: null, // Deceased but year unknown
            isDeceased: true,
            marriage: {
                date: '13 March 1798',
                place: 'St. Mary, Maryland',
                spouseName: 'Angelica Chesley'
            },
            spouse: {
                personId: null, // Would need to fetch
                fullName: 'Angelica Chesley',
                birthYear: 1783,
                deathYear: null
            },
            children: [
                {
                    personId: null, // Would fetch from FamilySearch
                    fullName: 'Anne Maria Hopewell',
                    birthYear: 1799,
                    deathYear: 1881,
                    generation: 1
                },
                {
                    personId: null,
                    fullName: 'James Robert Hopewell',
                    birthYear: 1813,
                    deathYear: 1872,
                    generation: 1
                }
            ],
            sources: 9, // 9 sources attached in FamilySearch
            enslavementStatus: 'LIKELY_ENSLAVED', // Based on time period and location
            enslavementEvidence: [
                'Born in Maryland in 1780 during slavery era',
                'Married in St. Mary, Maryland (slave-holding county)',
                'Time period aligns with colonial slavery (1780-1865)',
                'Location in Maryland, a major slave-holding state'
            ]
        };
        
        return this.parsePerson(jamesData);
    }
    
    /**
     * Determine if a person was likely enslaved based on historical data
     */
    assessEnslavementStatus(person) {
        const indicators = {
            likelihood: 'UNKNOWN',
            confidence: 0,
            evidence: [],
            requiresReview: true
        };
        
        const birthYear = person.birth.year;
        const birthPlace = person.birth.place?.toLowerCase() || '';
        
        // Time period check (slavery era: 1619-1865)
        if (birthYear >= 1619 && birthYear <= 1865) {
            indicators.confidence += 30;
            indicators.evidence.push(`Born during slavery era (${birthYear})`);
        }
        
        // Geographic indicators - slave-holding states
        const slaveStates = [
            'maryland', 'virginia', 'north carolina', 'south carolina',
            'georgia', 'alabama', 'mississippi', 'louisiana', 'texas',
            'arkansas', 'tennessee', 'kentucky', 'missouri', 'florida',
            'delaware'
        ];
        
        const isSlaveState = slaveStates.some(state => birthPlace.includes(state));
        if (isSlaveState) {
            indicators.confidence += 25;
            indicators.evidence.push(`Born in slave-holding state: ${birthPlace}`);
        }
        
        // Documentation patterns
        if (person.sources.length < 3) {
            indicators.confidence += 15;
            indicators.evidence.push('Limited documentation (common for enslaved persons)');
        }
        
        // Name patterns (single names, classical names, Biblical names)
        const name = person.fullName.toLowerCase();
        const classicalNames = ['james', 'john', 'george', 'william', 'thomas'];
        if (classicalNames.some(n => name.includes(n)) && birthYear < 1800) {
            indicators.confidence += 10;
            indicators.evidence.push('Name pattern consistent with enslaved naming conventions');
        }
        
        // Set likelihood based on confidence score
        if (indicators.confidence >= 70) {
            indicators.likelihood = 'HIGHLY_LIKELY';
            indicators.requiresReview = false;
        } else if (indicators.confidence >= 50) {
            indicators.likelihood = 'LIKELY';
            indicators.requiresReview = true;
        } else if (indicators.confidence >= 30) {
            indicators.likelihood = 'POSSIBLE';
            indicators.requiresReview = true;
        } else {
            indicators.likelihood = 'UNLIKELY';
            indicators.requiresReview = true;
        }
        
        return indicators;
    }
    
    /**
     * Recursively fetch all descendants from FamilySearch
     * In production, this would make actual API calls
     */
    async fetchDescendants(personId, currentGeneration = 1, maxGenerations = 5) {
        if (currentGeneration > maxGenerations) {
            return [];
        }
        
        // Check cache first
        const cacheKey = `${personId}_gen${currentGeneration}`;
        if (this.descendantCache.has(cacheKey)) {
            return this.descendantCache.get(cacheKey);
        }
        
        // In production, this would call:
        // const response = await fetch(`${this.baseUrl}/platform/tree/persons/${personId}/children`);
        
        // For now, simulate with mock data
        const descendants = [];
        
        // Simulate API delay
        await this.delay(100);
        
        // Mock: Each person has 2-4 children
        const numChildren = 2 + Math.floor(Math.random() * 3);
        
        for (let i = 0; i < numChildren; i++) {
            const birthYear = 1800 + (currentGeneration * 25) + (i * 2);
            const isLiving = birthYear > 1920;
            
            const descendant = {
                personId: `DESC-${personId}-G${currentGeneration}-${i}`,
                fullName: `Descendant Gen${currentGeneration} #${i + 1}`,
                generation: currentGeneration,
                ancestorId: personId,
                birth: { year: birthYear },
                death: { isDeceased: !isLiving },
                isLiving: isLiving,
                children: []
            };
            
            // Recursively get their descendants
            if (currentGeneration < maxGenerations) {
                descendant.children = await this.fetchDescendants(
                    descendant.personId,
                    currentGeneration + 1,
                    maxGenerations
                );
            }
            
            descendants.push(descendant);
        }
        
        this.descendantCache.set(cacheKey, descendants);
        return descendants;
    }
    
    /**
     * Calculate reparations shares for all descendants
     */
    async calculateReparationsShares(ancestorId, ancestorData) {
        console.log('Calculating reparations for ancestor:', ancestorId);
        
        // Get all descendants
        const allDescendants = await this.fetchDescendants(ancestorId, 1, 5);
        
        // Flatten the tree
        const flatDescendants = this.flattenDescendantTree(allDescendants);
        
        // Filter to living descendants only
        const livingDescendants = flatDescendants.filter(d => d.isLiving);
        
        console.log(`Found ${flatDescendants.length} total descendants, ${livingDescendants.length} living`);
        
        // Calculate shares
        const shares = livingDescendants.map(descendant => {
            const generationMultiplier = this.generationMultipliers[descendant.generation] || 0.15;
            const shareAmount = this.baseReparationAmount * generationMultiplier;
            
            return {
                personId: descendant.personId,
                fullName: descendant.fullName,
                generation: descendant.generation,
                ancestorId: ancestorId,
                ancestorName: ancestorData.fullName,
                shareAmount: Math.floor(shareAmount),
                sharePercentage: (generationMultiplier * 100).toFixed(2),
                birthYear: descendant.birth.year,
                relationshipPath: this.buildRelationshipPath(descendant, ancestorData),
                verificationStatus: 'PENDING',
                claimStatus: 'UNCLAIMED',
                walletAddress: null,
                createdAt: new Date().toISOString()
            };
        });
        
        // Store in database
        if (this.db) {
            await this.saveReparationsShares(shares);
        }
        
        return {
            ancestorId: ancestorId,
            ancestorName: ancestorData.fullName,
            totalDescendants: flatDescendants.length,
            livingDescendants: livingDescendants.length,
            totalReparationsAmount: shares.reduce((sum, s) => sum + s.shareAmount, 0),
            shares: shares,
            calculatedAt: new Date().toISOString()
        };
    }
    
    /**
     * Flatten descendant tree into array
     */
    flattenDescendantTree(descendants, result = []) {
        for (const descendant of descendants) {
            result.push(descendant);
            if (descendant.children && descendant.children.length > 0) {
                this.flattenDescendantTree(descendant.children, result);
            }
        }
        return result;
    }
    
    /**
     * Build human-readable relationship path
     */
    buildRelationshipPath(descendant, ancestor) {
        const generation = descendant.generation;
        const relationships = {
            1: 'Child',
            2: 'Grandchild',
            3: 'Great-grandchild',
            4: 'Great-great-grandchild',
            5: '3rd Great-grandchild'
        };
        
        return relationships[generation] || `${generation}th generation descendant`;
    }
    
    /**
     * Save shares to database
     */
    async saveReparationsShares(shares) {
        for (const share of shares) {
            await this.db.reparationsShares.add(share);
        }
        console.log(`Saved ${shares.length} reparations shares to database`);
    }
    
    /**
     * Calculate confidence score for person data
     */
    calculateConfidence(data) {
        let score = 0;
        
        if (data.personId) score += 20;
        if (data.birthYear) score += 20;
        if (data.deathYear) score += 15;
        if (data.birthPlace) score += 15;
        if (data.sources && data.sources.length > 0) score += 30;
        
        return Math.min(score, 100);
    }
    
    /**
     * Search for person in FamilySearch
     */
    async searchPerson(query) {
        // In production: API call to FamilySearch search endpoint
        console.log('Searching FamilySearch for:', query);
        
        // Mock response
        return [{
            personId: 'MOCK-' + Date.now(),
            fullName: query.name,
            birthYear: query.birthYear,
            matchScore: 85
        }];
    }
    
    /**
     * Utility: delay for rate limiting
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * Generate comprehensive report for review
     */
    async generateDescendantReport(ancestorId) {
        const ancestor = this.personCache.get(ancestorId);
        const reparations = await this.calculateReparationsShares(ancestorId, ancestor);
        
        return {
            report: {
                title: `Reparations Descendant Report: ${ancestor.fullName}`,
                ancestorInfo: {
                    personId: ancestor.personId,
                    fullName: ancestor.fullName,
                    birth: ancestor.birth,
                    death: ancestor.death,
                    enslavementStatus: this.assessEnslavementStatus(ancestor)
                },
                statistics: {
                    totalDescendants: reparations.totalDescendants,
                    livingDescendants: reparations.livingDescendants,
                    generationsCounted: 5,
                    totalReparationsAmount: reparations.totalReparationsAmount,
                    averageShareAmount: Math.floor(
                        reparations.totalReparationsAmount / reparations.livingDescendants
                    )
                },
                descendantShares: reparations.shares,
                generationBreakdown: this.calculateGenerationBreakdown(reparations.shares)
            },
            generatedAt: new Date().toISOString()
        };
    }
    
    /**
     * Calculate breakdown by generation
     */
    calculateGenerationBreakdown(shares) {
        const breakdown = {};
        
        for (const share of shares) {
            const gen = share.generation;
            if (!breakdown[gen]) {
                breakdown[gen] = {
                    generation: gen,
                    count: 0,
                    totalAmount: 0,
                    averageAmount: 0
                };
            }
            
            breakdown[gen].count++;
            breakdown[gen].totalAmount += share.shareAmount;
        }
        
        // Calculate averages
        for (const gen in breakdown) {
            breakdown[gen].averageAmount = Math.floor(
                breakdown[gen].totalAmount / breakdown[gen].count
            );
        }
        
        return Object.values(breakdown);
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FamilySearchReparationsIntegration;
} else if (typeof window !== 'undefined') {
    window.FamilySearchReparationsIntegration = FamilySearchReparationsIntegration;
}
