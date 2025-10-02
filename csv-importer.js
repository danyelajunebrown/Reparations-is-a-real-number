/**
 * CSV Importer for Ancestor Slavery Records
 * Parses genealogical research and routes through verification system
 */
class CSVImporter {
  constructor(confidenceScorer, citationTracker, reviewQueue) {
    this.confidenceScorer = confidenceScorer;
    this.citationTracker = citationTracker;
    this.reviewQueue = reviewQueue;
    
    // Track processed data
    this.owners = new Map();
    this.enslavedPeople = new Map();
    this.documents = new Map();
    this.inheritanceChains = [];
    this.researchGaps = [];
  }
  
  /**
   * Parse CSV data from your aunt's format
   * Expected columns: Owner Name, Birth/Death Dates, Location, Source Document, 
   * Enslaved Person Name, Bequeathed To, Family Relationship, Documentation Link, 
   * Additional Research Needed
   */
  async importCSV(csvText) {
    console.log('Starting CSV import');
    
    // Parse CSV using Papa Parse (already in your project)
    const parsed = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      transformHeader: (header) => header.trim()
    });
    
    if (parsed.errors.length > 0) {
      console.error('CSV parsing errors:', parsed.errors);
      throw new Error('CSV parsing failed');
    }
    
    const rows = parsed.data;
    console.log(`Parsed ${rows.length} rows`);
    
    // Process each row
    for (const row of rows) {
      console.log('Row data:', row);
      await this.processRow(row);
    }
    
    // Build relationships
    this.buildRelationships();
    
    // Generate final report
    return this.generateImportReport();
  }
  
  /**
   * Process a single CSV row
   */
  async processRow(row) {
    const ownerName = row['Owner Name']?.trim();
    
    console.log('Processing row:', ownerName, row);
    
    // Skip header rows or empty rows
    if (!ownerName || ownerName === 'Owner Name' || 
        ownerName.startsWith('RESEARCH PRIORITIES') ||
        ownerName.startsWith('HIGH PRIORITY') ||
        ownerName.startsWith('MEDIUM PRIORITY') ||
        ownerName.startsWith('ARCHIVES TO VISIT') ||
        ownerName.startsWith('IMMEDIATE NEXT STEPS')) {
      return;
    }
    
    // Extract owner data
    const owner = this.extractOwner(row);
    
    // Extract enslaved person
    const enslavedPerson = this.extractEnslavedPerson(row);
    
    // Extract document
    const document = this.extractDocument(row);
    
    // Extract research gaps
    const researchGap = this.extractResearchGap(row);
    
    // Store data
    if (owner) {
      this.addOrUpdateOwner(owner);
    }
    
    if (enslavedPerson) {
      this.addEnslavedPerson(enslavedPerson, ownerName);
    }
    
    if (document) {
      this.addDocument(document, ownerName);
    }
    
    if (researchGap) {
      this.researchGaps.push(researchGap);
    }
    
    // Track inheritance
    if (row['Bequeathed To']?.trim()) {
      this.inheritanceChains.push({
        from: ownerName,
        to: row['Bequeathed To'].trim(),
        enslaved: enslavedPerson?.name,
        document: document?.type
      });
    }
  }
  
  /**
   * Extract owner information from row
   */
  extractOwner(row) {
    const name = row['Owner Name']?.trim();
    if (!name) return null;
    
    // Parse dates (format: "Will: 2/14/1816 Probate: 12/23/1817" or "Unknown")
    const datesStr = row['Birth/Death Dates']?.trim() || '';
    const dates = this.parseDates(datesStr);
    
    return {
      name: name,
      birthYear: dates.birthYear,
      deathYear: dates.deathYear,
      willDate: dates.willDate,
      probateDate: dates.probateDate,
      location: row['Location']?.trim() || '',
      notes: row['Additional Research Needed']?.trim() || '',
      needsResearch: !!row['Additional Research Needed']?.trim()
    };
  }
  
  /**
   * Parse date strings from various formats
   */
  parseDates(dateStr) {
    const result = {
      birthYear: null,
      deathYear: null,
      willDate: null,
      probateDate: null
    };
    
    // "Will: 2/14/1816 Probate: 12/23/1817"
    const willMatch = dateStr.match(/Will:\s*(\d{1,2}\/\d{1,2}\/(\d{4}))/);
    if (willMatch) {
      result.willDate = willMatch[1];
      result.deathYear = parseInt(willMatch[2]);
    }
    
    const probateMatch = dateStr.match(/Probate:\s*(\d{1,2}\/\d{1,2}\/(\d{4}))/);
    if (probateMatch) {
      result.probateDate = probateMatch[1];
    }
    
    // "Active 1814-1862+"
    const activeMatch = dateStr.match(/Active\s+(\d{4})-(\d{4})/);
    if (activeMatch) {
      result.birthYear = parseInt(activeMatch[1]);
      result.deathYear = parseInt(activeMatch[2]);
    }
    
    return result;
  }
  
  /**
   * Extract enslaved person from row
   */
  extractEnslavedPerson(row) {
    const name = row['Enslaved Person Name']?.trim();
    if (!name) return null;
    
    // Handle unnamed people: "[Unnamed girl]"
    const isUnnamed = name.startsWith('[') && name.endsWith(']');
    
    return {
      name: name,
      isUnnamed: isUnnamed,
      bequeathedTo: row['Bequeathed To']?.trim() || null,
      familyRelationship: row['Family Relationship']?.trim() || null,
      owner: row['Owner Name']?.trim()
    };
  }
  
  /**
   * Extract document information
   */
  extractDocument(row) {
    const sourceDoc = row['Source Document']?.trim();
    if (!sourceDoc) return null;
    
    // Determine document type
    let type = 'unknown';
    if (sourceDoc.includes('Will')) type = 'will';
    else if (sourceDoc.includes('Census')) type = 'census';
    else if (sourceDoc.includes('Slave Schedule')) type = 'slave_schedule';
    else if (sourceDoc.includes('Emancipation')) type = 'emancipation';
    else if (sourceDoc.includes('Probate')) type = 'probate';
    else if (sourceDoc.includes('Estate')) type = 'estate_inventory';
    
    return {
      type: type,
      description: sourceDoc,
      url: row['Documentation Link']?.trim() || null,
      location: row['Location']?.trim() || ''
    };
  }
  
  /**
   * Extract research gaps
   */
  extractResearchGap(row) {
    const gap = row['Additional Research Needed']?.trim();
    if (!gap) return null;
    
    return {
      owner: row['Owner Name']?.trim(),
      description: gap,
      priority: this.assessGapPriority(gap)
    };
  }
  
  /**
   * Assess priority of research gap
   */
  assessGapPriority(gapDescription) {
    const lower = gapDescription.toLowerCase();
    if (lower.includes('critical') || lower.includes('find will')) return 'CRITICAL';
    if (lower.includes('locate') || lower.includes('access')) return 'HIGH';
    if (lower.includes('clarify') || lower.includes('confirm')) return 'MEDIUM';
    return 'LOW';
  }
  
  /**
   * Add or update owner in collection
   */
  addOrUpdateOwner(owner) {
    if (this.owners.has(owner.name)) {
      // Merge data
      const existing = this.owners.get(owner.name);
      this.owners.set(owner.name, Object.assign({}, existing, owner, {
        notes: existing.notes + (owner.notes ? '\n' + owner.notes : '')
      }));
    } else {
      this.owners.set(owner.name, Object.assign({}, owner, {
        enslavedPeople: [],
        documents: [],
        totalCount: 0
      }));
    }
  }
  
  /**
   * Add enslaved person to owner's record
   */
  addEnslavedPerson(person, ownerName) {
    if (!this.owners.has(ownerName)) {
      console.warn(`Owner ${ownerName} not found for enslaved person ${person.name}`);
      return;
    }
    
    const owner = this.owners.get(ownerName);
    owner.enslavedPeople.push(person);
    owner.totalCount++;
    
    // Track globally
    const personId = `${ownerName}_${person.name}`;
    this.enslavedPeople.set(personId, person);
  }
  
  /**
   * Add document to owner's record
   */
  addDocument(document, ownerName) {
    if (!this.owners.has(ownerName)) {
      console.warn(`Owner ${ownerName} not found for document`);
      return;
    }
    
    const owner = this.owners.get(ownerName);
    
    // Avoid duplicates
    const exists = owner.documents.some(d => 
      d.type === document.type && d.description === document.description
    );
    
    if (!exists) {
      owner.documents.push(document);
    }
    
    // Track globally
    const docId = `${ownerName}_${document.type}_${Date.now()}`;
    this.documents.set(docId, document);
  }
  
  /**
   * Build family relationships among enslaved people
   */
  buildRelationships() {
    console.log('Building family relationships...');
    
    for (const [ownerId, owner] of this.owners) {
      const people = owner.enslavedPeople;
      
      // Find parent-child relationships
      for (const person of people) {
        if (person.familyRelationship) {
          const rel = person.familyRelationship.toLowerCase();
          
          // "Mother of 7 children" or "Child of Minna"
          if (rel.includes('child of')) {
            const parentName = rel.replace(/child of/i, '').trim();
            person.parentName = parentName;
            
            // Find parent in same owner's list
            const parent = people.find(p => 
              p.name.toLowerCase() === parentName.toLowerCase()
            );
            if (parent) {
              if (!parent.children) parent.children = [];
              parent.children.push(person.name);
            }
          }
          
          if (rel.includes('mother of') || rel.includes('father of')) {
            const countMatch = rel.match(/(\d+)/);
            if (countMatch) {
              person.childrenCount = parseInt(countMatch[1]);
              person.children = [];
            }
          }
        }
      }
    }
  }
  
  /**
   * Route imported data through verification system
   */
  async submitForVerification(submittedBy = 'csv_import') {
    console.log('Submitting records for verification...');
    
    const submissions = [];
    
    for (const [ownerName, ownerData] of this.owners) {
      // Calculate confidence
      const confidence = this.confidenceScorer.calculateConfidence(ownerData);
      
      // Track citations
      const citations = this.citationTracker.trackMissingCitations(ownerData);
      
      // Submit to review queue
      const submission = await this.reviewQueue.submitForReview(
        ownerData,
        confidence,
        submittedBy
      );
      
      submissions.push({
        owner: ownerName,
        reviewId: submission.reviewId,
        confidence: confidence.level,
        missingCitations: citations.missing.length,
        status: submission.status
      });
      
      console.log(`Submitted ${ownerName}: ${confidence.level} confidence, ` +
                  `${citations.missing.length} missing citations`);
    }
    
    return submissions;
  }
  
  /**
   * Generate import report
   */
  generateImportReport() {
    const report = {
      summary: {
        ownersImported: this.owners.size,
        enslavedPeopleImported: this.enslavedPeople.size,
        documentsImported: this.documents.size,
        inheritanceChainsFound: this.inheritanceChains.length,
        researchGapsIdentified: this.researchGaps.length
      },
      owners: Array.from(this.owners.entries()).map(([name, data]) => ({
        name: name,
        enslaved: data.totalCount,
        documents: data.documents.length,
        needsResearch: data.needsResearch,
        location: data.location
      })),
      researchGaps: this.researchGaps,
      inheritanceChains: this.inheritanceChains,
      importedAt: new Date().toISOString()
    };
    
    console.log('Import complete:', report.summary);
    return report;
  }
  
  /**
   * Get imported owners for FamilySearch lookup
   */
  getOwnersForFamilySearch() {
    return Array.from(this.owners.values()).map(owner => ({
      name: owner.name,
      birthYear: owner.birthYear,
      deathYear: owner.deathYear,
      location: owner.location,
      enslavedCount: owner.totalCount
    }));
  }
  
  /**
   * Get owner by name (for FamilySearch matching)
   */
  getOwner(name) {
    return this.owners.get(name);
  }
  
  /**
   * Export all data as JSON
   */
  exportJSON() {
    return {
      owners: Array.from(this.owners.entries()),
      enslavedPeople: Array.from(this.enslavedPeople.entries()),
      documents: Array.from(this.documents.entries()),
      inheritanceChains: this.inheritanceChains,
      researchGaps: this.researchGaps
    };
  }
}

// Export for different environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CSVImporter;
} else if (typeof window !== 'undefined') {
  window.CSVImporter = CSVImporter;
}
