/**
 * Colonial American Document Parser
 * Extracts slave ownership data from 17th-19th century American documents
 * Handles Colonial American English, archaic spellings, and legal language
 *
 * Features:
 * - Supports both OCR text and pre-parsed/transcribed text
 * - Learns from examples to improve accuracy over time
 * - Stores patterns and known entities
 */

const llmAssistant = require('./llm-conversational-assistant');
const fs = require('fs').promises;
const path = require('path');

class ColonialAmericanDocumentParser {
  constructor(config = {}) {
    this.llmEnabled = !!process.env.OPENROUTER_API_KEY;
    this.confidence = config.defaultConfidence || 0.7;
    this.learningEnabled = config.learningEnabled !== false; // Default true

    // Storage for learned patterns and examples
    this.patternsFile = config.patternsFile || './data/learned-patterns.json';
    this.examplesFile = config.examplesFile || './data/training-examples.json';

    // Loaded patterns and examples
    this.learnedPatterns = [];
    this.trainingExamples = [];
    this.knownNames = new Set();
    this.knownOwners = new Set();

    if (!this.llmEnabled) {
      console.warn('⚠ OpenRouter API key not configured - parsing will use regex + learned patterns');
    } else {
      console.log('✓ LLM-powered Colonial American document parser enabled');
    }

    // Load learned patterns on startup
    if (this.learningEnabled) {
      this.loadLearnedPatterns().catch(err =>
        console.warn('Could not load learned patterns:', err.message)
      );
    }
  }

  /**
   * Load learned patterns and examples from storage
   */
  async loadLearnedPatterns() {
    try {
      // Load patterns
      try {
        const patternsData = await fs.readFile(this.patternsFile, 'utf8');
        const patterns = JSON.parse(patternsData);
        this.learnedPatterns = patterns.patterns || [];
        this.knownNames = new Set(patterns.knownNames || []);
        this.knownOwners = new Set(patterns.knownOwners || []);
        console.log(`✓ Loaded ${this.learnedPatterns.length} learned patterns, ${this.knownNames.size} known names`);
      } catch (err) {
        // Files don't exist yet - that's okay
        console.log('No learned patterns file found - will create on first save');
      }

      // Load training examples
      try {
        const examplesData = await fs.readFile(this.examplesFile, 'utf8');
        this.trainingExamples = JSON.parse(examplesData);
        console.log(`✓ Loaded ${this.trainingExamples.length} training examples`);
      } catch (err) {
        console.log('No training examples file found - will create on first save');
      }
    } catch (error) {
      console.warn('Error loading learned patterns:', error.message);
    }
  }

  /**
   * Save learned patterns and examples
   */
  async saveLearnedPatterns() {
    if (!this.learningEnabled) return;

    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.patternsFile);
      await fs.mkdir(dataDir, { recursive: true });

      // Save patterns
      const patternsData = {
        patterns: this.learnedPatterns,
        knownNames: Array.from(this.knownNames),
        knownOwners: Array.from(this.knownOwners),
        lastUpdated: new Date().toISOString()
      };
      await fs.writeFile(this.patternsFile, JSON.stringify(patternsData, null, 2));

      // Save training examples
      await fs.writeFile(this.examplesFile, JSON.stringify(this.trainingExamples, null, 2));

      console.log('✓ Saved learned patterns and training examples');
    } catch (error) {
      console.error('Error saving learned patterns:', error.message);
    }
  }

  /**
   * Parse document with pre-parsed/transcribed text
   * Use this when you have a clean transcription instead of OCR
   */
  async parsePreParsedDocument(transcribedText, metadata = {}) {
    metadata.isPreParsed = true;
    metadata.textSource = 'transcription';
    return await this.parseDocument(transcribedText, metadata);
  }

  /**
   * Train the parser from a known-good example
   * Use this to improve accuracy by providing correct extractions
   */
  async trainFromExample(documentText, correctExtractions, metadata = {}) {
    console.log('Training from example...');

    // Store the training example
    const example = {
      text: documentText,
      metadata: metadata,
      extractions: correctExtractions,
      addedAt: new Date().toISOString()
    };

    this.trainingExamples.push(example);

    // Learn names and owners from this example
    if (correctExtractions.owner_name) {
      this.knownOwners.add(correctExtractions.owner_name);
    }

    correctExtractions.enslaved_people?.forEach(person => {
      if (person.name) {
        this.knownNames.add(person.name);
        if (person.normalized_name && person.normalized_name !== person.name) {
          this.knownNames.add(person.normalized_name);
        }
      }
    });

    // Learn patterns from the document
    this.learnPatternsFromExample(documentText, correctExtractions);

    // Save updated patterns
    await this.saveLearnedPatterns();

    console.log(`✓ Learned from example: ${correctExtractions.enslaved_people?.length || 0} people`);

    return {
      success: true,
      learnedNames: correctExtractions.enslaved_people?.length || 0,
      totalKnownNames: this.knownNames.size,
      totalTrainingExamples: this.trainingExamples.length
    };
  }

  /**
   * Extract patterns from a known-good example
   */
  learnPatternsFromExample(text, extractions) {
    extractions.enslaved_people?.forEach(person => {
      // Find where this person appears in the text
      const nameLower = person.name.toLowerCase();
      const textLower = text.toLowerCase();
      const index = textLower.indexOf(nameLower);

      if (index >= 0) {
        // Extract context around the name (50 chars before and after)
        const start = Math.max(0, index - 50);
        const end = Math.min(text.length, index + person.name.length + 50);
        const context = text.substring(start, end);

        // Store this pattern
        this.learnedPatterns.push({
          name: person.name,
          age: person.age,
          gender: person.gender,
          context: context,
          pattern: this.extractPattern(context, person.name),
          confidence: 0.8,
          learnedFrom: extractions.owner_name || 'unknown',
          learnedAt: new Date().toISOString()
        });
      }
    });

    // Keep only the most recent 1000 patterns to avoid memory issues
    if (this.learnedPatterns.length > 1000) {
      this.learnedPatterns = this.learnedPatterns.slice(-1000);
    }
  }

  /**
   * Extract a reusable pattern from context
   */
  extractPattern(context, name) {
    // Replace the specific name with a placeholder
    return context.replace(new RegExp(name, 'gi'), '__NAME__');
  }

  /**
   * Parse historical document text and extract enslaved people information
   */
  async parseDocument(ocrText, metadata = {}) {
    const { documentType = 'unknown', owner = null, year = null, location = null, isPreParsed = false, textSource = 'ocr' } = metadata;

    console.log(`\nParsing ${documentType} document...`);
    console.log(`Document length: ${ocrText.length} characters`);

    if (!ocrText || ocrText.trim().length < 50) {
      console.warn('Document text too short for parsing');
      return {
        success: false,
        error: 'Document text too short',
        enslaved_people: [],
        confidence: 0
      };
    }

    try {
      // Try LLM-based parsing first (most accurate)
      if (this.llmEnabled) {
        return await this.parseLLM(ocrText, metadata);
      } else {
        // Fallback to regex-based parsing
        return await this.parseRegex(ocrText, metadata);
      }
    } catch (error) {
      console.error('Document parsing error:', error);

      // If LLM fails, fallback to regex
      if (this.llmEnabled) {
        console.log('LLM parsing failed, falling back to regex...');
        return await this.parseRegex(ocrText, metadata);
      }

      throw error;
    }
  }

  /**
   * LLM-based parsing (ACCURATE - handles Colonial American English, spelling variations, context)
   */
  async parseLLM(ocrText, metadata) {
    const { documentType, owner, year, location, isPreParsed = false } = metadata;

    const systemPrompt = `You are an expert historian analyzing ${documentType || 'historical'} documents from Colonial and Early America (1600s-1800s).

**Task:** Extract ALL enslaved people mentioned in this document.

**Important - Colonial American English:**
- Handle period spellings: "negro", "negroe", "negroes", "slave", "servants", "mulatto", "coloured"
- Legal terminology: "I bequeath", "I give and devise", "Item:", "to wit"
- Extract names even if misspelled or abbreviated
- Identify ages (can be approximate)
- Identify gender (male/female/unknown)
- Extract relationships ("wife of", "son of", "mother of", "child", "family")
- Include the exact quote from the document as evidence
- ${isPreParsed ? 'This is a clean transcription (not OCR)' : 'This is OCR text (may have errors)'}

**Return ONLY valid JSON:**
{
  "owner_name": "name of slave owner from document",
  "document_year": "year if mentioned, null otherwise",
  "location": "place if mentioned, null otherwise",
  "enslaved_people": [
    {
      "name": "exact name as written",
      "normalized_name": "standardized spelling",
      "age": number or null,
      "age_approximate": true/false,
      "gender": "male"/"female"/"unknown",
      "relationships": ["relationship descriptions"],
      "evidence_quote": "exact sentence from document mentioning this person",
      "confidence": 0.0-1.0
    }
  ],
  "total_count": number,
  "parsing_notes": "any observations about document quality or ambiguities"
}

**Examples of what to extract:**
- "Negro Harry aged 35" → {name: "Harry", age: 35, gender: "male"}
- "Sarah and her child" → {name: "Sarah", gender: "female", relationships: ["mother of unnamed child"]}
- "Old Ned" → {name: "Ned", age: null, gender: "male"}

Be thorough. Extract EVERY person mentioned, even if information is incomplete.`;

    console.log('Using LLM to parse document...');

    try {
      const response = await llmAssistant.callLLM(systemPrompt, ocrText);

      // Extract JSON from response (handle markdown code blocks and extra text)
      let jsonText = response.trim();

      // Remove markdown code blocks
      if (jsonText.includes('```json')) {
        jsonText = jsonText.split('```json')[1].split('```')[0].trim();
      } else if (jsonText.includes('```')) {
        jsonText = jsonText.split('```')[1].split('```')[0].trim();
      }

      // Find JSON object boundaries
      const firstBrace = jsonText.indexOf('{');
      const lastBrace = jsonText.lastIndexOf('}');

      if (firstBrace >= 0 && lastBrace > firstBrace) {
        jsonText = jsonText.substring(firstBrace, lastBrace + 1);
      }

      const parsed = JSON.parse(jsonText);

      console.log(`✓ LLM parsing complete: ${parsed.enslaved_people?.length || 0} people found`);

      return {
        success: true,
        method: 'llm',
        owner_name: parsed.owner_name || owner,
        document_year: parsed.document_year || year,
        location: parsed.location || location,
        enslaved_people: parsed.enslaved_people || [],
        total_count: parsed.total_count || parsed.enslaved_people?.length || 0,
        parsing_notes: parsed.parsing_notes,
        confidence: this.calculateAverageConfidence(parsed.enslaved_people),
        raw_llm_response: response
      };

    } catch (error) {
      console.error('LLM parsing failed:', error);
      throw new Error(`LLM parsing failed: ${error.message}`);
    }
  }

  /**
   * Regex-based parsing (FALLBACK - less accurate but works without API)
   */
  async parseRegex(ocrText, metadata) {
    console.log('Using regex-based parsing (fallback)...');

    const { owner, year, location } = metadata;
    const enslavedPeople = [];

    // STRUCTURAL PATTERNS (detect document structure, not keywords)
    const foundNames = new Set();

    // Pattern 1: Detect numbered tabular rows (schedule/manifest format)
    // Matches: "1.    Name Surname    Male/Female/"    Age.    ..."
    // Flexible for: multi-word names, apostrophes, ditto marks, variable spacing
    const numberedRowPattern = /^(\d+)\.\s+([A-Z][\w'\.\s]+?)\s{2,}[\w"\s]*?\s+(\d+)\./gm;
    const numberedMatches = [...ocrText.matchAll(numberedRowPattern)];

    for (const match of numberedMatches) {
      const rowNum = match[1];
      let name = match[2].trim();
      const age = parseInt(match[3]);

      // Clean up name (remove trailing periods, quotes, etc.)
      name = name.replace(/['"\.]$/, '').trim();

      const key = `${name}-${age}`;
      if (!foundNames.has(key) && name.length >= 3) {
        foundNames.add(key);

        enslavedPeople.push({
          name: name,
          normalized_name: name,
          age: age,
          age_approximate: false,
          gender: null, // Will be determined by context
          relationships: [],
          evidence_quote: match[0],
          confidence: 0.8 // Higher confidence for structured data
        });
      }
    }

    // Common keyword-based patterns (fallback for unstructured text)
    const patterns = [
      // "Harry, aged 35" or "Harry aged 35"
      /\b([A-Z][a-z]+),?\s+aged?\s+(\d+)/gi,

      // "- Harry, aged 35" (bullet list format)
      /\-\s+([A-Z][a-z]+),?\s+aged?\s+(\d+)/gi,

      // "Negro/Negroe Harry" or "slave Harry"
      /(?:negro(?:e|es)?|slave|mulatto|coloured?)\s+([A-Z][a-z]+)/gi,

      // "Old Ned" or "Young Tom"
      /(?:old|young)\s+([A-Z][a-z]+)/gi,

      // "Betsy and her child"
      /\b([A-Z][a-z]+)\s+and\s+(?:his|her)\s+child/gi
    ];

    for (const pattern of patterns) {
      const matches = [...ocrText.matchAll(pattern)];

      for (const match of matches) {
        const name = match[1];
        const age = match[2] ? parseInt(match[2]) : null;

        // Avoid duplicates
        const key = `${name}-${age}`;
        if (foundNames.has(key)) continue;
        foundNames.add(key);

        // Determine gender from common names (very basic)
        const gender = this.guessGender(name);

        enslavedPeople.push({
          name: name,
          normalized_name: name,
          age: age,
          age_approximate: false,
          gender: gender,
          relationships: [],
          evidence_quote: match[0],
          confidence: 0.6 // Lower confidence for regex
        });
      }
    }

    console.log(`✓ Regex parsing complete: ${enslavedPeople.length} people found`);

    return {
      success: true,
      method: 'regex',
      owner_name: owner,
      document_year: year,
      location: location,
      enslaved_people: enslavedPeople,
      total_count: enslavedPeople.length,
      parsing_notes: 'Parsed using fallback regex patterns - may miss some individuals',
      confidence: 0.6
    };
  }

  /**
   * Calculate average confidence from extracted people
   */
  calculateAverageConfidence(people) {
    if (!people || people.length === 0) return 0;

    const totalConfidence = people.reduce((sum, person) => {
      return sum + (person.confidence || 0.5);
    }, 0);

    return totalConfidence / people.length;
  }

  /**
   * Basic gender guessing from common historical names
   */
  guessGender(name) {
    const malNames = ['Harry', 'Tom', 'James', 'John', 'William', 'George', 'Charles', 'Henry', 'Ned', 'Sam', 'Joe', 'Dick'];
    const femaleNames = ['Sarah', 'Mary', 'Betty', 'Nancy', 'Hannah', 'Sally', 'Betsy', 'Lucy', 'Rachel', 'Judith'];

    if (maleNames.includes(name)) return 'male';
    if (femaleNames.includes(name)) return 'female';
    return 'unknown';
  }

  /**
   * Parse multiple documents in batch
   */
  async parseBatch(documents) {
    const results = [];

    for (let i = 0; i < documents.length; i++) {
      console.log(`\nParsing document ${i + 1}/${documents.length}`);

      try {
        const result = await this.parseDocument(documents[i].text, documents[i].metadata);
        results.push({ ...documents[i], ...result, success: true });
      } catch (error) {
        console.error(`Failed to parse document ${i + 1}:`, error.message);
        results.push({ ...documents[i], success: false, error: error.message });
      }
    }

    return results;
  }
}

// Common male names for gender inference
const maleNames = ['Harry', 'Tom', 'James', 'John', 'William', 'George', 'Charles', 'Henry', 'Ned', 'Sam', 'Joe', 'Dick'];

module.exports = ColonialAmericanDocumentParser;
