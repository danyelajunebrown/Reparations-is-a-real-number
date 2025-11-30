/**
 * Confidence Scoring System
 * Evaluates document quality and determines verification readiness
 */

class ConfidenceScorer {
  constructor() {
    // Document type weights
    this.documentWeights = {
      'will': 15,
      'probate': 15,
      'slave_schedule': 20,
      'census': 10,
      'estate_inventory': 12,
      'tax_record': 8,
      'correspondence': 5,
      'bill_of_sale': 18,
      'deed': 10,
      'baptismal': 7
    };
    
    // Minimum sources required for different confidence levels
    this.sourceRequirements = {
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1
    };
  }

  /**
   * Calculate comprehensive confidence score for slave ownership claim
   * @param {Object} ownerData - Owner and document data
   * @returns {Object} Confidence assessment
   */
  calculateConfidence(ownerData) {
    let score = 0;
    const sources = ownerData.documents || [];
    
    // PRIMARY SOURCE SCORING (B requirement - multiple sources)
    const primaryDocs = sources.filter(d => 
      ['will', 'probate', 'census', 'slave_schedule', 'estate_inventory', 
       'bill_of_sale', 'deed', 'tax_record'].includes(d.type)
    );
    
    if (primaryDocs.length === 0) {
      return { 
        score: 0, 
        level: 'INSUFFICIENT', 
        reason: 'No primary sources provided',
        canProceedToReview: false
      };
    }
    
    // Base score from number of corroborating sources
    if (primaryDocs.length === 1) {
      score = 40; // Single source - can't verify yet
    } else if (primaryDocs.length === 2) {
      score = 70; // Two sources - good corroboration
    } else if (primaryDocs.length >= 3) {
      score = 90; // Three+ sources - excellent
    }
    
    // DOCUMENT QUALITY SCORING (D - informed by document type)
    for (const doc of primaryDocs) {
      const weight = this.documentWeights[doc.type] || 5;
      score += weight;
    }
    
    // NAMED INDIVIDUALS BONUS
    if (ownerData.enslavedPeople && ownerData.enslavedPeople.length > 0) {
      const namedPeople = ownerData.enslavedPeople.filter(p => p.name && p.name !== 'Unknown');
      if (namedPeople.length > 0) {
        score += 10; // Names provide higher confidence than aggregate counts
      }
      
      // Bonus for family relationships documented
      const withRelationships = ownerData.enslavedPeople.filter(p => p.familyRelationship);
      if (withRelationships.length > 0) {
        score += 5;
      }
    }
    
    // LOCATION AND DATE VERIFICATION
    if (ownerData.location && ownerData.deathYear) {
      if (this.isHistoricallyConsistent(ownerData)) {
        score += 5;
      }
    }
    
    // CROSS-REFERENCE BONUS
    if (ownerData.crossReferences && ownerData.crossReferences.length > 0) {
      score += 10; // Multiple records mention same person
    }
    
    // Cap at 100
    score = Math.min(score, 100);
    
    // Determine level (matching your aunt's HIGH/MEDIUM/LOW/GAP system)
    let level;
    if (score >= 80) level = 'HIGH';
    else if (score >= 50) level = 'MEDIUM';
    else if (score >= 30) level = 'LOW';
    else level = 'GAP';
    
    return {
      score,
      level,
      primarySources: primaryDocs.length,
      documentTypes: primaryDocs.map(d => d.type),
      namedIndividuals: ownerData.enslavedPeople ? 
        ownerData.enslavedPeople.filter(p => p.name).length : 0,
      needsAdditionalResearch: score < 70,
      humanReviewRequired: true, // ALWAYS per requirement 2
      disputeRisk: score < 50 ? 'HIGH' : score < 70 ? 'MEDIUM' : 'LOW',
      canProceedToReview: primaryDocs.length >= 1, // At least one source to review
      recommendations: this.generateRecommendations(score, primaryDocs, ownerData)
    };
  }
  
  /**
   * Check if ownership claim is historically consistent
   */
  isHistoricallyConsistent(ownerData) {
    // Must be pre-emancipation
    if (ownerData.deathYear && ownerData.deathYear > 1865) {
      return false;
    }
    
    // Must be in slave-holding state
    const slaveStates = [
      'Virginia', 'Maryland', 'North Carolina', 'South Carolina', 'Georgia',
      'Alabama', 'Mississippi', 'Louisiana', 'Texas', 'Arkansas', 'Tennessee',
      'Kentucky', 'Missouri', 'Florida', 'Delaware'
    ];
    
    if (ownerData.location) {
      const inSlaveState = slaveStates.some(state => 
        ownerData.location.includes(state)
      );
      return inSlaveState;
    }
    
    return true; // Inconclusive
  }
  
  /**
   * Generate specific recommendations for improving confidence
   */
  generateRecommendations(score, primaryDocs, ownerData) {
    const recommendations = [];
    
    if (score < 70) {
      recommendations.push({
        priority: 'HIGH',
        action: 'Obtain additional primary sources',
        reason: 'Need multiple corroborating documents for verification'
      });
    }
    
    if (!primaryDocs.find(d => d.type === 'will')) {
      recommendations.push({
        priority: 'HIGH',
        action: 'Search for probate records or will',
        reason: 'Wills are strongest primary source for slave ownership'
      });
    }
    
    if (!primaryDocs.find(d => d.type === 'census' || d.type === 'slave_schedule')) {
      recommendations.push({
        priority: 'MEDIUM',
        action: 'Check census and slave schedule records',
        reason: 'Census provides independent verification'
      });
    }
    
    if (!ownerData.enslavedPeople || ownerData.enslavedPeople.filter(p => p.name).length === 0) {
      recommendations.push({
        priority: 'MEDIUM',
        action: 'Attempt to identify names of enslaved individuals',
        reason: 'Named individuals strengthen historical record'
      });
    }
    
    return recommendations;
  }
  
  /**
   * Compare two owner records to detect duplicates
   */
  compareOwnerRecords(record1, record2) {
    let matchScore = 0;
    
    // Name similarity
    if (record1.name.toLowerCase() === record2.name.toLowerCase()) {
      matchScore += 40;
    } else if (this.namesAreSimilar(record1.name, record2.name)) {
      matchScore += 25;
    }
    
    // Location match
    if (record1.location && record2.location) {
      if (record1.location.toLowerCase() === record2.location.toLowerCase()) {
        matchScore += 30;
      }
    }
    
    // Date overlap
    if (record1.deathYear && record2.deathYear) {
      const yearDiff = Math.abs(record1.deathYear - record2.deathYear);
      if (yearDiff <= 5) {
        matchScore += 30 - (yearDiff * 5);
      }
    }
    
    return {
      matchScore,
      isProbableDuplicate: matchScore >= 70,
      shouldFlagForReview: matchScore >= 50 && matchScore < 70
    };
  }
  
  /**
   * Simple name similarity check
   */
  namesAreSimilar(name1, name2) {
    const n1 = name1.toLowerCase().replace(/[^a-z]/g, '');
    const n2 = name2.toLowerCase().replace(/[^a-z]/g, '');
    
    // Check if one name contains the other
    if (n1.includes(n2) || n2.includes(n1)) {
      return true;
    }
    
    // Check for common abbreviations (Wm for William, etc)
    const abbreviations = {
      'wm': 'william',
      'thos': 'thomas',
      'jas': 'james',
      'chas': 'charles',
      'robt': 'robert'
    };
    
    for (const [abbr, full] of Object.entries(abbreviations)) {
      if ((n1.includes(abbr) && n2.includes(full)) || 
          (n2.includes(abbr) && n1.includes(full))) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Batch score multiple records
   */
  scoreMultipleRecords(ownerRecords) {
    return ownerRecords.map(record => ({
      recordId: record.id,
      ownerName: record.name,
      confidence: this.calculateConfidence(record),
      timestamp: new Date().toISOString()
    }));
  }
  
  /**
   * Export scoring parameters for transparency
   */
  exportScoringCriteria() {
    return {
      documentWeights: this.documentWeights,
      sourceRequirements: this.sourceRequirements,
      scoringVersion: '1.0.0',
      lastUpdated: new Date().toISOString()
    };
  }
}

// Export for different environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ConfidenceScorer;
} else if (typeof window !== 'undefined') {
  window.ConfidenceScorer = ConfidenceScorer;
}
