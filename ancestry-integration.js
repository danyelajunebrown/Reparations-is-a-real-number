/**

- Ancestry.com Integration Module
- Handles census records, wills, and estate documentation search
  */

class AncestryIntegration {
constructor() {
this.apiKey = null;
this.baseUrl = ‘https://api.ancestry.com’;
this.cache = new Map();
this.requestCount = 0;
this.lastRequestTime = 0;
this.rateLimitDelay = 1000; // 1 second between requests
}

```
initialize(apiKey) {
    this.apiKey = apiKey;
    console.log('Ancestry.com API initialized');
}

async rateLimitCheck() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.rateLimitDelay) {
        const waitTime = this.rateLimitDelay - timeSinceLastRequest;
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
    this.requestCount++;
}

async searchDocuments(personName, location, dateRange) {
    await this.rateLimitCheck();
    
    const params = new URLSearchParams({
        name: personName,
        location: location,
        startYear: dateRange.start,
        endYear: dateRange.end,
        collection: 'census,wills,estate'
    });

    try {
        const response = await fetch(`${this.baseUrl}/search/documents?${params}`, {
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Ancestry API error: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Ancestry document search error:', error);
        throw error;
    }
}

async getCensusRecords(personName, year, location) {
    const cacheKey = `census_${personName}_${year}_${location}`;
    if (this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey);
    }

    await this.rateLimitCheck();

    try {
        const response = await fetch(`${this.baseUrl}/records/census`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: personName,
                year: year,
                location: location,
                includeSlaveSchedules: true
            })
        });

        const data = await response.json();
        this.cache.set(cacheKey, data);
        return data;
    } catch (error) {
        console.error('Census records error:', error);
        throw error;
    }
}

async getWillRecords(personName, deathYear, location) {
    await this.rateLimitCheck();

    try {
        const response = await fetch(`${this.baseUrl}/records/wills`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                testator: personName,
                probateYear: deathYear,
                location: location
            })
        });

        return await response.json();
    } catch (error) {
        console.error('Will records error:', error);
        throw error;
    }
}

async getSlaveSchedules(personName, censusYear, county, state) {
    await this.rateLimitCheck();

    try {
        const response = await fetch(`${this.baseUrl}/records/slave-schedules`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                slaveowner: personName,
                year: censusYear,
                county: county,
                state: state
            })
        });

        return await response.json();
    } catch (error) {
        console.error('Slave schedule error:', error);
        throw error;
    }
}

async searchCorrespondence(personName, timeframe, keywords = ['slave', 'negro', 'plantation']) {
    await this.rateLimitCheck();

    const searchTerms = keywords.map(keyword => `"${keyword}"`).join(' OR ');

    try {
        const response = await fetch(`${this.baseUrl}/search/correspondence`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                person: personName,
                dateRange: timeframe,
                keywords: searchTerms,
                collections: ['letters', 'business-records', 'plantation-records']
            })
        });

        return await response.json();
    } catch (error) {
        console.error('Correspondence search error:', error);
        return { documents: [] }; // Return empty if not available
    }
}

/**
 * Comprehensive ancestor research for your 5-step process
 */
async researchSlaveOwningAncestor(ancestorName, birthYear, deathYear, locations) {
    const results = {
        ancestorName,
        birthYear,
        deathYear,
        locations,
        censusRecords: [],
        willRecords: [],
        correspondenceRecords: [],
        totalSlavesCounted: 0,
        documentSources: [],
        researchDate: new Date().toISOString()
    };

    try {
        // Step 1: Search all available census years
        const censusYears = [1820, 1830, 1840, 1850, 1860];
        for (const year of censusYears) {
            if (year >= birthYear && year <= deathYear) {
                for (const location of locations) {
                    try {
                        const censusData = await this.getCensusRecords(ancestorName, year, location);
                        if (censusData.records && censusData.records.length > 0) {
                            results.censusRecords.push(...censusData.records);
                            results.documentSources.push(`${year} Census - ${location}`);
                        }

                        // Also search for slave schedules specifically
                        const [county, state] = location.split(', ');
                        const slaveSchedules = await this.getSlaveSchedules(ancestorName, year, county, state);
                        if (slaveSchedules.schedules) {
                            results.censusRecords.push(...slaveSchedules.schedules);
                            results.documentSources.push(`${year} Slave Schedule - ${location}`);
                        }
                    } catch (error) {
                        console.log(`No ${year} census found for ${ancestorName} in ${location}`);
                    }
                }
            }
        }

        // Step 2: Search for wills and probate records
        for (const location of locations) {
            try {
                const willData = await this.getWillRecords(ancestorName, deathYear, location);
                if (willData.wills && willData.wills.length > 0) {
                    results.willRecords.push(...willData.wills);
                    results.documentSources.push(`Will/Probate - ${location}`);
                }
            } catch (error) {
                console.log(`No will records found for ${ancestorName} in ${location}`);
            }
        }

        // Step 3: Search correspondence and business records
        try {
            const correspondence = await this.searchCorrespondence(
                ancestorName, 
                { start: birthYear, end: deathYear }
            );
            if (correspondence.documents && correspondence.documents.length > 0) {
                results.correspondenceRecords.push(...correspondence.documents);
                results.documentSources.push('Correspondence/Business Records');
            }
        } catch (error) {
            console.log(`No correspondence found for ${ancestorName}`);
        }

        // Calculate total slave count from all sources
        results.totalSlavesCounted = this.calculateTotalSlaveCount(results);

        return results;

    } catch (error) {
        console.error(`Error researching ${ancestorName}:`, error);
        throw error;
    }
}

calculateTotalSlaveCount(researchResults) {
    let total = 0;

    // Count from census records
    researchResults.censusRecords.forEach(record => {
        if (record.slaveCount) {
            total += record.slaveCount;
        }
    });

    // Count from will records
    researchResults.willRecords.forEach(will => {
        if (will.slavesListed) {
            total += will.slavesListed.length;
        }
    });

    // Note: This is a simplified count - you'd want to implement 
    // your deduplication logic here based on your billing rules
    
    return total;
}

/**
 * Export research results for blockchain submission
 */
exportForBlockchain(researchResults) {
    return {
        ancestorName: researchResults.ancestorName,
        totalSlaveCount: researchResults.totalSlavesCounted,
        evidenceSources: researchResults.documentSources,
        documentHashes: researchResults.documentSources.map(source => 
            this.generateDocumentHash(source)
        ),
        verificationLevel: this.calculateVerificationLevel(researchResults),
        researchDate: researchResults.researchDate
    };
}

calculateVerificationLevel(results) {
    let score = 0;
    
    // Points for different types of evidence
    if (results.censusRecords.length > 0) score += 3;
    if (results.willRecords.length > 0) score += 4;
    if (results.correspondenceRecords.length > 0) score += 2;
    
    // Points for multiple sources
    if (results.documentSources.length > 2) score += 2;
    
    // Convert to confidence level
    if (score >= 8) return 'high';
    if (score >= 5) return 'medium';
    return 'low';
}

generateDocumentHash(source) {
    // Simple hash for document verification
    return btoa(source + new Date().toDateString()).substring(0, 16);
}

clearCache() {
    this.cache.clear();
    console.log('Ancestry API cache cleared');
}

getUsageStats() {
    return {
        totalRequests: this.requestCount,
        cacheSize: this.cache.size,
        rateLimitDelay: this.rateLimitDelay
    };
}
```

}

// Export for different environments
if (typeof module !== ‘undefined’ && module.exports) {
module.exports = AncestryIntegration;
} else if (typeof window !== ‘undefined’) {
window.AncestryIntegration = AncestryIntegration;
}
