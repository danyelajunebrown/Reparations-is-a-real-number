/**
 * OCR Comparison and Training Module
 *
 * Compares system OCR results with precompleted OCR data,
 * logs discrepancies, and uses them to improve the system.
 *
 * The precompleted OCR is always considered correct and is used
 * as ground truth for training.
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class OCRComparisonTrainer {
  constructor(database = null) {
    this.db = database;
    this.trainingDataPath = './training_data';
    this.discrepanciesPath = path.join(this.trainingDataPath, 'ocr_discrepancies');

    this.initializeStorage();
  }

  async initializeStorage() {
    try {
      await fs.mkdir(this.trainingDataPath, { recursive: true });
      await fs.mkdir(this.discrepanciesPath, { recursive: true });
      console.log('✓ OCR training storage initialized');
    } catch (error) {
      console.error('OCR training storage initialization error:', error);
    }
  }

  /**
   * Compare system OCR with precompleted OCR
   * @param {string} systemOCR - OCR text from our system
   * @param {string} precompletedOCR - Correct OCR text (ground truth)
   * @param {object} metadata - Document metadata
   * @returns {object} Comparison result
   */
  async compareOCR(systemOCR, precompletedOCR, metadata = {}) {
    const comparison = {
      timestamp: new Date().toISOString(),
      documentType: metadata.documentType || 'unknown',
      metadata: metadata,
      systemOCR: {
        text: systemOCR,
        length: systemOCR.length,
        wordCount: this.countWords(systemOCR)
      },
      precompletedOCR: {
        text: precompletedOCR,
        length: precompletedOCR.length,
        wordCount: this.countWords(precompletedOCR)
      },
      similarity: this.calculateSimilarity(systemOCR, precompletedOCR),
      discrepancies: this.findDiscrepancies(systemOCR, precompletedOCR),
      recommendation: null
    };

    // Determine which OCR to use
    if (comparison.similarity >= 0.95) {
      comparison.recommendation = 'use_system_ocr';
      comparison.quality = 'excellent';
    } else if (comparison.similarity >= 0.80) {
      comparison.recommendation = 'use_precompleted_ocr';
      comparison.quality = 'good_with_improvements_needed';
    } else {
      comparison.recommendation = 'use_precompleted_ocr';
      comparison.quality = 'poor_needs_training';
    }

    // Log the comparison
    await this.logComparison(comparison);

    // If there are significant discrepancies, save for training
    if (comparison.similarity < 0.95) {
      await this.saveForTraining(comparison);
    }

    return comparison;
  }

  /**
   * Calculate similarity between two text strings
   * Uses Levenshtein distance normalized to 0-1 scale
   */
  calculateSimilarity(text1, text2) {
    // Normalize texts for comparison
    const norm1 = this.normalizeText(text1);
    const norm2 = this.normalizeText(text2);

    // Calculate Levenshtein distance
    const distance = this.levenshteinDistance(norm1, norm2);
    const maxLen = Math.max(norm1.length, norm2.length);

    if (maxLen === 0) return 1.0;

    // Convert to similarity score (0-1)
    const similarity = 1 - (distance / maxLen);
    return Math.max(0, Math.min(1, similarity));
  }

  /**
   * Levenshtein distance algorithm
   */
  levenshteinDistance(str1, str2) {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));

    for (let i = 0; i <= len1; i++) matrix[i][0] = i;
    for (let j = 0; j <= len2; j++) matrix[0][j] = j;

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,      // deletion
          matrix[i][j - 1] + 1,      // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }

    return matrix[len1][len2];
  }

  /**
   * Find specific discrepancies between system and precompleted OCR
   */
  findDiscrepancies(systemOCR, precompletedOCR) {
    const discrepancies = {
      missingWords: [],
      extraWords: [],
      differentWords: [],
      commonErrors: []
    };

    const systemWords = this.extractWords(systemOCR);
    const precompletedWords = this.extractWords(precompletedOCR);

    // Find missing words (in precompleted but not in system)
    precompletedWords.forEach(word => {
      if (!systemWords.includes(word)) {
        discrepancies.missingWords.push(word);
      }
    });

    // Find extra words (in system but not in precompleted)
    systemWords.forEach(word => {
      if (!precompletedWords.includes(word)) {
        discrepancies.extraWords.push(word);
      }
    });

    // Detect common OCR errors
    discrepancies.commonErrors = this.detectCommonOCRErrors(systemOCR, precompletedOCR);

    return discrepancies;
  }

  /**
   * Detect common OCR errors (like 'rn' misread as 'm', '1' as 'l', etc.)
   */
  detectCommonOCRErrors(systemOCR, precompletedOCR) {
    const errors = [];
    const commonMisreads = [
      { pattern: /rn/g, correct: 'm', description: 'rn misread as m' },
      { pattern: /\bl\b/g, correct: '1', description: 'l misread as 1' },
      { pattern: /\bO\b/g, correct: '0', description: 'O misread as 0' },
      { pattern: /vv/g, correct: 'w', description: 'vv misread as w' }
    ];

    // This is a simplified detection - in production, you'd want more sophisticated analysis
    commonMisreads.forEach(({ pattern, correct, description }) => {
      const systemMatches = (systemOCR.match(pattern) || []).length;
      const precompletedMatches = (precompletedOCR.match(pattern) || []).length;

      if (systemMatches !== precompletedMatches) {
        errors.push({
          type: description,
          systemCount: systemMatches,
          precompletedCount: precompletedMatches,
          difference: Math.abs(systemMatches - precompletedMatches)
        });
      }
    });

    return errors;
  }

  /**
   * Log comparison to database
   */
  async logComparison(comparison) {
    if (!this.db) return;

    try {
      await this.db.query(`
        INSERT INTO ocr_comparisons (
          document_type,
          similarity_score,
          quality_assessment,
          recommendation,
          system_word_count,
          precompleted_word_count,
          discrepancy_count,
          comparison_data,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      `, [
        comparison.documentType,
        comparison.similarity,
        comparison.quality,
        comparison.recommendation,
        comparison.systemOCR.wordCount,
        comparison.precompletedOCR.wordCount,
        comparison.discrepancies.missingWords.length + comparison.discrepancies.extraWords.length,
        JSON.stringify(comparison)
      ]);

      console.log(`✓ OCR comparison logged (similarity: ${(comparison.similarity * 100).toFixed(1)}%)`);
    } catch (error) {
      console.error('Error logging OCR comparison:', error.message);
      // Don't throw - logging failure shouldn't stop the process
    }
  }

  /**
   * Save discrepancy data for training
   */
  async saveForTraining(comparison) {
    try {
      const trainingId = crypto.randomBytes(8).toString('hex');
      const filename = `training_${trainingId}_${comparison.documentType}_${Date.now()}.json`;
      const filepath = path.join(this.discrepanciesPath, filename);

      const trainingData = {
        id: trainingId,
        timestamp: comparison.timestamp,
        documentType: comparison.documentType,
        metadata: comparison.metadata,
        input: comparison.systemOCR.text,
        groundTruth: comparison.precompletedOCR.text,
        similarity: comparison.similarity,
        discrepancies: comparison.discrepancies,
        quality: comparison.quality
      };

      await fs.writeFile(filepath, JSON.stringify(trainingData, null, 2), 'utf8');
      console.log(`✓ Training data saved: ${filename} (similarity: ${(comparison.similarity * 100).toFixed(1)}%)`);

      return trainingId;
    } catch (error) {
      console.error('Error saving training data:', error);
      return null;
    }
  }

  /**
   * Merge accompanying text with OCR for enhanced context
   */
  mergeWithAccompanyingText(ocrText, accompanyingText, metadata = {}) {
    if (!accompanyingText || accompanyingText.trim() === '') {
      return { merged: ocrText, enhanced: false };
    }

    // Extract unique information from accompanying text
    const ocrWords = new Set(this.extractWords(ocrText));
    const accompanyingWords = this.extractWords(accompanyingText);
    const additionalInfo = accompanyingWords.filter(word => !ocrWords.has(word));

    const merged = {
      primaryText: ocrText,
      additionalContext: accompanyingText,
      enhancedWords: additionalInfo,
      source: metadata.textSource || 'website',
      enhanced: true
    };

    console.log(`✓ Merged OCR with accompanying text: ${additionalInfo.length} additional unique words`);

    return merged;
  }

  /**
   * Utility: Normalize text for comparison
   */
  normalizeText(text) {
    return text
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '')
      .trim();
  }

  /**
   * Utility: Extract words from text
   */
  extractWords(text) {
    return this.normalizeText(text)
      .split(/\s+/)
      .filter(word => word.length > 0);
  }

  /**
   * Utility: Count words
   */
  countWords(text) {
    return this.extractWords(text).length;
  }

  /**
   * Get training statistics
   */
  async getTrainingStats() {
    try {
      const files = await fs.readdir(this.discrepanciesPath);
      const trainingFiles = files.filter(f => f.startsWith('training_') && f.endsWith('.json'));

      let totalSimilarity = 0;
      let count = 0;

      for (const file of trainingFiles) {
        const filepath = path.join(this.discrepanciesPath, file);
        const content = await fs.readFile(filepath, 'utf8');
        const data = JSON.parse(content);
        totalSimilarity += data.similarity;
        count++;
      }

      return {
        totalTrainingExamples: count,
        averageSimilarity: count > 0 ? totalSimilarity / count : 0,
        storageLocation: this.discrepanciesPath
      };
    } catch (error) {
      console.error('Error getting training stats:', error);
      return {
        totalTrainingExamples: 0,
        averageSimilarity: 0,
        storageLocation: this.discrepanciesPath
      };
    }
  }
}

module.exports = OCRComparisonTrainer;
