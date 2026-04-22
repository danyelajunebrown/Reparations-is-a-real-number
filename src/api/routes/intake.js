/**
 * Intake webhook endpoint — receives Google Forms submissions via Apps
 * Script trigger on each form submit.
 *
 * Positional mapping: the form has six columns literally titled "Full
 * legal name" (self + father + mother + 4 grandparents), so we can't
 * key by header text — duplicates collapse. Instead we map by column
 * INDEX in the sheet's ordered `values` array. Column positions are
 * documented in FORM_COLUMNS below and match the current Google Form
 * as of 2026-04-21.
 *
 * If the form changes: update FORM_COLUMNS to reflect the new ordinal
 * positions. Don't rely on header-text aliases.
 *
 * Auth: POST requires X-Webhook-Secret matching INTAKE_WEBHOOK_SECRET.
 */

const express = require('express');
const router = express.Router();
const db = require('../../database/connection');
const logger = require('../../utils/logger');

// Column indices (0-based) in the current form's ordered values array.
// Apps Script passes `values` as a positional array of all sheet columns.
const FORM_COLUMNS = {
    timestamp:                  0,
    consent_research:           1,
    consent_income:             2,
    consent_negative:           3,
    consent_blockchain:         4,
    // column 5 is a placeholder ("Column 5") — skip
    full_name:                  6,
    date_of_birth:              7,
    birthplace:                 8,
    email:                      9,
    address_line1:             10,
    address_city:              11,
    address_state:             12,
    address_zip:               13,
    self_fs_id:                14,
    self_is_living:            15,
    annual_income:             16,
    estimated_net_worth:       17,
    real_estate_equity:        18,
    inheritance_received:      19,
    inheritance_expected:      20,
    tax_filing_status:         21,
    num_dependents:            22,
    trust_beneficiary:         23,
    trust_corpus:              24,
    family_business_ownership: 25,
    family_business_details:   26,
    inherited_land_50_acres:   27,
    inherited_land_details:    28,
    corporate_connections:     29,
    executive_board_history:   30,
    pre_1865_business:         31,
    // Family — each person occupies 5 consecutive columns:
    //   [name, birth_year, birthplace, fs_id, is_living]
    father:                    32,
    mother:                    37,
    paternal_grandfather:      42,
    paternal_grandmother:      47,
    maternal_grandfather:      52,
    maternal_grandmother:      57,
    // Tail
    verified_fs_links:         62,
    four_grandparents_linked:  63,
    gap_description:           64,
    additional_notes:          65,
    accuracy_certification:    66,
    email_backup:              67,
};

const FAMILY_ROLES = ['father', 'mother', 'paternal_grandfather', 'paternal_grandmother', 'maternal_grandfather', 'maternal_grandmother'];

function parseBool(v) {
    if (typeof v === 'boolean') return v;
    const s = String(v ?? '').toLowerCase().trim();
    if (/^(yes|true|y|agree|1|^yes\s*\(living\))/i.test(s)) return true;
    if (/^(no|false|n|disagree|0|^no\s*\(deceased\))/i.test(s)) return false;
    return null;  // "don't know" etc.
}

function parseNum(v) {
    if (v == null || v === '') return null;
    const s = String(v).replace(/[^\d.-]/g, '');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
}

function parseDate(v) {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function fsIdClean(v) {
    if (!v) return null;
    const s = String(v).trim().toUpperCase();
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{2,4}$/.test(s)) return null;
    return s;
}

/**
 * Extract values from the positional array using FORM_COLUMNS map.
 */
function mapValues(values) {
    const p = {};
    const family = {};
    if (!Array.isArray(values)) return { participant: p, family };

    for (const [field, idx] of Object.entries(FORM_COLUMNS)) {
        if (FAMILY_ROLES.includes(field)) {
            // Family person: 5-column block
            const relation = field;
            family[relation] = {
                name:      values[idx]     || null,
                birth_year: parseNum(values[idx + 1]),
                birthplace: values[idx + 2] || null,
                fs_id:      fsIdClean(values[idx + 3]),
                is_living:  parseBool(values[idx + 4]),
            };
            continue;
        }
        p[field] = values[idx];
    }
    return { participant: p, family };
}

// POST /api/intake/submit
router.post('/submit', async (req, res) => {
    const SECRET = process.env.INTAKE_WEBHOOK_SECRET;
    if (!SECRET) {
        return res.status(503).json({ success: false, error: 'INTAKE_WEBHOOK_SECRET not configured' });
    }
    const provided = req.headers['x-webhook-secret'];
    if (!provided || provided !== SECRET) {
        logger.warn('Intake webhook: bad secret', { ip: req.ip });
        return res.status(401).json({ success: false, error: 'bad or missing X-Webhook-Secret' });
    }

    const payload = req.body || {};

    // Prefer positional `values` array; fall back to `row` object for
    // backward compat with older Apps Script versions.
    let values = Array.isArray(payload.values) ? payload.values : null;
    if (!values && payload.row && typeof payload.row === 'object') {
        // Can't do positional mapping from object keys reliably, but
        // if the row was sent as an indexed object (e.g. {"0":"x","1":"y"})
        // convert that to an array.
        const keys = Object.keys(payload.row);
        if (keys.every(k => /^\d+$/.test(k))) {
            values = keys.sort((a, b) => +a - +b).map(k => payload.row[k]);
        }
    }

    if (!values) {
        return res.status(400).json({
            success: false,
            error: 'expected payload.values (positional array) from Apps Script',
            hint: 'Update Apps Script to send values as an array, not row as an object keyed by header text.',
        });
    }

    const { participant: p, family } = mapValues(values);

    // Coerce types for participants insertion
    const coerced = {
        full_name:           p.full_name ? String(p.full_name).trim() : null,
        email:               (p.email || p.email_backup) ? String(p.email || p.email_backup).trim().toLowerCase() : null,
        date_of_birth:       parseDate(p.date_of_birth),
        birthplace:          p.birthplace || null,
        address_line1:       p.address_line1 || null,
        address_city:        p.address_city || null,
        address_state:       p.address_state || null,
        address_zip:         p.address_zip || null,
        annual_income:       parseNum(p.annual_income),
        estimated_net_worth: parseNum(p.estimated_net_worth),
        real_estate_equity:  parseNum(p.real_estate_equity),
        inheritance_received: parseNum(p.inheritance_received),
        inheritance_expected: parseNum(p.inheritance_expected),
        tax_filing_status:   p.tax_filing_status || null,
        num_dependents:      parseNum(p.num_dependents),
        self_fs_id:          fsIdClean(p.self_fs_id),
        self_is_living:      parseBool(p.self_is_living),
        consent_research:    parseBool(p.consent_research),
        consent_income:      parseBool(p.consent_income),
        consent_negative:    parseBool(p.consent_negative),
        consent_blockchain:  parseBool(p.consent_blockchain),
    };

    if (!coerced.full_name) {
        logger.warn('Intake webhook 400: no full_name at index 6', {
            values_length: values.length,
            first_10: values.slice(0, 10),
        });
        return res.status(400).json({
            success: false,
            error: 'full_name required (column index 6 was empty)',
            received_values_length: values.length,
        });
    }

    try {
        // Idempotency by email + timestamp — don't duplicate if Apps Script fires twice
        const dup = await db.query(
            `SELECT id FROM participants
             WHERE intake_source='google_form_webhook'
               AND full_name = $1
               AND (email = $2 OR (email IS NULL AND $2 IS NULL))
               AND ABS(EXTRACT(EPOCH FROM (intake_date - NOW()))) < 300
             LIMIT 1`,
            [coerced.full_name, coerced.email]);
        if (dup.rowCount) {
            logger.info('Intake webhook duplicate suppressed', {
                existing: dup.rows[0].id, full_name: coerced.full_name,
            });
            return res.json({ success: true, participant_id: dup.rows[0].id, duplicate: true });
        }

        const insert = await db.query(`
            INSERT INTO participants (
                full_name, email, date_of_birth, birthplace,
                address_line1, address_city, address_state, address_zip,
                annual_income, estimated_net_worth, real_estate_equity,
                inheritance_received, inheritance_expected, tax_filing_status, num_dependents,
                self_fs_id, self_is_living,
                roles, intake_source, intake_date,
                consent_research, consent_income, consent_negative, consent_blockchain,
                notes
            ) VALUES (
                $1, $2, $3, $4,
                $5, $6, $7, $8,
                $9, $10, $11,
                $12, $13, $14, $15,
                $16, $17,
                $18::text[], $19, NOW(),
                $20, $21, $22, $23,
                $24
            )
            RETURNING id
        `, [
            coerced.full_name, coerced.email, coerced.date_of_birth, coerced.birthplace,
            coerced.address_line1, coerced.address_city, coerced.address_state, coerced.address_zip,
            coerced.annual_income, coerced.estimated_net_worth, coerced.real_estate_equity,
            coerced.inheritance_received, coerced.inheritance_expected, coerced.tax_filing_status, coerced.num_dependents,
            coerced.self_fs_id, coerced.self_is_living,
            ['intake_pending_review'], 'google_form_webhook',
            coerced.consent_research, coerced.consent_income, coerced.consent_negative, coerced.consent_blockchain,
            `Intake via webhook at ${payload.submitted_at || new Date().toISOString()}. ` +
            `Wealth fingerprint: trust=${p.trust_beneficiary || '?'} business=${p.family_business_ownership || '?'} land50ac=${p.inherited_land_50_acres || '?'} pre1865=${p.pre_1865_business || '?'} corp=${p.corporate_connections || '?'}. ` +
            (p.additional_notes ? `Additional: ${String(p.additional_notes).slice(0, 500)}` : ''),
        ]);
        const participantId = insert.rows[0].id;

        // Family rows
        for (const relation of FAMILY_ROLES) {
            const f = family[relation];
            if (!f || (!f.name && !f.fs_id)) continue;
            await db.query(`
                INSERT INTO participant_family (
                    participant_id, relationship, full_name, birth_year, birthplace, fs_id, is_living
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT DO NOTHING
            `, [
                participantId, relation,
                f.name || null, f.birth_year || null, f.birthplace || null,
                f.fs_id || null, f.is_living,
            ]).catch(e => logger.warn('participant_family insert failed', { e: e.message, relation }));
        }

        logger.info('Intake webhook accepted', {
            participant_id: participantId,
            full_name: coerced.full_name,
            self_fs_id: coerced.self_fs_id,
            has_all_grandparents: FAMILY_ROLES.slice(2).every(r => family[r]?.fs_id),
        });

        res.json({
            success: true,
            participant_id: participantId,
            message: 'Intake received. Awaiting human review at /review.',
        });
    } catch (e) {
        logger.error('Intake webhook DB error', { error: e.message, stack: e.stack });
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/intake/health
router.get('/health', (req, res) => {
    res.json({ success: true, service: 'intake-webhook', time: new Date().toISOString() });
});

module.exports = router;
