/**
 * Cross-Verification Agent
 * 
 * Compares evidence from multiple sources to:
 * 1. Detect conflicts (birth dates don't match, etc.)
 * 2. Calculate confidence scores based on source agreement
 * 3. Update evidence_strength in unified_persons
 * 4. Log verification results
 * 
 * Usage:
 *   node scripts/agents/cross-verifier-agent.js
 */

const BaseAgent = require('./BaseAgent');

class CrossVerifierAgent extends BaseAgent {
  constructor() {
    super({
      agentType: 'cross_verifier',
      rateLimit: 1000, // 1 second between verifications (database only, no external API)
      batchSize: 20, // Process 20 persons at a time
      maxRetries: 3
    });
  }

  async initialize() {
    console.log('[cross_verifier] Initializing...');
    
    // Queue persons with multiple sources that need verification
    await this.queuePersonsNeedingVerification();
    
    console.log('[cross_verifier] Initialized');
  }

  /**
   * Queue persons with 2+ sources that haven't been verified recently
   */
  async queuePersonsNeedingVerification() {
    const persons = await this.sql`
      SELECT 
        up.id,
        up.canonical_name,
        COUNT(DISTINCT pes.id) as source_count
      FROM unified_persons up
      LEFT JOIN person_evidence_sources pes ON pes.unified_person_id = up.id
      WHERE (
        up.last_verified_at IS NULL 
        OR up.last_verified_at < NOW() - INTERVAL '30 days'
      )
      AND NOT EXISTS (
        SELECT 1 FROM agent_processing_queue apq
        WHERE apq.unified_person_id = up.id
        AND apq.agent_type = 'cross_verifier'
        AND apq.status IN ('pending', 'processing')
      )
      GROUP BY up.id, up.canonical_name
      HAVING COUNT(DISTINCT pes.id) >= 2
      ORDER BY COUNT(DISTINCT pes.id) DESC
      LIMIT 100
    `;
    
    for (const person of persons) {
      await this.queueItem(person.id, {
        name: person.canonical_name,
        sourceCount: person.source_count
      }, 5); // Medium priority
    }
    
    console.log(`[cross_verifier] Queued ${persons.length} persons for verification`);
  }

  /**
   * Verify evidence for a single person
   */
  async processItem(item) {
    const personId = item.unified_person_id;
    const details = item.task_details;
    
    console.log(`  Verifying: ${details.name} (${details.sourceCount} sources)`);
    
    try {
      // Get all evidence sources for this person
      const sources = await this.sql`
        SELECT * FROM person_evidence_sources
        WHERE unified_person_id = ${personId}
        ORDER BY source_tier ASC, confidence_score DESC
      `;
      
      if (sources.length < 2) {
        return { success: true, skipped: true, reason: 'insufficient_sources' };
      }
      
      // Perform verification checks
      const verification = {
        birthDateCheck: await this.verifyBirthDates(sources),
        deathDateCheck: await this.verifyDeathDates(sources),
        nameVariantCheck: await this.verifyNameVariants(sources),
        locationCheck: await this.verifyLocations(sources)
      };
      
      // Calculate new evidence strength
      const oldStrength = await this.getEvidenceStrength(personId);
      const newStrength = await this.calculateEvidenceStrength(personId, sources, verification);
      
      // Update person record
      await this.updatePersonEvidence(personId, newStrength, verification);
      
      // Log verification results
      await this.logVerification(personId, sources, verification, oldStrength, newStrength);
      
      const delta = newStrength - (oldStrength || 0);
      console.log(`  ✓ Verified: ${oldStrength || 0} → ${newStrength} (${delta >= 0 ? '+' : ''}${delta})`);
      
      return { 
        success: true, 
        oldStrength, 
        newStrength, 
        delta,
        hasConflicts: verification.birthDateCheck.conflict || verification.deathDateCheck.conflict
      };
      
    } catch (err) {
      console.error(`  ✗ Error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Verify birth dates across sources
   */
  async verifyBirthDates(sources) {
    const birthDates = sources
      .filter(s => s.provides_birth_date && s.extracted_data?.birthYear)
      .map(s => ({
        year: s.extracted_data.birthYear,
        tier: s.source_tier,
        confidence: s.confidence_score
      }));
    
    if (birthDates.length === 0) {
      return { checked: false, agreement: null, conflict: false };
    }
    
    if (birthDates.length === 1) {
      return { checked: true, agreement: true, conflict: false, value: birthDates[0].year };
    }
    
    // Check if all dates agree (within 2 year tolerance)
    const firstYear = birthDates[0].year;
    const allAgree = birthDates.every(d => Math.abs(d.year - firstYear) <= 2);
    
    if (allAgree) {
      return { 
        checked: true, 
        agreement: true, 
        conflict: false, 
        value: Math.round(birthDates.reduce((sum, d) => sum + d.year, 0) / birthDates.length)
      };
    } else {
      return {
        checked: true,
        agreement: false,
        conflict: true,
        values: birthDates.map(d => d.year),
        note: 'Birth year conflict detected'
      };
    }
  }

  /**
   * Verify death dates across sources
   */
  async verifyDeathDates(sources) {
    const deathDates = sources
      .filter(s => s.provides_death_date && s.extracted_data?.deathYear)
      .map(s => ({
        year: s.extracted_data.deathYear,
        tier: s.source_tier,
        confidence: s.confidence_score
      }));
    
    if (deathDates.length === 0) {
      return { checked: false, agreement: null, conflict: false };
    }
    
    if (deathDates.length === 1) {
      return { checked: true, agreement: true, conflict: false, value: deathDates[0].year };
    }
    
    const firstYear = deathDates[0].year;
    const allAgree = deathDates.every(d => Math.abs(d.year - firstYear) <= 2);
    
    if (allAgree) {
      return {
        checked: true,
        agreement: true,
        conflict: false,
        value: Math.round(deathDates.reduce((sum, d) => sum + d.year, 0) / deathDates.length)
      };
    } else {
      return {
        checked: true,
        agreement: false,
        conflict: true,
        values: deathDates.map(d => d.year),
        note: 'Death year conflict detected'
      };
    }
  }

  /**
   * Verify name variants (soundex matching)
   */
  async verifyNameVariants(sources) {
    // For now, just log that we checked
    // Full name matching would use Soundex/Metaphone from NameResolver
    return { checked: true, agreement: true, conflict: false };
  }

  /**
   * Verify locations across sources
   */
  async verifyLocations(sources) {
    const locations = sources
      .filter(s => s.provides_location && s.extracted_data?.location)
      .map(s => s.extracted_data.location);
    
    if (locations.length === 0) {
      return { checked: false, agreement: null, conflict: false };
    }
    
    // Simple check: do locations contain same state?
    const states = new Set();
    for (const loc of locations) {
      const stateMatch = loc.match(/\b(Alabama|Arkansas|Delaware|Florida|Georgia|Kentucky|Louisiana|Maryland|Mississippi|Missouri|North Carolina|South Carolina|Tennessee|Texas|Virginia)\b/i);
      if (stateMatch) {
        states.add(stateMatch[1].toLowerCase());
      }
    }
    
    if (states.size === 0) {
      return { checked: true, agreement: null, conflict: false };
    }
    
    if (states.size === 1) {
      return { checked: true, agreement: true, conflict: false, state: Array.from(states)[0] };
    } else {
      return { 
        checked: true, 
        agreement: false, 
        conflict: true, 
        states: Array.from(states),
        note: 'Location conflict detected'
      };
    }
  }

  /**
   * Get current evidence strength
   */
  async getEvidenceStrength(personId) {
    const result = await this.sql`
      SELECT evidence_strength FROM unified_persons WHERE id = ${personId}
    `;
    return result[0]?.evidence_strength || 0;
  }

  /**
   * Calculate evidence strength based on sources and verification
   */
  async calculateEvidenceStrength(personId, sources, verification) {
    let score = 0;
    
    // Count sources by tier
    const primaryCount = sources.filter(s => s.source_tier === 1).length;
    const secondaryCount = sources.filter(s => s.source_tier === 2).length;
    const tertiaryCount = sources.filter(s => s.source_tier === 3).length;
    
    // Base score from source count
    score += primaryCount * 30;
    score += secondaryCount * 15;
    score += tertiaryCount * 5;
    
    // Agreement bonus (multiple sources agree on facts)
    let agreements = 0;
    if (verification.birthDateCheck.agreement) agreements++;
    if (verification.deathDateCheck.agreement) agreements++;
    if (verification.locationCheck.agreement) agreements++;
    
    if (agreements >= 2 && (primaryCount + secondaryCount) >= 2) {
      score += 20; // Strong agreement bonus
    }
    
    // Conflict penalty
    let conflicts = 0;
    if (verification.birthDateCheck.conflict) conflicts++;
    if (verification.deathDateCheck.conflict) conflicts++;
    if (verification.locationCheck.conflict) conflicts++;
    
    score -= conflicts * 10;
    
    // Normalize to 0-100
    return Math.min(100, Math.max(0, score));
  }

  /**
   * Update person record with verification results
   */
  async updatePersonEvidence(personId, evidenceStrength, verification) {
    // Count sources by tier
    const sources = await this.sql`
      SELECT 
        COUNT(*) FILTER (WHERE source_tier = 1) as primary_count,
        COUNT(*) FILTER (WHERE source_tier = 2) as secondary_count,
        COUNT(*) FILTER (WHERE source_tier = 3) as tertiary_count
      FROM person_evidence_sources
      WHERE unified_person_id = ${personId}
    `;
    
    const counts = sources[0];
    
    // Update unified_persons
    await this.sql`
      UPDATE unified_persons
      SET 
        evidence_strength = ${evidenceStrength},
        num_primary_sources = ${counts.primary_count},
        num_secondary_sources = ${counts.secondary_count},
        num_tertiary_sources = ${counts.tertiary_count},
        last_verified_at = NOW(),
        updated_at = NOW(),
        birth_date_best_estimate = ${verification.birthDateCheck.value ? `${verification.birthDateCheck.value}-01-01` : null},
        death_date_best_estimate = ${verification.deathDateCheck.value ? `${verification.deathDateCheck.value}-01-01` : null}
      WHERE id = ${personId}
    `;
  }

  /**
   * Log verification to evidence_verification_log
   */
  async logVerification(personId, sources, verification, oldStrength, newStrength) {
    const hasConflicts = verification.birthDateCheck.conflict || 
                        verification.deathDateCheck.conflict || 
                        verification.locationCheck.conflict;
    
    await this.sql`
      INSERT INTO evidence_verification_log (
        unified_person_id,
        verification_type,
        sources_compared,
        agreement,
        confidence_before,
        confidence_after,
        confidence_delta,
        details,
        notes,
        verified_by
      ) VALUES (
        ${personId},
        ${hasConflicts ? 'conflict_detected' : 'cross_source_verification'},
        ${sources.map(s => s.id)},
        ${!hasConflicts},
        ${(oldStrength || 0) / 100},
        ${newStrength / 100},
        ${(newStrength - (oldStrength || 0)) / 100},
        ${JSON.stringify(verification)},
        ${hasConflicts ? 'Conflicts require human review' : 'All sources agree'},
        'cross_verifier_agent'
      )
    `;
  }
}

// Run if called directly
if (require.main === module) {
  const agent = new CrossVerifierAgent();
  agent.start().catch(console.error);
}

module.exports = CrossVerifierAgent;
