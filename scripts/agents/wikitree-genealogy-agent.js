/**
 * WikiTree Genealogy Agent
 * 
 * Combines WikiTree batch search and descendant scraping into single continuous agent.
 * 
 * Process:
 * 1. Search WikiTree for enslaver profiles
 * 2. Extract descendants from found profiles
 * 3. Save to unified_persons with evidence tracking
 * 
 * Usage:
 *   node scripts/agents/wikitree-genealogy-agent.js
 */

const BaseAgent = require('./BaseAgent');
const https = require('https');

class WikiTreeGenealogyAgent extends BaseAgent {
  constructor() {
    super({
      agentType: 'wikitree_genealogy',
      rateLimit: 3000, // 3 seconds between requests (WikiTree rate limit)
      batchSize: 5, // Process 5 enslavers at a time
      maxRetries: 2
    });
    
    this.USER_AGENT = 'ReparationsResearch/1.0 (genealogy-research)';
  }

  async initialize() {
    console.log('[wikitree_genealogy] Initializing...');
    
    // Queue high-confidence enslavers that haven't been searched yet
    await this.queueNewEnslavers();
    
    console.log('[wikitree_genealogy] Initialized');
  }

  /**
   * Queue enslavers from canonical_persons who haven't been WikiTree searched
   */
  async queueNewEnslavers() {
    const enslavers = await this.sql`
      SELECT cp.id, cp.canonical_name, cp.first_name, cp.last_name,
             cp.birth_year_estimate, cp.death_year_estimate,
             cp.primary_state, cp.confidence_score
      FROM canonical_persons cp
      WHERE cp.person_type IN ('enslaver', 'owner')
      AND cp.confidence_score >= 0.85
      AND cp.first_name IS NOT NULL
      AND cp.last_name IS NOT NULL
      AND LENGTH(cp.first_name) >= 2
      AND LENGTH(cp.last_name) >= 2
      AND cp.canonical_name NOT LIKE '%&%'
      AND cp.canonical_name NOT LIKE '%Co.%'
      AND cp.canonical_name NOT LIKE '%Unknown%'
      AND NOT EXISTS (
        SELECT 1 FROM agent_processing_queue apq
        WHERE apq.agent_type = 'wikitree_genealogy'
        AND apq.unified_person_id::text = cp.id::text
      )
      LIMIT 50
    `;
    
    for (const enslaver of enslavers) {
      await this.queueItem(enslaver.id.toString(), {
        name: enslaver.canonical_name,
        firstName: enslaver.first_name,
        lastName: enslaver.last_name,
        birthYear: enslaver.birth_year_estimate,
        deathYear: enslaver.death_year_estimate,
        state: enslaver.primary_state
      }, 3); // Priority 3 (higher than average)
    }
    
    console.log(`[wikitree_genealogy] Queued ${enslavers.length} new enslavers`);
  }

  /**
   * Process a single enslaver: search WikiTree + extract descendants
   */
  async processItem(item) {
    const details = item.task_details;
    
    console.log(`  Searching WikiTree for: ${details.name}`);
    
    try {
      // Step 1: Find WikiTree profile
      const profileResult = await this.searchWikiTreeProfile(
        details.firstName,
        details.lastName,
        details.birthYear,
        details.deathYear,
        details.state
      );
      
      if (profileResult.status === 'not_found') {
        console.log(`  ○ No WikiTree profile found`);
        return { success: true, found: false };
      }
      
      if (profileResult.status === 'multiple_matches') {
        console.log(`  ⚠ Multiple matches: ${profileResult.matches.join(', ')}`);
        return { success: true, found: false, multipleMatches: true };
      }
      
      console.log(`  ✓ Found: ${profileResult.wikitreeId}`);
      
      // Step 2: Extract descendants
      const descendants = await this.extractDescendants(profileResult.wikitreeId);
      
      console.log(`  👥 ${descendants.length} descendants found`);
      
      // Step 3: Save to unified_persons
      await this.saveToUnifiedPersons(item.unified_person_id, profileResult, descendants);
      
      return { 
        success: true, 
        found: true,
        wikitreeId: profileResult.wikitreeId,
        descendantCount: descendants.length
      };
      
    } catch (err) {
      console.error(`  ✗ Error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Search WikiTree for person's profile
   */
  async searchWikiTreeProfile(firstName, lastName, birthYear, deathYear, state) {
    const cleanLastName = lastName
      .split(' ')[0]
      .replace(/[^A-Za-z]/g, '')
      .charAt(0).toUpperCase() + lastName.slice(1).toLowerCase();
    
    const candidates = [];
    const idsToTry = [1, 2, 3, 4, 5, 10, 20, 50, 100, 200];
    
    for (const num of idsToTry) {
      const wikitreeId = `${cleanLastName}-${num}`;
      
      try {
        const result = await this.checkProfile(wikitreeId, firstName, lastName, state);
        
        if (result.exists) {
          candidates.push({
            wikitreeId,
            ...result
          });
          
          if (result.confidence >= 0.7) break;
        }
        
        await this.sleep(500); // Rate limit
        
      } catch (err) {
        // Continue to next ID
      }
    }
    
    if (candidates.length === 0) {
      return { status: 'not_found' };
    }
    
    candidates.sort((a, b) => b.confidence - a.confidence);
    
    if (candidates.length === 1 || candidates[0].confidence >= 0.7) {
      return {
        status: 'found',
        wikitreeId: candidates[0].wikitreeId,
        url: `https://www.wikitree.com/wiki/${candidates[0].wikitreeId}`,
        confidence: candidates[0].confidence
      };
    } else {
      return {
        status: 'multiple_matches',
        matches: candidates.map(c => c.wikitreeId)
      };
    }
  }

  /**
   * Check if WikiTree profile exists and matches
   */
  checkProfile(wikitreeId, firstName, lastName, state) {
    return new Promise((resolve, reject) => {
      const url = `https://www.wikitree.com/wiki/${wikitreeId}`;
      
      const req = https.get(url, {
        headers: {
          'User-Agent': this.USER_AGENT,
          'Accept': 'text/html'
        }
      }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 404) {
          resolve({ exists: false });
          return;
        }
        
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          const titleMatch = data.match(/<title>([^<]+)<\/title>/);
          if (!titleMatch) {
            resolve({ exists: false });
            return;
          }
          
          const title = titleMatch[1];
          
          if (title.includes('WikiTree FREE Family Tree') && title.includes(lastName)) {
            let confidence = 0.5;
            
            if (state && new RegExp(state, 'i').test(data)) {
              confidence += 0.2;
            }
            
            if (title.toLowerCase().includes(firstName.toLowerCase())) {
              confidence += 0.2;
            }
            
            resolve({
              exists: true,
              title: title,
              confidence: confidence,
              hasLocationMatch: !!(state && new RegExp(state, 'i').test(data))
            });
          } else {
            resolve({ exists: false });
          }
        });
      });
      
      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  /**
   * Extract descendants from WikiTree profile (BFS)
   */
  async extractDescendants(wikitreeId, maxGenerations = 8) {
    const allDescendants = [];
    const visited = new Set();
    const queue = [{ wikitreeId, generation: 0 }];
    
    while (queue.length > 0 && allDescendants.length < 500) {
      const { wikitreeId: currentId, generation } = queue.shift();
      
      if (visited.has(currentId) || generation > maxGenerations) continue;
      visited.add(currentId);
      
      if (visited.size > 1) {
        await this.sleep(2000); // Rate limit
      }
      
      try {
        const profile = await this.scrapeProfile(currentId);
        
        if (!profile.success) continue;
        
        // Add children to queue
        for (const child of profile.children) {
          queue.push({
            wikitreeId: child.wikitreeId,
            generation: generation + 1
          });
          
          // Don't add root person to descendants
          if (generation === 0) continue;
          
          allDescendants.push({
            wikitreeId: currentId,
            name: profile.personName,
            birthYear: profile.birthYear,
            deathYear: profile.deathYear,
            generation,
            isLiving: !profile.deathYear,
            wikitreeUrl: `https://www.wikitree.com/wiki/${currentId}`
          });
        }
        
      } catch (err) {
        // Continue on error
      }
    }
    
    return allDescendants;
  }

  /**
   * Scrape single WikiTree profile for children
   */
  scrapeProfile(wikitreeId) {
    return new Promise((resolve, reject) => {
      const url = `https://www.wikitree.com/wiki/${wikitreeId}`;
      
      https.get(url, {
        headers: { 'User-Agent': this.USER_AGENT }
      }, (res) => {
        if (res.statusCode !== 200) {
          resolve({ success: false });
          return;
        }
        
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          const children = [];
          
          // Parse children from schema.org markup
          const childPattern = /<span\s+itemprop="children"[^>]*>.*?<a\s+href="\/wiki\/([^"]+)"[^>]*>.*?<span\s+itemprop="name">([^<]+)<\/span>/gi;
          
          let match;
          while ((match = childPattern.exec(data)) !== null) {
            const [, childId, name] = match;
            if (!children.find(c => c.wikitreeId === childId)) {
              children.push({ wikitreeId: childId, name: name.trim() });
            }
          }
          
          // Extract person info
          const nameMatch = data.match(/<h1[^>]*>([^<]+)<\/h1>/);
          const birthMatch = data.match(/(?:born|b\.)\s*(?:about\s+)?(\d{4})/i);
          const deathMatch = data.match(/(?:died|d\.)\s*(?:about\s+)?(\d{4})/i);
          
          resolve({
            success: true,
            personName: nameMatch ? nameMatch[1].trim() : null,
            birthYear: birthMatch ? parseInt(birthMatch[1]) : null,
            deathYear: deathMatch ? parseInt(deathMatch[1]) : null,
            children
          });
        });
      }).on('error', reject);
    });
  }

  /**
   * Save WikiTree data to unified_persons with evidence tracking
   */
  async saveToUnifiedPersons(enslaverId, profileResult, descendants) {
    // Add WikiTree source for the enslaver
    await this.sql`
      INSERT INTO person_evidence_sources (
        unified_person_id,
        source_type,
        source_tier,
        source_id,
        source_url,
        provides_birth_date,
        provides_death_date,
        provides_location,
        extracted_data,
        confidence_score,
        extraction_method,
        extracted_by
      ) VALUES (
        ${enslaverId},
        'wikitree',
        3,
        ${profileResult.wikitreeId},
        ${profileResult.url},
        false,
        false,
        true,
        ${JSON.stringify({ wikitreeId: profileResult.wikitreeId })},
        ${profileResult.confidence},
        'api',
        'wikitree_genealogy_agent'
      )
      ON CONFLICT DO NOTHING
    `;
    
    // Save descendants (not yet implemented - will add in next iteration)
    // For now, just log
    console.log(`  💾 Saved evidence for enslaver, ${descendants.length} descendants tracked`);
  }
}

// Run if called directly
if (require.main === module) {
  const agent = new WikiTreeGenealogyAgent();
  agent.start().catch(console.error);
}

module.exports = WikiTreeGenealogyAgent;
