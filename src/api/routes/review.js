/**
 * Human Review API — queue-based moderation for the curated evidence graph.
 *
 * Routes (all require X-Admin-Token):
 *   GET  /api/review/queues               — list available queues + pending counts
 *   GET  /api/review/queue/:name          — next N items in a specific queue
 *   POST /api/review/:queue/:id/approve   — approve (create canonical / link)
 *   POST /api/review/:queue/:id/reject    — reject with reason
 *   POST /api/review/:queue/:id/edit      — approve with edits
 *
 * Queues:
 *   enslaver_candidates         — pending rows from enslaver_candidates_review_queue
 *                                  (Freedmen's Bank cross-ref turned up a name that
 *                                  didn't match any existing canonical_persons row;
 *                                  curator decides whether to promote)
 *   unresolved_petitions        — historical_reparations_petitions rows whose
 *                                  claimant_name didn't resolve to canonical (usually
 *                                  name variants — "Anne" vs "Ann")
 *   pending_climb_matches       — ancestor_climb_matches with requires_human_review=true
 *   ambiguous_unconfirmed       — unconfirmed_persons still in needs_review status
 *                                  (the 3,666 single-capword names the cleanup left in
 *                                  place because they resemble given names)
 *   duplicate_canonicals        — clusters of canonical_persons sharing a canonical_name
 *                                  AND having evidence on both sides (merge candidates)
 */

const express = require('express');
const router = express.Router();
const db = require('../../database/connection');
const S3Service = require('../../services/storage/S3Service');

// GET /api/review/queues — list all queues + pending counts
router.get('/queues', async (req, res) => {
    try {
        const queues = [
            {
                name: 'enslaver_candidates',
                title: 'Enslaver candidates (from Freedmens Bank ledgers)',
                description: 'Names that corroborating depositors identified as enslavers, awaiting canonical promotion.',
                count: await pendingCount(`
                    SELECT COUNT(*)::int c FROM enslaver_candidates_review_queue
                    WHERE review_status = 'pending'
                `),
            },
            {
                name: 'unresolved_petitions',
                title: 'DC petitions without canonical claimant',
                description: 'Ingested petition records where the claimant name did not match an existing canonical_persons row.',
                count: await pendingCount(`
                    SELECT COUNT(*)::int c FROM historical_reparations_petitions
                    WHERE claimant_canonical_id IS NULL
                `),
            },
            {
                name: 'pending_climb_matches',
                title: 'Climb matches needing human verification',
                description: 'Ancestor-climb matches flagged for review (Tier 3 name-only matches, ambiguous classifications).',
                count: await pendingCount(`
                    SELECT COUNT(*)::int c FROM ancestor_climb_matches
                    WHERE requires_human_review = TRUE
                      AND verification_status IN ('needs_review','pending_review')
                `),
            },
            {
                name: 'ambiguous_unconfirmed',
                title: 'Ambiguous unconfirmed persons (civilwardc)',
                description: 'OCR-extracted civilwardc names that resemble given names — Mary, John, Charlotte — but lack enough context to auto-classify.',
                count: await pendingCount(`
                    SELECT COUNT(*)::int c FROM unconfirmed_persons
                    WHERE status = 'needs_review'
                      AND source_url ILIKE '%civilwardc%'
                      AND full_name ~ '^[A-Z][a-z]+$'
                `),
            },
            {
                name: 'intake_submissions',
                title: 'New intake form submissions',
                description: 'Participants who submitted the intake form, awaiting human review before ancestor climb is queued.',
                count: await pendingCount(`
                    SELECT COUNT(*)::int c FROM participants
                    WHERE 'intake_pending_review' = ANY(roles)
                `),
            },
            {
                name: 'parse_failures',
                title: 'Parse failures awaiting manual field entry',
                description: 'Documents where Document AI or Vision OCR failed to extract required fields. Your corrections become labeled training data for the next fine-tune.',
                count: await pendingCount(`
                    SELECT COUNT(*)::int c FROM parse_failure_queue
                    WHERE review_status = 'pending'
                `),
            },
            {
                name: 'duplicate_canonicals',
                title: 'Duplicate canonical_persons candidates',
                description: 'Scored duplicate-person pairs from the entity-resolution resolver (blocking + Biscoe-rule scoring). Auto-merge candidates first, then review. Every merge is human-confirmed.',
                count: await pendingCount(`
                    SELECT COUNT(*)::int c FROM dedup_candidate_pairs WHERE status = 'pending'
                `),
            },
            {
                name: 'cross_source_enslavers',
                title: 'Cross-source enslaver links',
                description: 'Unlinked enslaver unconfirmed_persons leads matched to an existing canonical enslaver by name + state/county. Confirm to link the lead to that canonical person.',
                count: await pendingCount(`
                    SELECT COUNT(*)::int c FROM cross_source_candidates WHERE status = 'pending' AND entity_kind = 'enslaver'
                `),
            },
        ];
        res.json({ success: true, queues });
    } catch (e) {
        console.error('queues error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

async function pendingCount(sql) {
    const r = await db.query(sql);
    return r.rows[0].c;
}

// GET /api/review/queue/:name?limit=20&offset=0
router.get('/queue/:name', async (req, res) => {
    const { name } = req.params;
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = Math.max(0, parseInt(req.query.offset) || 0);

    try {
        let items = [];
        switch (name) {
            case 'enslaver_candidates':
                items = await getEnslaverCandidates(limit, offset);
                break;
            case 'unresolved_petitions':
                items = await getUnresolvedPetitions(limit, offset);
                break;
            case 'pending_climb_matches':
                items = await getPendingClimbMatches(limit, offset);
                break;
            case 'ambiguous_unconfirmed':
                items = await getAmbiguousUnconfirmed(limit, offset);
                break;
            case 'parse_failures':
                items = await getParseFailures(limit, offset);
                break;
            case 'duplicate_canonicals':
                items = await getDuplicateCanonicals(limit, offset);
                break;
            case 'cross_source_enslavers':
                items = await getCrossSourceEnslavers(limit, offset);
                break;
            default:
                return res.status(404).json({ success: false, error: 'Unknown queue' });
        }
        res.json({ success: true, queue: name, items });
    } catch (e) {
        console.error(`queue ${name} error:`, e);
        res.status(500).json({ success: false, error: e.message });
    }
});

async function getEnslaverCandidates(limit, offset) {
    const r = await db.query(`
        SELECT candidate_id AS id, proposed_name, proposed_role, proposed_primary_state,
               corroborating_depositor_count, source_ledger_arks, depositor_names,
               reviewer_notes, created_at
        FROM enslaver_candidates_review_queue
        WHERE review_status = 'pending'
        ORDER BY corroborating_depositor_count DESC, proposed_name
        LIMIT $1 OFFSET $2
    `, [limit, offset]);
    return r.rows.map(row => ({
        id: row.id,
        kind: 'enslaver_candidate',
        title: row.proposed_name,
        subtitle: `Role: ${row.proposed_role || 'master'} | State: ${row.proposed_primary_state || '(none)'} | Corroborating depositors: ${row.corroborating_depositor_count}`,
        detail: row.reviewer_notes,
        evidence_urls: (row.source_ledger_arks || []).slice(0, 5),
        depositor_names: row.depositor_names || [],
        created_at: row.created_at,
    }));
}

async function getUnresolvedPetitions(limit, offset) {
    const r = await db.query(`
        SELECT petition_id AS id, docket_number, claimant_name, filed_date,
               source_document_url,
               jsonb_array_length(COALESCE(enslaved_persons_claimed, '[]'::jsonb)) AS enslaved_count,
               total_claimed_usd, source_notes
        FROM historical_reparations_petitions
        WHERE claimant_canonical_id IS NULL
        ORDER BY docket_number
        LIMIT $1 OFFSET $2
    `, [limit, offset]);
    const items = [];
    for (const row of r.rows) {
        // Propose candidate canonicals by fuzzy name
        const cand = await db.query(`
            SELECT id, canonical_name, primary_state, person_type
            FROM canonical_persons
            WHERE person_type = 'enslaver'
              AND (
                  LOWER(canonical_name) = LOWER($1)
                  OR SIMILARITY(canonical_name, $1) > 0.5
              )
            ORDER BY SIMILARITY(canonical_name, $1) DESC
            LIMIT 5
        `, [row.claimant_name]).catch(() => ({ rows: [] }));
        items.push({
            id: row.id,
            kind: 'unresolved_petition',
            title: `${row.docket_number} — ${row.claimant_name}`,
            subtitle: `Filed ${row.filed_date} | ${row.enslaved_count} enslaved persons claimed | $${row.total_claimed_usd ?? '?'}`,
            detail: row.source_notes,
            evidence_urls: [row.source_document_url],
            candidate_canonicals: cand.rows,
            created_at: null,
        });
    }
    return items;
}

async function getPendingClimbMatches(limit, offset) {
    const r = await db.query(`
        SELECT acm.id, acm.slaveholder_name, acm.slaveholder_id, acm.slaveholder_location,
               acm.match_type, acm.match_confidence, acm.classification, acm.classification_reason,
               acm.review_reason, acm.lineage_path, s.modern_person_name, s.modern_person_fs_id
        FROM ancestor_climb_matches acm
        JOIN ancestor_climb_sessions s ON s.id = acm.session_id
        WHERE acm.requires_human_review = TRUE
          AND acm.verification_status IN ('needs_review','pending_review')
        ORDER BY acm.match_confidence DESC NULLS LAST
        LIMIT $1 OFFSET $2
    `, [limit, offset]);
    return r.rows.map(row => ({
        id: row.id,
        kind: 'climb_match',
        title: `${row.slaveholder_name} (for ${row.modern_person_name})`,
        subtitle: `${row.match_type} | conf ${row.match_confidence} | ${row.classification || '?'}`,
        detail: `Path: ${(row.lineage_path || []).join(' → ')}\n\nReason: ${row.classification_reason || row.review_reason || ''}`,
        candidate_canonicals: row.slaveholder_id ? [{ id: row.slaveholder_id, canonical_name: row.slaveholder_name, primary_state: row.slaveholder_location }] : [],
    }));
}

async function getAmbiguousUnconfirmed(limit, offset) {
    const r = await db.query(`
        SELECT lead_id AS id, full_name, person_type, source_url, context_text
        FROM unconfirmed_persons
        WHERE status = 'needs_review'
          AND source_url ILIKE '%civilwardc%'
          AND full_name ~ '^[A-Z][a-z]+$'
        ORDER BY full_name
        LIMIT $1 OFFSET $2
    `, [limit, offset]);
    return r.rows.map(row => ({
        id: row.id,
        kind: 'ambiguous_unconfirmed',
        title: row.full_name,
        subtitle: `Proposed type: ${row.person_type || '?'}`,
        detail: row.context_text?.slice(0, 400),
        evidence_urls: [row.source_url],
    }));
}

async function getParseFailures(limit, offset) {
    const r = await db.query(`
        SELECT failure_id AS id, document_type, source_identifier, s3_key, source_url,
               engine_attempted, engine_confidence, extracted_fields,
               failure_reason, required_fields_missing, error_message
        FROM parse_failure_queue
        WHERE review_status = 'pending'
        ORDER BY created_at ASC
        LIMIT $1 OFFSET $2
    `, [limit, offset]);
    return r.rows.map(row => ({
        id: row.id,
        kind: 'parse_failure',
        title: `${row.document_type} — ${row.source_identifier || '(no id)'}`,
        subtitle: `${row.engine_attempted} | conf=${row.engine_confidence ?? '?'} | reason=${row.failure_reason}`
            + (row.required_fields_missing?.length ? ` | missing: ${row.required_fields_missing.join(', ')}` : ''),
        detail: (row.error_message ? `Error: ${row.error_message}\n\n` : '')
            + `Engine extracted: ${JSON.stringify(row.extracted_fields || {}, null, 2)}`,
        evidence_urls: [row.source_url, row.s3_key ? `/api/review/s3-url?key=${encodeURIComponent(row.s3_key)}` : null].filter(Boolean),
        extracted_fields: row.extracted_fields || {},
    }));
}

async function getDuplicateCanonicals(limit, offset) {
    // Scored pairs from the resolver, highest-confidence first. Each side is
    // enriched with attributes + a source-document count so the reviewer can
    // pick the survivor (the richer record) before confirming a merge.
    const r = await db.query(`
        SELECT d.id, d.person_a_id, d.person_b_id, d.score, d.route, d.evidence, d.blocking_keys,
               a.canonical_name a_name, a.birth_year_estimate a_birth, a.death_year_estimate a_death,
               a.primary_state a_state, a.person_type a_type,
               (SELECT COUNT(*)::int FROM person_documents pd WHERE pd.canonical_person_id = a.id) a_docs,
               b.canonical_name b_name, b.birth_year_estimate b_birth, b.death_year_estimate b_death,
               b.primary_state b_state, b.person_type b_type,
               (SELECT COUNT(*)::int FROM person_documents pd WHERE pd.canonical_person_id = b.id) b_docs
        FROM dedup_candidate_pairs d
        JOIN canonical_persons a ON a.id = d.person_a_id
        JOIN canonical_persons b ON b.id = d.person_b_id
        WHERE d.status = 'pending' AND a.person_type <> 'merged' AND b.person_type <> 'merged'
        ORDER BY (d.route = 'auto_merge_candidate') DESC, d.score DESC, d.id
        LIMIT $1 OFFSET $2
    `, [limit, offset]);
    return r.rows.map(row => {
        // suggest the richer record (more source docs, tie-break lower id) as survivor
        const aRicher = row.a_docs > row.b_docs || (row.a_docs === row.b_docs && row.person_a_id < row.person_b_id);
        const survivor = aRicher ? row.person_a_id : row.person_b_id;
        const victim = aRicher ? row.person_b_id : row.person_a_id;
        const fmt = (n, y1, y2, st, t, docs) => `cp=${n} "${''}" ${y1 || '?'}–${y2 || '?'} ${st || ''} [${t}] · ${docs} docs`;
        return {
            id: String(row.id),
            kind: 'dedup_pair',
            title: `${row.route === 'auto_merge_candidate' ? '★ ' : ''}${row.score} — "${row.a_name}" ⟷ "${row.b_name}"`,
            subtitle: `${row.route} · suggested survivor cp=${survivor}, fold cp=${victim}`,
            detail: (Array.isArray(row.evidence) ? row.evidence : []).join(' · '),
            score: Number(row.score),
            route: row.route,
            evidence: Array.isArray(row.evidence) ? row.evidence : [],
            blocking_keys: row.blocking_keys || [],
            suggested_survivor: survivor,
            suggested_victim: victim,
            person_a: { id: row.person_a_id, name: row.a_name, birth: row.a_birth, death: row.a_death, state: row.a_state, type: row.a_type, docs: row.a_docs, label: fmt(row.person_a_id, row.a_birth, row.a_death, row.a_state, row.a_type, row.a_docs) },
            person_b: { id: row.person_b_id, name: row.b_name, birth: row.b_birth, death: row.b_death, state: row.b_state, type: row.b_type, docs: row.b_docs, label: fmt(row.person_b_id, row.b_birth, row.b_death, row.b_state, row.b_type, row.b_docs) },
        };
    });
}

async function getCrossSourceEnslavers(limit, offset) {
    const r = await db.query(`
        SELECT x.id, x.canonical_person_id, x.unconfirmed_lead_id, x.score, x.route, x.evidence,
               x.canonical_name, x.unconfirmed_name, x.location,
               cp.primary_state cp_state, cp.primary_county cp_county,
               (SELECT COUNT(*)::int FROM person_documents pd WHERE pd.canonical_person_id = cp.id) cp_docs,
               u.locations u_locations, u.source_type u_source
        FROM cross_source_candidates x
        JOIN canonical_persons cp ON cp.id = x.canonical_person_id
        JOIN unconfirmed_persons u ON u.lead_id = x.unconfirmed_lead_id
        WHERE x.status = 'pending' AND x.entity_kind = 'enslaver'
          AND cp.person_type <> 'merged' AND u.confirmed_individual_id IS NULL
        ORDER BY (x.route = 'auto_link_candidate') DESC, x.score DESC, x.id
        LIMIT $1 OFFSET $2
    `, [limit, offset]);
    return r.rows.map(row => ({
        id: String(row.id),
        kind: 'xsrc_enslaver',
        title: `${row.route === 'auto_link_candidate' ? '★ ' : ''}${row.score} — lead "${row.unconfirmed_name}" → cp=${row.canonical_person_id} "${row.canonical_name}"`,
        subtitle: `${row.route} · ${row.location || ''}`,
        detail: (Array.isArray(row.evidence) ? row.evidence : []).join(' · '),
        score: Number(row.score),
        route: row.route,
        evidence: Array.isArray(row.evidence) ? row.evidence : [],
        canonical: { id: row.canonical_person_id, name: row.canonical_name, state: row.cp_state, county: row.cp_county, docs: row.cp_docs },
        lead: { id: row.unconfirmed_lead_id, name: row.unconfirmed_name, location: row.location, source: row.u_source },
    }));
}

// ═══ ACTIONS ═══

// POST /api/review/enslaver_candidates/:id/approve
// Body: { winner_canonical_id: null | number, edit_name?: string }
//   If winner_canonical_id provided, attach candidate's depositors as edges to that canonical.
//   If not, create a new canonical_persons row using proposed_name (or edit_name if provided).
router.post('/enslaver_candidates/:id/approve', async (req, res) => {
    const { id } = req.params;
    const { winner_canonical_id, edit_name } = req.body || {};
    try {
        const cand = await db.query(`SELECT * FROM enslaver_candidates_review_queue WHERE candidate_id = $1`, [id]);
        if (!cand.rowCount) return res.status(404).json({ success: false, error: 'Candidate not found' });
        const c = cand.rows[0];
        const finalName = edit_name || c.proposed_name;

        let cpId = winner_canonical_id;
        if (!cpId) {
            // Create new canonical_persons row
            const ins = await db.query(`
                INSERT INTO canonical_persons (canonical_name, person_type, primary_state, notes)
                VALUES ($1, 'enslaver', $2, $3)
                RETURNING id
            `, [
                finalName, c.proposed_primary_state,
                `Approved via review queue. Original candidate: "${c.proposed_name}". ${c.corroborating_depositor_count} corroborating Freedmens depositors.`,
            ]);
            cpId = ins.rows[0].id;
        }

        // Create family_relationships edges for each depositor
        let edgesAdded = 0;
        const leadIds = c.depositor_lead_ids || [];
        const arks = c.source_ledger_arks || [];
        for (let i = 0; i < leadIds.length; i++) {
            const dep = await db.query(`SELECT full_name FROM unconfirmed_persons WHERE lead_id = $1`, [leadIds[i]]);
            if (!dep.rowCount) continue;
            await db.query(`
                INSERT INTO family_relationships (
                    person1_name, person1_role, person2_name, person2_role, person2_lead_id,
                    relationship_type, source_url, matched_text, confidence
                ) VALUES ($1, 'slaveholder', $2, 'freedperson', $3,
                          'enslaved_by', $4,
                          'Approved via human review: depositor named this person as former enslaver on Freedmens Bank ledger',
                          0.80)
                ON CONFLICT DO NOTHING
            `, [finalName, dep.rows[0].full_name, leadIds[i], arks[i] || arks[0]]);
            edgesAdded++;
        }

        await db.query(`
            UPDATE enslaver_candidates_review_queue
            SET review_status = 'approved',
                review_reason_code = 'approved',
                resolved_canonical_id = $2,
                reviewed_by = $3,
                reviewed_at = NOW(),
                reviewer_notes = COALESCE(reviewer_notes, '') || ' | Approved via /review UI.'
            WHERE candidate_id = $1
        `, [id, cpId, req.headers['x-reviewer'] || 'admin']);

        res.json({ success: true, canonical_id: cpId, edges_added: edgesAdded });
    } catch (e) {
        console.error('enslaver_candidate approve error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/review/enslaver_candidates/:id/reject
router.post('/enslaver_candidates/:id/reject', async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body || {};
    try {
        await db.query(`
            UPDATE enslaver_candidates_review_queue
            SET review_status = 'rejected',
                review_reason_code = 'rejected',
                reviewed_by = $2, reviewed_at = NOW(),
                reviewer_notes = COALESCE(reviewer_notes, '') || ' | Rejected: ' || $3
            WHERE candidate_id = $1
        `, [id, req.headers['x-reviewer'] || 'admin', reason || 'no-reason-given']);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/review/unresolved_petitions/:id/approve
// Body: { winner_canonical_id: number | null, edit_claimant?: string }
router.post('/unresolved_petitions/:id/approve', async (req, res) => {
    const { id } = req.params;
    const { winner_canonical_id, edit_claimant } = req.body || {};
    try {
        let cpId = winner_canonical_id;
        if (!cpId && edit_claimant) {
            // Create new canonical under edit_claimant
            const ins = await db.query(`
                INSERT INTO canonical_persons (canonical_name, person_type, primary_state, notes)
                VALUES ($1, 'enslaver', 'District of Columbia', 'Approved via petition review queue')
                RETURNING id
            `, [edit_claimant]);
            cpId = ins.rows[0].id;
        }
        if (!cpId) return res.status(400).json({ success: false, error: 'Provide winner_canonical_id or edit_claimant' });

        await db.query(`
            UPDATE historical_reparations_petitions
            SET claimant_canonical_id = $2, verification_status = 'verified'
            WHERE petition_id = $1
        `, [id, cpId]);
        res.json({ success: true, canonical_id: cpId });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/review/pending_climb_matches/:id/approve
router.post('/pending_climb_matches/:id/approve', async (req, res) => {
    const { id } = req.params;
    const { classification } = req.body || {};
    try {
        await db.query(`
            UPDATE ancestor_climb_matches
            SET verification_status = 'human_verified',
                classification = COALESCE($2, classification),
                requires_human_review = FALSE,
                verified_by = $3, verified_at = NOW()
            WHERE id = $1
        `, [id, classification, req.headers['x-reviewer'] || 'admin']);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/review/pending_climb_matches/:id/reject
router.post('/pending_climb_matches/:id/reject', async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body || {};
    try {
        await db.query(`
            UPDATE ancestor_climb_matches
            SET verification_status = 'human_rejected',
                classification = 'rejected_by_human',
                classification_reason = COALESCE(classification_reason, '') || ' | Human rejected: ' || $2,
                requires_human_review = FALSE,
                verified_by = $3, verified_at = NOW()
            WHERE id = $1
        `, [id, reason || 'no-reason', req.headers['x-reviewer'] || 'admin']);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/review/ambiguous_unconfirmed/:id/approve (promote to enslaved or enslaver as specified)
router.post('/ambiguous_unconfirmed/:id/approve', async (req, res) => {
    const { id } = req.params;
    const { target_type, edit_name } = req.body || {};
    if (!['enslaved','enslaver','freedperson'].includes(target_type)) {
        return res.status(400).json({ success: false, error: 'target_type must be enslaved, enslaver, or freedperson' });
    }
    try {
        const upd = await db.query(`
            UPDATE unconfirmed_persons
            SET status = 'confirmed', person_type = $2, full_name = COALESCE($3, full_name),
                reviewed_by = $4, reviewed_at = NOW(),
                review_notes = COALESCE(review_notes, '') || ' | Approved via review UI as ' || $2
            WHERE lead_id = $1 RETURNING lead_id
        `, [id, target_type, edit_name || null, req.headers['x-reviewer'] || 'admin']);
        res.json({ success: true, updated: upd.rowCount });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/review/ambiguous_unconfirmed/:id/reject
router.post('/ambiguous_unconfirmed/:id/reject', async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body || {};
    try {
        await db.query(`
            UPDATE unconfirmed_persons
            SET status = 'rejected', rejection_reason = $2,
                reviewed_by = $3, reviewed_at = NOW(),
                review_notes = COALESCE(review_notes, '') || ' | Rejected via review UI: ' || $2
            WHERE lead_id = $1
        `, [id, reason || 'not_a_person', req.headers['x-reviewer'] || 'admin']);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ═══ PARSE FAILURE actions ═══

// POST /api/review/parse_failures/:id/submit
// Body: { reviewer_fields: { depositor_name, last_master, ... }, mark_training_eligible: true }
router.post('/parse_failures/:id/submit', async (req, res) => {
    const { id } = req.params;
    const { reviewer_fields, mark_training_eligible } = req.body || {};
    if (!reviewer_fields || typeof reviewer_fields !== 'object') {
        return res.status(400).json({ success: false, error: 'reviewer_fields object required' });
    }
    try {
        await db.query(`
            UPDATE parse_failure_queue
            SET reviewer_fields = $2::jsonb,
                review_status = 'resolved',
                training_eligible = $3,
                reviewed_by = $4, reviewed_at = NOW()
            WHERE failure_id = $1
        `, [id, JSON.stringify(reviewer_fields), !!mark_training_eligible, req.headers['x-reviewer'] || 'admin']);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/review/parse_failures/:id/unreviewable
router.post('/parse_failures/:id/unreviewable', async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body || {};
    try {
        await db.query(`
            UPDATE parse_failure_queue
            SET review_status = 'unreviewable',
                reviewer_notes = COALESCE(reviewer_notes, '') || ' | Marked unreviewable: ' || $2,
                reviewed_by = $3, reviewed_at = NOW()
            WHERE failure_id = $1
        `, [id, reason || 'no reason', req.headers['x-reviewer'] || 'admin']);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ═══ DEDUP PAIR ACTIONS (duplicate_canonicals queue) ═══
// All three resolve a row in dedup_candidate_pairs. Merges are HAND-CONFIRMED
// here (Biscoe rule: never auto-merge) and executed FK-safely by the existing
// scripts/merge-canonical-persons.mjs tool (42-FK-aware, logs person_merge_log).
const { execFile } = require('child_process');
const nodePath = require('path');
const MERGE_TOOL = nodePath.resolve(__dirname, '../../../scripts/merge-canonical-persons.mjs');

function runMerge(survivor, victim) {
    return new Promise((resolve, reject) => {
        execFile('node', [MERGE_TOOL, '--survivor', String(survivor), '--victim', String(victim), '--apply'],
            { cwd: nodePath.resolve(__dirname, '../../../'), timeout: 120000 },
            (err, stdout, stderr) => {
                if (err) return reject(new Error((stderr || stdout || err.message).slice(-800)));
                resolve(stdout);
            });
    });
}

// POST /api/review/duplicate_canonicals/:id/merge  Body: { survivor_id, victim_id }
router.post('/duplicate_canonicals/:id/merge', async (req, res) => {
    const { id } = req.params;
    let { survivor_id, victim_id } = req.body || {};
    survivor_id = parseInt(survivor_id, 10); victim_id = parseInt(victim_id, 10);
    const reviewer = req.headers['x-reviewer'] || 'admin';
    try {
        const pair = (await db.query(`SELECT person_a_id, person_b_id, status FROM dedup_candidate_pairs WHERE id = $1`, [id])).rows[0];
        if (!pair) return res.status(404).json({ success: false, error: 'pair not found' });
        if (pair.status !== 'pending') return res.status(409).json({ success: false, error: `already ${pair.status}` });
        const ids = [pair.person_a_id, pair.person_b_id];
        if (!ids.includes(survivor_id) || !ids.includes(victim_id) || survivor_id === victim_id) {
            return res.status(400).json({ success: false, error: 'survivor_id/victim_id must be the two persons of this pair' });
        }
        // Remove all dedup_candidate_pairs that reference the victim BEFORE merging.
        // The merge tool rewrites victim→survivor on every FK, which would turn the
        // merged pair into a self-referential (survivor,survivor) row and violate the
        // person_a_id<person_b_id CHECK. The durable audit lives in person_merge_log;
        // survivor's other pending pairs (with third parties) are untouched.
        await db.query(`DELETE FROM dedup_candidate_pairs WHERE person_a_id=$1 OR person_b_id=$1`, [victim_id]);
        await runMerge(survivor_id, victim_id);
        res.json({ success: true, survivor: survivor_id, victim: victim_id, reviewer });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/review/duplicate_canonicals/:id/distinct — confirm NOT a duplicate
router.post('/duplicate_canonicals/:id/distinct', async (req, res) => {
    const { id } = req.params;
    try {
        await db.query(`UPDATE dedup_candidate_pairs SET status='confirmed_distinct', reviewed_by=$2, reviewed_at=NOW(),
            reviewer_notes=COALESCE(reviewer_notes,'') || ' | ' || COALESCE($3,'') WHERE id=$1`,
            [id, req.headers['x-reviewer'] || 'admin', (req.body && req.body.reason) || '']);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/review/duplicate_canonicals/:id/skip — defer (needs more research)
router.post('/duplicate_canonicals/:id/skip', async (req, res) => {
    const { id } = req.params;
    try {
        await db.query(`UPDATE dedup_candidate_pairs SET status='skipped', reviewed_by=$2, reviewed_at=NOW() WHERE id=$1`,
            [id, req.headers['x-reviewer'] || 'admin']);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ═══ CROSS-SOURCE ENSLAVER ACTIONS ═══
// POST /api/review/cross_source_enslavers/:id/link — confirm the lead IS this canonical person
router.post('/cross_source_enslavers/:id/link', async (req, res) => {
    const { id } = req.params;
    const reviewer = req.headers['x-reviewer'] || 'admin';
    try {
        const c = (await db.query(`SELECT canonical_person_id, unconfirmed_lead_id, status FROM cross_source_candidates WHERE id=$1`, [id])).rows[0];
        if (!c) return res.status(404).json({ success: false, error: 'candidate not found' });
        if (c.status !== 'pending') return res.status(409).json({ success: false, error: `already ${c.status}` });
        // link the lead to the canonical person (confirmed_individual_id is varchar)
        await db.query(`UPDATE unconfirmed_persons SET confirmed_individual_id=$2, status='confirmed',
            reviewed_by=$3, reviewed_at=NOW(),
            review_notes=COALESCE(review_notes,'') || ' | linked to canonical cp=' || $2 || ' (cross-source resolver)'
            WHERE lead_id=$1`, [c.unconfirmed_lead_id, String(c.canonical_person_id), reviewer]);
        await db.query(`UPDATE cross_source_candidates SET status='linked', reviewed_by=$2, reviewed_at=NOW() WHERE id=$1`, [id, reviewer]);
        // other pending candidates for the same lead are now moot
        await db.query(`UPDATE cross_source_candidates SET status='skipped',
            reviewer_notes=COALESCE(reviewer_notes,'') || ' | lead linked elsewhere'
            WHERE status='pending' AND unconfirmed_lead_id=$1 AND id<>$2`, [c.unconfirmed_lead_id, id]);
        res.json({ success: true, lead: c.unconfirmed_lead_id, canonical: c.canonical_person_id });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/review/cross_source_enslavers/:id/distinct — NOT the same person
router.post('/cross_source_enslavers/:id/distinct', async (req, res) => {
    try {
        await db.query(`UPDATE cross_source_candidates SET status='confirmed_distinct', reviewed_by=$2, reviewed_at=NOW(),
            reviewer_notes=COALESCE(reviewer_notes,'') || ' | ' || COALESCE($3,'') WHERE id=$1`,
            [req.params.id, req.headers['x-reviewer'] || 'admin', (req.body && req.body.reason) || '']);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/review/cross_source_enslavers/:id/skip
router.post('/cross_source_enslavers/:id/skip', async (req, res) => {
    try {
        await db.query(`UPDATE cross_source_candidates SET status='skipped', reviewed_by=$2, reviewed_at=NOW() WHERE id=$1`,
            [req.params.id, req.headers['x-reviewer'] || 'admin']);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/review/s3-url?key=<s3-key> — presigned URL for inline image viewing
router.get('/s3-url', async (req, res) => {
    const { key } = req.query;
    if (!key) return res.status(400).json({ success: false, error: 'key required' });
    try {
        const url = await S3Service.getViewUrl(key, 900);
        res.json({ success: true, url });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
