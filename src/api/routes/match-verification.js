/**
 * Match Verification API
 *
 * Wraps src/services/match-verification.js (MatchVerifier) so the
 * post-climb verification step can be driven over HTTP rather than only
 * via scripts/re-evaluate-matches.js. Same verdict logic; different
 * trigger surface.
 */

const express = require('express');
const router = express.Router();
const { sql } = require('../../database/connection');
const MatchVerifier = require('../../services/match-verification');

const verifier = new MatchVerifier(sql);

// POST /api/match-verification/run/:sessionId
// Body: { onlyUnverified?: boolean (default true), dryRun?: boolean (default false) }
router.post('/run/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const onlyUnverified = req.body?.onlyUnverified !== false;
    const dryRun = req.body?.dryRun === true;

    try {
        const matches = onlyUnverified
            ? await sql`
                SELECT * FROM ancestor_climb_matches
                WHERE session_id = ${sessionId}::uuid
                  AND (classification IS NULL OR classification IN ('unverified', 'debt'))
                ORDER BY generation_distance ASC, found_at ASC
            `
            : await sql`
                SELECT * FROM ancestor_climb_matches
                WHERE session_id = ${sessionId}::uuid
                ORDER BY generation_distance ASC, found_at ASC
            `;

        const stats = {
            total: matches.length,
            reclassified: 0,
            unchanged: 0,
            errors: 0,
            needs_review: 0,
            by_classification: {},
        };
        const errors = [];

        for (const m of matches) {
            const ancestor = {
                name: m.slaveholder_name,
                birth_year: m.slaveholder_birth_year,
                fs_id: m.slaveholder_fs_id,
                locations: m.slaveholder_location ? [m.slaveholder_location] : [],
                race_indicators: [],
                occupation: null,
            };
            const candidateMatch = {
                canonical_name: m.slaveholder_name,
                slaveholder_name: m.slaveholder_name,
                slaveholder_fs_id: m.slaveholder_fs_id,
                birth_year_estimate: m.slaveholder_birth_year,
                slaveholder_birth_year: m.slaveholder_birth_year,
                confidence: parseFloat(m.match_confidence) || 0.50,
                match_confidence: parseFloat(m.match_confidence) || 0.50,
                type: m.match_type,
                fs_id: m.slaveholder_fs_id,
            };
            const generation = m.generation_distance || 0;

            try {
                const verdict = await verifier.verify(ancestor, candidateMatch, generation);
                const oldCls = m.classification || 'debt';
                const changed = oldCls !== verdict.classification;
                if (changed) stats.reclassified++; else stats.unchanged++;
                if (verdict.requires_human_review) stats.needs_review++;
                stats.by_classification[verdict.classification] =
                    (stats.by_classification[verdict.classification] || 0) + 1;

                if (!dryRun && changed) {
                    await sql`
                        UPDATE ancestor_climb_matches
                        SET classification = ${verdict.classification},
                            classification_reason = ${verdict.evidence.map(e => e.detail).join('; ') || 'Re-evaluated via API'},
                            verification_status = ${verdict.requires_human_review ? 'needs_review' : 'auto_verified'},
                            verification_evidence = ${JSON.stringify(verdict.evidence)},
                            confidence_adjusted = ${verdict.confidence_adjusted},
                            requires_human_review = ${verdict.requires_human_review},
                            review_reason = ${verdict.review_reason}
                        WHERE id = ${m.id}
                    `;
                }
            } catch (err) {
                stats.errors++;
                errors.push({ match_id: m.id, name: m.slaveholder_name, error: err.message });
            }
        }

        res.json({ success: true, sessionId, dryRun, stats, errors });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
