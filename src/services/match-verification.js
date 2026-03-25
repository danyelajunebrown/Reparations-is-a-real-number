/**
 * MatchVerifier — Race-Aware Post-Match Verification
 *
 * Runs disqualification and corroboration checks against every candidate match
 * from find_person_match(). Works for both real-time climbing AND retroactive
 * re-evaluation of existing matches.
 *
 * Design: find_person_match() remains the candidate retriever.
 * This service is the verification layer that classifies candidates.
 */

const HIGH_FREQUENCY_SURNAMES = new Set([
    'smith', 'jones', 'brown', 'davis', 'williams', 'johnson', 'wilson',
    'thomas', 'miller', 'young', 'clark', 'baker', 'scott', 'white',
    'jackson', 'harris', 'robinson', 'taylor', 'moore', 'anderson',
    'martin', 'thompson', 'allen', 'king', 'wright', 'hill', 'green',
    'adams', 'walker', 'hall', 'lewis', 'lee', 'turner', 'parker',
    'carter', 'mitchell', 'roberts', 'campbell', 'stewart', 'morgan',
    'cooper', 'bell', 'ward', 'cook', 'bailey', 'richardson', 'cox',
    'howard', 'wood', 'mason', 'james', 'bennett', 'gray', 'ross',
    'watson', 'brooks', 'kelly', 'sanders', 'price', 'reed', 'long',
    'foster', 'butler', 'barnes', 'fisher', 'henderson', 'coleman',
    'washington', 'freeman', 'jordan', 'reynolds', 'hamilton', 'graham',
    'ryan', 'grady', 'murphy', 'sullivan', 'kennedy', 'welch', 'walsh',
    'collins', 'reade', 'read', 'reed', 'hogan', 'lowe', 'muir'
]);

class MatchVerifier {
    constructor(sql) {
        this.sql = sql;
    }

    /**
     * Verify a candidate match — run all disqualification + corroboration checks.
     *
     * @param {object} ancestor - { name, birth_year, death_year, locations, fs_id, race_indicators, occupation }
     * @param {object} candidateMatch - Match from checkEnslaverDatabase() or existing DB row
     * @param {number} generation - Generation distance from modern person
     * @returns {MatchVerdict}
     */
    async verify(ancestor, candidateMatch, generation) {
        const disqualifications = [];
        const corroborations = [];

        // Run all checks (order matters for priority)
        const temporal = this.checkTemporalPlausibility(ancestor, candidateMatch, generation);
        if (temporal) disqualifications.push(temporal);

        const commonName = await this.checkCommonNameAtDepth(ancestor, candidateMatch, generation);
        if (commonName) disqualifications.push(commonName);

        const enslaved = await this.checkIsEnslaved(ancestor);
        if (enslaved) disqualifications.push(enslaved);

        const freeBlack = await this.checkIsFreeBlack(ancestor);
        if (freeBlack) {
            if (freeBlack.is_slaveholder) {
                // Special case: free POC slaveholder
                corroborations.push({
                    type: 'corroborating',
                    source: 'free_persons',
                    detail: `Found in free_persons as slaveholder (race: ${freeBlack.race})`,
                    weight: 0.0,
                    free_poc_slaveholder: true
                });
            } else {
                disqualifications.push(freeBlack.evidence);
            }
        }

        const censusRace = await this.checkCensusRace(ancestor);
        if (censusRace) {
            if (censusRace.race === 'W') {
                corroborations.push(censusRace.evidence);
            } else {
                disqualifications.push(censusRace.evidence);
            }
        }

        const personType = await this.checkCanonicalPersonType(ancestor);
        if (personType) disqualifications.push(personType);

        // Corroboration checks
        const censusWhite = await this.checkCensusWhite(ancestor);
        if (censusWhite) corroborations.push(censusWhite);

        const priorVerification = await this.checkPriorVerification(candidateMatch);
        if (priorVerification) corroborations.push(priorVerification);

        // Race indicators from page scraping
        if (ancestor.race_indicators && ancestor.race_indicators.length > 0) {
            const raceEvidence = this.evaluateRaceIndicators(ancestor.race_indicators);
            if (raceEvidence.disqualifying) disqualifications.push(raceEvidence.evidence);
            if (raceEvidence.corroborating) corroborations.push(raceEvidence.evidence);
        }

        return this.assembleVerdict(disqualifications, corroborations, candidateMatch, ancestor, freeBlack);
    }

    // ═══════════════════════════════════════════════════════════════
    // DISQUALIFICATION CHECKS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Check temporal plausibility of the match.
     */
    checkTemporalPlausibility(ancestor, match, generation) {
        const birthYear = ancestor.birth_year || match.birth_year_estimate || match.slaveholder_birth_year;
        if (!birthYear) return null;

        // Born after 1845 in US → too young to be an active slaveholder
        // (would have been 20 at Emancipation in 1865)
        if (birthYear > 1845) {
            return {
                type: 'disqualifying',
                source: 'temporal_check',
                detail: `Born ${birthYear} — too young to be active slaveholder (Emancipation 1865)`,
                weight: -0.50,
                temporal: true
            };
        }

        // Born before 1580 AND not a SlaveVoyages match → before organized transatlantic trade
        if (birthYear < 1580 && match.type !== 'slavevoyages_enslaver') {
            return {
                type: 'disqualifying',
                source: 'temporal_check',
                detail: `Born ${birthYear} — predates organized transatlantic slave trade`,
                weight: -0.50,
                temporal: true
            };
        }

        // Match birth year differs from ancestor by >3 years → reduce confidence
        const matchBirthYear = match.birth_year_estimate || match.slaveholder_birth_year;
        if (matchBirthYear && Math.abs(birthYear - matchBirthYear) > 3) {
            return {
                type: 'disqualifying',
                source: 'temporal_check',
                detail: `Birth year mismatch: ancestor ${birthYear} vs match ${matchBirthYear} (diff ${Math.abs(birthYear - matchBirthYear)}yr)`,
                weight: -0.15
            };
        }

        // Generation > 12 AND low confidence → suspect
        if (generation > 12 && (match.confidence || match.match_confidence) < 0.70) {
            return {
                type: 'disqualifying',
                source: 'temporal_check',
                detail: `Deep generation (${generation}) with low confidence — temporal reliability decreases`,
                weight: -0.20,
                temporal: true
            };
        }

        return null;
    }

    /**
     * Check if ancestor appears in enslaved_individuals table.
     */
    async checkIsEnslaved(ancestor) {
        if (!ancestor.name) return null;

        const nameParts = ancestor.name.trim().split(/\s+/);
        const firstName = nameParts[0];
        const lastName = nameParts[nameParts.length - 1];

        try {
            const rows = await this.sql`
                SELECT id, full_name, owner_name, birth_year_est, state
                FROM enslaved_individuals
                WHERE (
                    LOWER(full_name) = LOWER(${ancestor.name})
                    OR (LOWER(full_name) LIKE ${`%${firstName.toLowerCase()}%`}
                        AND LOWER(full_name) LIKE ${`%${lastName.toLowerCase()}%`})
                )
                ${ancestor.birth_year ? this.sql`AND (birth_year_est IS NULL OR ABS(birth_year_est - ${ancestor.birth_year}) <= 10)` : this.sql``}
                LIMIT 5
            `;

            if (rows.length > 0) {
                return {
                    type: 'disqualifying',
                    source: 'enslaved_individuals',
                    detail: `Found in enslaved_individuals: "${rows[0].full_name}" (owner: ${rows[0].owner_name || 'unknown'})`,
                    weight: -0.40,
                    enslaved: true
                };
            }
        } catch (err) {
            // Table may not exist — non-fatal
        }

        return null;
    }

    /**
     * Check if ancestor appears in free_persons table.
     * Returns { evidence, is_slaveholder, race } or null.
     */
    async checkIsFreeBlack(ancestor) {
        if (!ancestor.name) return null;

        const location = (ancestor.locations && ancestor.locations[0]) || null;

        try {
            const rows = await this.sql`
                SELECT id, full_name, race_designation, is_slaveholder, state, birth_year
                FROM free_persons
                WHERE LOWER(full_name) = LOWER(${ancestor.name})
                ${ancestor.birth_year ? this.sql`AND (birth_year IS NULL OR ABS(birth_year - ${ancestor.birth_year}) <= 5)` : this.sql``}
                ${location ? this.sql`AND (state IS NULL OR LOWER(state) = LOWER(${location}))` : this.sql``}
                LIMIT 5
            `;

            if (rows.length > 0) {
                const row = rows[0];
                const race = (row.race_designation || '').toLowerCase();
                if (['black', 'mulatto', 'colored', 'negro'].includes(race)) {
                    if (row.is_slaveholder) {
                        return { is_slaveholder: true, race: row.race_designation };
                    }
                    return {
                        evidence: {
                            type: 'disqualifying',
                            source: 'free_persons',
                            detail: `Found in free_persons as ${row.race_designation} (${row.freedom_status || 'free'})`,
                            weight: -0.35,
                            free_black: true
                        }
                    };
                }
            }
        } catch (err) {
            // Table may not exist
        }

        return null;
    }

    /**
     * Check unconfirmed_persons for race/color information.
     * Returns { race, evidence } or null.
     */
    async checkCensusRace(ancestor) {
        if (!ancestor.name) return null;

        try {
            const rows = await this.sql`
                SELECT lead_id, full_name, relationships, birth_year
                FROM unconfirmed_persons
                WHERE LOWER(full_name) = LOWER(${ancestor.name})
                ${ancestor.birth_year ? this.sql`AND (birth_year IS NULL OR ABS(birth_year - ${ancestor.birth_year}) <= 5)` : this.sql``}
                AND relationships IS NOT NULL
                LIMIT 10
            `;

            for (const row of rows) {
                const rels = typeof row.relationships === 'string' ? JSON.parse(row.relationships) : row.relationships;
                const color = rels?.color || rels?.race || rels?.Color || rels?.Race;
                if (!color) continue;

                const colorLower = color.toString().toLowerCase().trim();
                if (['b', 'black', 'm', 'mulatto', 'mu', 'colored', 'negro'].includes(colorLower)) {
                    return {
                        race: 'B',
                        evidence: {
                            type: 'disqualifying',
                            source: 'census_race',
                            detail: `Listed as "${color}" in census/records (unconfirmed_persons #${row.lead_id})`,
                            weight: -0.30
                        }
                    };
                }
                if (['w', 'white'].includes(colorLower)) {
                    return {
                        race: 'W',
                        evidence: {
                            type: 'corroborating',
                            source: 'census_race',
                            detail: `Listed as "White" in census/records (unconfirmed_persons #${row.lead_id})`,
                            weight: 0.15
                        }
                    };
                }
            }
        } catch (err) {
            // Non-fatal
        }

        return null;
    }

    /**
     * Check canonical_persons.person_type for disqualifying types.
     */
    async checkCanonicalPersonType(ancestor) {
        if (!ancestor.name) return null;

        try {
            const rows = await this.sql`
                SELECT id, canonical_name, person_type
                FROM canonical_persons
                WHERE LOWER(canonical_name) = LOWER(${ancestor.name})
                ${ancestor.birth_year ? this.sql`AND (birth_year_estimate IS NULL OR ABS(birth_year_estimate - ${ancestor.birth_year}) <= 5)` : this.sql``}
                AND person_type IN ('free_black', 'free_person_of_color', 'enslaved', 'freedperson')
                LIMIT 1
            `;

            if (rows.length > 0) {
                return {
                    type: 'disqualifying',
                    source: 'canonical_persons',
                    detail: `canonical_persons type="${rows[0].person_type}" for "${rows[0].canonical_name}"`,
                    weight: -0.35
                };
            }
        } catch (err) {
            // Non-fatal
        }

        return null;
    }

    /**
     * Check if this is a common name at a deep generation.
     */
    async checkCommonNameAtDepth(ancestor, match, generation) {
        if (!ancestor.name) return null;

        const nameParts = ancestor.name.trim().split(/\s+/);
        const surname = nameParts[nameParts.length - 1].toLowerCase();
        const confidence = match.confidence || match.match_confidence || 0;
        const isNameOnly = !ancestor.fs_id;
        const hasNoBirthYear = !ancestor.birth_year || ancestor.birth_year < 0;
        const isWeakMatch = match.type === 'name_only_match' || match.requires_human_review;

        // Aggressive filter for name-only ancestors with no verifiable data
        // "William Ryan" + no birth year + no FS ID + Tier 3 match = not credible
        if (isNameOnly && HIGH_FREQUENCY_SURNAMES.has(surname) && isWeakMatch) {
            return {
                type: 'disqualifying',
                source: 'common_name_check',
                detail: `Common surname "${surname}" in name-only mode with no verifiable data (${match.type})`,
                weight: -0.30,
                common_name: true
            };
        }

        // Hardcoded high-frequency check
        if (HIGH_FREQUENCY_SURNAMES.has(surname) && confidence < 0.75 && generation > 8) {
            return {
                type: 'disqualifying',
                source: 'common_name_check',
                detail: `High-frequency surname "${surname}" at generation ${generation} with ${(confidence * 100).toFixed(0)}% confidence`,
                weight: -0.20,
                common_name: true
            };
        }

        // Database frequency check
        try {
            const countResult = await this.sql`
                SELECT COUNT(*) as cnt FROM canonical_persons
                WHERE LOWER(last_name) = LOWER(${nameParts[nameParts.length - 1]})
            `;
            const count = parseInt(countResult[0]?.cnt || 0);
            if (count > 50 && confidence < 0.75 && generation > 8) {
                return {
                    type: 'disqualifying',
                    source: 'common_name_check',
                    detail: `Surname "${surname}" appears ${count} times in DB at generation ${generation}`,
                    weight: -0.20,
                    common_name: true
                };
            }
        } catch (err) {
            // Non-fatal
        }

        return null;
    }

    // ═══════════════════════════════════════════════════════════════
    // CORROBORATION CHECKS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Check if ancestor is listed as White in census via unconfirmed_persons.
     * (Separate from checkCensusRace — this specifically looks for corroboration)
     */
    async checkCensusWhite(ancestor) {
        // Already handled by checkCensusRace returning race='W'
        return null;
    }

    /**
     * Check prior verification from other climb sessions.
     */
    async checkPriorVerification(candidateMatch) {
        const slaveholderFsId = candidateMatch.slaveholder_fs_id || candidateMatch.fs_id;
        const slaveholderName = candidateMatch.canonical_name || candidateMatch.slaveholder_name || candidateMatch.full_name;

        if (!slaveholderFsId && !slaveholderName) return null;

        try {
            const rows = await this.sql`
                SELECT verification_status, classification, verification_evidence
                FROM ancestor_climb_matches
                WHERE verification_status NOT IN ('unverified', 'legacy_unverified')
                AND (
                    ${slaveholderFsId ? this.sql`slaveholder_fs_id = ${slaveholderFsId}` : this.sql`FALSE`}
                    OR ${slaveholderName ? this.sql`LOWER(slaveholder_name) = LOWER(${slaveholderName})` : this.sql`FALSE`}
                )
                ORDER BY found_at DESC
                LIMIT 1
            `;

            if (rows.length > 0) {
                return {
                    type: 'corroborating',
                    source: 'prior_verification',
                    detail: `Previously verified as "${rows[0].classification}" (status: ${rows[0].verification_status})`,
                    weight: 0.10,
                    prior_classification: rows[0].classification
                };
            }
        } catch (err) {
            // Non-fatal (columns may not exist yet)
        }

        return null;
    }

    /**
     * Evaluate race indicators extracted from FamilySearch page.
     */
    evaluateRaceIndicators(indicators) {
        const text = indicators.join(' ').toLowerCase();

        const blackTerms = ['black', 'negro', 'colored', 'mulatto', 'free black', 'free negro', 'free colored'];
        const whiteTerms = ['white'];

        for (const term of blackTerms) {
            if (text.includes(term)) {
                return {
                    disqualifying: true,
                    evidence: {
                        type: 'disqualifying',
                        source: 'familysearch_page',
                        detail: `Race indicator on FamilySearch page: "${indicators.join(', ')}"`,
                        weight: -0.30
                    }
                };
            }
        }

        for (const term of whiteTerms) {
            if (text.includes(term)) {
                return {
                    corroborating: true,
                    evidence: {
                        type: 'corroborating',
                        source: 'familysearch_page',
                        detail: `Race indicator on FamilySearch page: "${indicators.join(', ')}"`,
                        weight: 0.15
                    }
                };
            }
        }

        return {};
    }

    // ═══════════════════════════════════════════════════════════════
    // VERDICT ASSEMBLY
    // ═══════════════════════════════════════════════════════════════

    /**
     * Assemble final verdict from all evidence.
     * Priority order matters — temporal > enslaved > free_poc_slaveholder > census > common_name > corroboration
     */
    assembleVerdict(disqualifications, corroborations, candidateMatch, ancestor, freeBlackResult) {
        const allEvidence = [...disqualifications, ...corroborations];
        const originalConfidence = candidateMatch.confidence || candidateMatch.match_confidence || 0.50;

        // Calculate adjusted confidence
        let adjustedConfidence = originalConfidence;
        for (const e of allEvidence) {
            adjustedConfidence += (e.weight || 0);
        }
        adjustedConfidence = Math.max(0.0, Math.min(1.0, adjustedConfidence));

        // Priority-based classification
        let classification = 'unverified';
        let requiresHumanReview = false;
        let reviewReason = null;

        // 1. Temporal impossibility
        const temporalDisq = disqualifications.find(d => d.temporal);
        if (temporalDisq) {
            classification = 'temporal_impossible';
            return this._verdict(classification, adjustedConfidence, allEvidence, false, null);
        }

        // 2. Found in enslaved_individuals
        const enslavedDisq = disqualifications.find(d => d.enslaved);
        if (enslavedDisq) {
            classification = 'enslaved_ancestor';
            return this._verdict(classification, adjustedConfidence, allEvidence, false, null);
        }

        // 3. Free POC slaveholder
        const freePocSlaveholder = corroborations.find(c => c.free_poc_slaveholder);
        if (freePocSlaveholder) {
            classification = 'free_poc_slaveholder';
            return this._verdict(classification, adjustedConfidence, allEvidence, true,
                'Free person of color who owned slaves — requires case-by-case review');
        }

        // 4. Census race = B/M, not in slaveholder records
        const censusBlack = disqualifications.find(d =>
            d.source === 'census_race' || d.source === 'free_persons' || d.source === 'familysearch_page'
        );
        const hasSlaveholderRecord = corroborations.some(c =>
            c.source === 'slave_schedule' || c.source === 'compensation_claim'
        );

        if (censusBlack && !hasSlaveholderRecord) {
            classification = 'enslaved_ancestor';
            return this._verdict(classification, adjustedConfidence, allEvidence, false, null);
        }

        // 5. Census race = B/M AND IS in slaveholder records → ambiguous
        if (censusBlack && hasSlaveholderRecord) {
            classification = 'ambiguous_needs_review';
            return this._verdict(classification, adjustedConfidence, allEvidence, true,
                'Conflicting evidence: listed as Black/Mulatto but also appears in slaveholder records');
        }

        // 6. Common name at depth
        const commonNameDisq = disqualifications.find(d => d.common_name);
        if (commonNameDisq) {
            classification = 'common_name_suspect';
            return this._verdict(classification, adjustedConfidence, allEvidence, false, null);
        }

        // 7. Free Black (not slaveholder)
        const freeBlackDisq = disqualifications.find(d => d.free_black);
        if (freeBlackDisq) {
            classification = 'free_poc';
            return this._verdict(classification, adjustedConfidence, allEvidence, false, null);
        }

        // 8. Canonical person type disqualification
        const personTypeDisq = disqualifications.find(d => d.source === 'canonical_persons');
        if (personTypeDisq) {
            classification = 'enslaved_ancestor';
            return this._verdict(classification, adjustedConfidence, allEvidence, false, null);
        }

        // 9. Census White + good confidence → confirmed slaveholder
        const censusWhite = corroborations.find(c => c.source === 'census_race');
        if (censusWhite && adjustedConfidence >= 0.70) {
            classification = 'confirmed_slaveholder';
            return this._verdict(classification, adjustedConfidence, allEvidence, false, null);
        }

        // 10. Prior verification → inherit
        const prior = corroborations.find(c => c.source === 'prior_verification');
        if (prior && prior.prior_classification &&
            prior.prior_classification !== 'unverified' &&
            prior.prior_classification !== 'debt') {
            classification = prior.prior_classification;
            return this._verdict(classification, adjustedConfidence, allEvidence, false,
                `Inherited from prior verification`);
        }

        // 11. Conflicting evidence
        if (disqualifications.length > 0 && corroborations.length > 0) {
            classification = 'ambiguous_needs_review';
            return this._verdict(classification, adjustedConfidence, allEvidence, true,
                'Conflicting disqualifying and corroborating evidence');
        }

        // 12. Only name match, no corroboration → unverified
        return this._verdict('unverified', adjustedConfidence, allEvidence, false, null);
    }

    _verdict(classification, confidence_adjusted, evidence, requires_human_review, review_reason) {
        return {
            classification,
            confidence_adjusted: Math.round(confidence_adjusted * 1000) / 1000,
            evidence,
            requires_human_review,
            review_reason
        };
    }
}

module.exports = MatchVerifier;
