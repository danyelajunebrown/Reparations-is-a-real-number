/**
 * Citation Tracker
 * Identifies missing documentation and research priorities
 */

class CitationTracker {
  constructor() {
    // Expected document types for complete research
    this.primaryDocumentTypes = [
      'will',
      'probate',
      'census',
      'slave_schedule',
      'estate_inventory'
    ];
    
    // Census years to check
    this.censusYears = [1790, 1800, 1810, 1820, 1830, 1840, 1850, 1860];
    
    // Research repositories by state
    this.repositories = this.initializeRepositories();
  }
  
  /**
   * Initialize research repository information
   */
  initializeRepositories() {
    return {
      'Maryland': {
        stateArchives: 'Maryland State Archives, Annapolis',
        countyArchives: {
          'St. Mary\'s County': 'St. Mary\'s County Historical Society',
          'Charles County': 'Charles County Archives',
          'Prince George\'s County': 'Prince George\'s County Archives'
        },
        online: [
          'https://msa.maryland.gov/',
          'https://www.familysearch.org',
          'https://www.ancestry.com'
        ]
      },
      'Virginia': {
        stateArchives: 'Library of Virginia, Richmond',
        online: ['https://www.lva.virginia.gov/', 'https://www.familysearch.org']
      },
      'District of Columbia': {
        archives: 'National Archives, Washington DC',
        online: [
          'https://www.archives.gov/',
          'http://civilwardc.org/' // DC emancipation records
        ]
      }
      // Add more states as needed
    };
  }
  
  /**
   * Track missing citations for an owner record
   */
  trackMissingCitations(ownerRecord) {
    const needed = [];
    const warnings = [];
    
    // What do we have?
    const documents = ownerRecord.documents || [];
    const hasWill = documents.some(d => d.type === 'will');
    const hasProbate = documents.some(d => d.type === 'probate');
    const hasCensus = documents.some(d => d.type === 'census');
    const hasSlaveSchedule = documents.some(d => d.type === 'slave_schedule');
    const hasEstateInventory = documents.some(d => d.type === 'estate_inventory');
    
    // CRITICAL: Need will or probate (B requirement - multiple sources)
    if (!hasWill && !hasProbate) {
      needed.push({
        type: 'WILL_OR_PROBATE',
        priority: 'CRITICAL',
        searchLocation: this.getSearchLocation(ownerRecord, 'probate'),
        expectedDate: ownerRecord.deathYear,
        searchInstructions: this.generateSearchInstructions('will', ownerRecord),
        estimatedTime: '1-2 hours',
        reasoning: 'Wills and probate records are primary sources for slave ownership'
      });
    }
    
    // Need census records
    if (!hasCensus && ownerRecord.birthYear < 1860) {
      const relevantYears = this.getRelevantCensusYears(
        ownerRecord.birthYear, 
        ownerRecord.deathYear
      );
      
      if (relevantYears.length > 0) {
        needed.push({
          type: 'CENSUS',
          years: relevantYears,
          priority: 'HIGH',
          searchLocation: this.getSearchLocation(ownerRecord, 'census'),
          searchInstructions: this.generateSearchInstructions('census', ownerRecord),
          estimatedTime: `${relevantYears.length} hours (1 per census year)`,
          reasoning: 'Census records provide independent verification and count verification'
        });
      }
    }
    
    // Need slave schedules (1850, 1860 only)
    if (!hasSlaveSchedule && ownerRecord.deathYear >= 1850) {
      const slaveScheduleYears = [1850, 1860].filter(y => 
        y >= (ownerRecord.birthYear || 0) && y <= (ownerRecord.deathYear || 1865)
      );
      
      if (slaveScheduleYears.length > 0) {
        needed.push({
          type: 'SLAVE_SCHEDULE',
          years: slaveScheduleYears,
          priority: 'HIGH',
          searchLocation: this.getSearchLocation(ownerRecord, 'census'),
          searchInstructions: 'Slave schedules are separate from population census. ' +
            'Search for "{name} slave schedule {year}" on Ancestry.com and FamilySearch.',
          note: 'Slave schedules provide most direct evidence of slave ownership',
          estimatedTime: '30 minutes per year'
        });
      }
    }
    
    // Estate inventory often has detailed lists
    if (!hasEstateInventory && (hasWill || hasProbate)) {
      needed.push({
        type: 'ESTATE_INVENTORY',
        priority: 'MEDIUM',
        searchLocation: this.getSearchLocation(ownerRecord, 'probate'),
        searchInstructions: 'Check probate packets for estate inventories. ' +
          'Often filed separately from will.',
        reasoning: 'Estate inventories may list enslaved people by name and value',
        estimatedTime: '30 minutes'
      });
    }
    
    // Check for unnamed individuals
    if (ownerRecord.notes && ownerRecord.notes.includes('residue')) {
      warnings.push({
        type: 'UNNAMED_INDIVIDUALS',
        severity: 'MEDIUM',
        message: 'Document mentions "residue of estate" - may indicate additional unnamed enslaved people',
        action: 'Search for estate settlement records and correspondence'
      });
    }
    
    // Check for inheritance chains
    if (ownerRecord.enslavedPeople && 
        ownerRecord.enslavedPeople.some(p => p.bequeathedTo)) {
      const inheritors = [...new Set(
        ownerRecord.enslavedPeople
          .filter(p => p.bequeathedTo)
          .map(p => p.bequeathedTo)
      )];
      
      warnings.push({
        type: 'INHERITANCE_CHAIN',
        severity: 'HIGH',
        message: `Enslaved people inherited by: ${inheritors.join(', ')}`,
        action: 'Research these inheritors as separate slave owners',
        inheritors: inheritors
      });
    }
    
    return {
      complete: needed.length === 0,
      missing: needed,
      warnings: warnings,
      canProceedToBlockchain: needed.filter(n => n.priority === 'CRITICAL').length === 0,
      researchPriority: this.calculateResearchPriority(needed),
      estimatedTotalTime: this.calculateEstimatedTime(needed)
    };
  }
  
  /**
   * Get relevant census years for a person's lifespan
   */
  getRelevantCensusYears(birthYear, deathYear) {
    return this.censusYears.filter(year => 
      year >= (birthYear || 0) && year <= (deathYear || 1865)
    );
  }
  
  /**
   * Generate specific search instructions
   */
  generateSearchInstructions(documentType, ownerRecord) {
    const name = ownerRecord.name;
    const location = ownerRecord.location || 'location unknown';
    const year = ownerRecord.deathYear || 'year unknown';
    
    switch(documentType) {
      case 'will':
        return `
1. Search FamilySearch: "${name} will ${location}"
2. Search Ancestry.com: Wills & Probate collection for ${location}
3. Contact county archives: ${this.getCountyArchive(location)}
4. Search terms: "${name} probate", "${name} estate", "${name} testament"
5. Expected probate year: ${year} or shortly after
6. Look for: Original will, probate petition, estate settlement
        `.trim();
        
      case 'census':
        return `
1. Search Ancestry.com census collection for ${location}
2. Search FamilySearch census images
3. Use wildcard searches: ${name.split(' ')[0]}* ${name.split(' ').slice(-1)[0]}
4. Check neighbors and family members for cross-reference
5. Look for: Population schedule AND slave schedule (separate documents)
6. Relevant years: ${this.getRelevantCensusYears(ownerRecord.birthYear, ownerRecord.deathYear).join(', ')}
        `.trim();
        
      case 'probate':
        return `
1. Contact: ${this.getSearchLocation(ownerRecord, 'probate')}
2. Request: Complete probate packet for ${name}, died ${year}
3. Ask for: Will, estate inventory, final settlement, receipts
4. Online: Check FamilySearch probate index
5. Alternative: Orphans Court records (Maryland) or equivalent
        `.trim();
        
      default:
        return `Search genealogy databases for ${name} in ${location} around ${year}`;
    }
  }
  
  /**
   * Get search location for document type
   */
  getSearchLocation(ownerRecord, documentType) {
    const location = ownerRecord.location || '';
    
    // Extract state
    let state = null;
    for (const [stateName, info] of Object.entries(this.repositories)) {
      if (location.includes(stateName)) {
        state = stateName;
        break;
      }
    }
    
    if (!state) {
      return `County archives in ${location}`;
    }
    
    const repo = this.repositories[state];
    
    if (documentType === 'probate' || documentType === 'will') {
      // Check for county-specific archive
      for (const [county, archive] of Object.entries(repo.countyArchives || {})) {
        if (location.includes(county)) {
          return archive;
        }
      }
      return repo.stateArchives;
    }
    
    if (documentType === 'census') {
      return 'Ancestry.com or FamilySearch (digitized)';
    }
    
    return repo.stateArchives;
  }
  
  /**
   * Get county archive information
   */
  getCountyArchive(location) {
    for (const [state, info] of Object.entries(this.repositories)) {
      if (location.includes(state)) {
        for (const [county, archive] of Object.entries(info.countyArchives || {})) {
          if (location.includes(county)) {
            return archive;
          }
        }
        return info.stateArchives;
      }
    }
    return 'Local county historical society';
  }
  
  /**
   * Calculate overall research priority
   */
  calculateResearchPriority(missingCitations) {
    const hasCritical = missingCitations.some(m => m.priority === 'CRITICAL');
    const highCount = missingCitations.filter(m => m.priority === 'HIGH').length;
    
    if (hasCritical) return 'CRITICAL';
    if (highCount >= 2) return 'HIGH';
    if (highCount === 1) return 'MEDIUM';
    return 'LOW';
  }
  
  /**
   * Calculate estimated total research time
   */
  calculateEstimatedTime(missingCitations) {
    let totalHours = 0;
    
    for (const citation of missingCitations) {
      const timeStr = citation.estimatedTime || '1 hour';
      const hours = parseFloat(timeStr) || 1;
      totalHours += hours;
    }
    
    if (totalHours < 1) return `${Math.round(totalHours * 60)} minutes`;
    if (totalHours === 1) return '1 hour';
    return `${Math.round(totalHours)} hours`;
  }
  
  /**
   * Generate research action plan
   */
  generateResearchPlan(ownerRecord) {
    const analysis = this.trackMissingCitations(ownerRecord);
    
    // Sort by priority
    const priorityOrder = { 'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3 };
    analysis.missing.sort((a, b) => 
      priorityOrder[a.priority] - priorityOrder[b.priority]
    );
    
    return {
      ownerName: ownerRecord.name,
      currentStatus: analysis.complete ? 'COMPLETE' : 'INCOMPLETE',
      overallPriority: analysis.researchPriority,
      estimatedTime: analysis.estimatedTotalTime,
      canProceedToBlockchain: analysis.canProceedToBlockchain,
      actionItems: analysis.missing.map((item, index) => ({
        step: index + 1,
        ...item
      })),
      warnings: analysis.warnings,
      generatedAt: new Date().toISOString()
    };
  }
  
  /**
   * Track research progress
   */
  trackResearchProgress(ownerRecord, completedItems) {
    const plan = this.generateResearchPlan(ownerRecord);
    const total = plan.actionItems.length;
    const completed = completedItems.length;
    
    return {
      progress: total > 0 ? Math.round((completed / total) * 100) : 100,
      completed: completed,
      total: total,
      remaining: total - completed,
      nextAction: plan.actionItems.find(item => 
        !completedItems.includes(item.type)
      )
    };
  }
  
  /**
   * Export citation gaps for reporting
   */
  exportGapsReport(ownerRecords) {
    return ownerRecords.map(record => {
      const plan = this.generateResearchPlan(record);
      return {
        owner: record.name,
        status: plan.currentStatus,
        priority: plan.overallPriority,
        missingCount: plan.actionItems.length,
        criticalGaps: plan.actionItems.filter(a => a.priority === 'CRITICAL').length,
        estimatedTime: plan.estimatedTime
      };
    });
  }
}

// Export for different environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CitationTracker;
} else if (typeof window !== 'undefined') {
  window.CitationTracker = CitationTracker;
}
