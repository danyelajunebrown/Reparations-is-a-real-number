/**
 * UNIQUE ID & DEDUPLICATION SYSTEM
 * 
 * Problem: Same person appears in multiple documents with spelling variations
 * Solution: Internal UUIDs + fuzzy matching
 */

// ============================================
// DATABASE SCHEMA ADDITIONS
// ============================================

/*
ADD TO individuals table:

ALTER TABLE individuals 
ADD COLUMN internal_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
ADD COLUMN familysearch_id VARCHAR(50),
ADD COLUMN name_variants TEXT[], -- Array of known spelling variations
ADD COLUMN confidence_score INTEGER DEFAULT 100, -- 0-100
ADD COLUMN merged_from_ids UUID[], -- Track if this is a merged entity
ADD COLUMN created_at TIMESTAMP DEFAULT NOW(),
ADD COLUMN updated_at TIMESTAMP DEFAULT NOW();

CREATE INDEX idx_individuals_internal_id ON individuals(internal_id);
CREATE INDEX idx_individuals_familysearch_id ON individuals(familysearch_id);
CREATE INDEX idx_individuals_name_variants ON individuals USING GIN(name_variants);


ADD TO enslaved_people table:

ALTER TABLE enslaved_people
ADD COLUMN internal_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
ADD COLUMN name_variants TEXT[], -- Known spelling variations
ADD COLUMN confidence_score INTEGER DEFAULT 100,
ADD COLUMN merged_from_ids UUID[],
ADD COLUMN created_at TIMESTAMP DEFAULT NOW(),
ADD COLUMN updated_at TIMESTAMP DEFAULT NOW();

CREATE INDEX idx_enslaved_internal_id ON enslaved_people(internal_id);
CREATE INDEX idx_enslaved_name_variants ON enslaved_people USING GIN(name_variants);
*/

// ============================================
// FUZZY MATCHING FOR DEDUPLICATION
// ============================================

class EntityDeduplicator {
    constructor(database) {
        this.database = database;
    }
    
    /**
     * Levenshtein distance for fuzzy name matching
     */
    levenshteinDistance(str1, str2) {
        const len1 = str1.length;
        const len2 = str2.length;
        const matrix = [];
        
        for (let i = 0; i <= len1; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= len2; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= len1; i++) {
            for (let j = 1; j <= len2; j++) {
                if (str1.charAt(i - 1) === str2.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        
        return matrix[len1][len2];
    }
    
    /**
     * Normalize name for comparison
     */
    normalizeName(name) {
        return name
            .toLowerCase()
            .replace(/[^a-z\s]/g, '') // Remove punctuation
            .replace(/\s+/g, ' ')      // Normalize spaces
            .trim();
    }
    
    /**
     * Calculate similarity score (0-100)
     */
    calculateSimilarity(name1, name2) {
        const norm1 = this.normalizeName(name1);
        const norm2 = this.normalizeName(name2);
        
        // Exact match
        if (norm1 === norm2) return 100;
        
        // Check common abbreviations
        const abbreviations = {
            'jas': 'james',
            'wm': 'william',
            'thos': 'thomas',
            'jno': 'john',
            'chas': 'charles',
            'geo': 'george',
            'benj': 'benjamin',
            'saml': 'samuel'
        };
        
        let check1 = norm1;
        let check2 = norm2;
        
        Object.keys(abbreviations).forEach(abbr => {
            check1 = check1.replace(abbr, abbreviations[abbr]);
            check2 = check2.replace(abbr, abbreviations[abbr]);
        });
        
        if (check1 === check2) return 95;
        
        // Levenshtein distance
        const distance = this.levenshteinDistance(check1, check2);
        const maxLen = Math.max(check1.length, check2.length);
        const similarity = Math.round((1 - distance / maxLen) * 100);
        
        return similarity;
    }
    
    /**
     * Find potential duplicates for a slave owner
     */
    async findPotentialDuplicates(ownerName, birthYear = null, deathYear = null) {
        // Get all individuals from database
        const query = `
            SELECT internal_id, full_name, name_variants, birth_year, death_year
            FROM individuals
            WHERE full_name ILIKE $1
               OR $2 = ANY(name_variants)
        `;
        
        const likePattern = '%' + ownerName.split(' ').join('%') + '%';
        const result = await this.database.query(query, [likePattern, ownerName]);
        
        const matches = [];
        
        for (const row of result.rows) {
            const similarity = this.calculateSimilarity(ownerName, row.full_name);
            
            // Add year matching bonus
            let yearBonus = 0;
            if (birthYear && row.birth_year && Math.abs(birthYear - row.birth_year) <= 2) {
                yearBonus += 20;
            }
            if (deathYear && row.death_year && Math.abs(deathYear - row.death_year) <= 2) {
                yearBonus += 20;
            }
            
            const finalScore = Math.min(100, similarity + yearBonus);
            
            if (finalScore >= 70) { // 70% threshold for potential match
                matches.push({
                    internal_id: row.internal_id,
                    name: row.full_name,
                    similarity: finalScore,
                    years: {
                        birth: row.birth_year,
                        death: row.death_year
                    }
                });
            }
        }
        
        return matches.sort((a, b) => b.similarity - a.similarity);
    }
    
    /**
     * Create new individual with internal ID
     */
    async createIndividual(data) {
        const query = `
            INSERT INTO individuals (
                internal_id,
                full_name,
                name_variants,
                birth_year,
                death_year,
                familysearch_id,
                spouse_names,
                children_names,
                parent_names,
                location
            ) VALUES (
                gen_random_uuid(),
                $1, $2, $3, $4, $5, $6, $7, $8, $9
            )
            RETURNING internal_id, full_name
        `;
        
        const result = await this.database.query(query, [
            data.fullName,
            data.nameVariants || [],
            data.birthYear,
            data.deathYear,
            data.familysearchId,
            data.spouses,
            data.children,
            data.parents,
            data.location
        ]);
        
        return result.rows[0];
    }
    
    /**
     * Update existing individual
     */
    async updateIndividual(internalId, updates) {
        const fields = [];
        const values = [];
        let paramIndex = 1;
        
        Object.keys(updates).forEach(key => {
            if (updates[key] !== undefined) {
                fields.push(`${key} = $${paramIndex}`);
                values.push(updates[key]);
                paramIndex++;
            }
        });
        
        fields.push(`updated_at = NOW()`);
        
        const query = `
            UPDATE individuals
            SET ${fields.join(', ')}
            WHERE internal_id = $${paramIndex}
            RETURNING *
        `;
        
        values.push(internalId);
        
        const result = await this.database.query(query, values);
        return result.rows[0];
    }
    
    /**
     * Merge two individuals (mark as duplicate)
     */
    async mergeIndividuals(keepId, mergeId) {
        // Move all references from mergeId to keepId
        await this.database.query(`
            UPDATE documents
            SET owner_internal_id = $1
            WHERE owner_internal_id = $2
        `, [keepId, mergeId]);
        
        // Update the kept record to track the merge
        await this.database.query(`
            UPDATE individuals
            SET merged_from_ids = array_append(merged_from_ids, $1)
            WHERE internal_id = $2
        `, [mergeId, keepId]);
        
        // Mark merged record as inactive
        await this.database.query(`
            UPDATE individuals
            SET active = false, updated_at = NOW()
            WHERE internal_id = $1
        `, [mergeId]);
        
        return { success: true, keptId: keepId, mergedId: mergeId };
    }
}

module.exports = EntityDeduplicator;
