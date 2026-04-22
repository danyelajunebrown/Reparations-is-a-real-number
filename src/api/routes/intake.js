/**
 * Intake webhook endpoint — receives Google Forms submissions via the
 * Apps Script that fires on each form-submit event. Minimal validation
 * at ingest; full validation + ancestor climb kicks off via /review UI
 * once a curator confirms the submission looks legitimate.
 *
 * Flow:
 *   Google Form submit → Google Sheet row appended → Apps Script trigger
 *     → POST https://<public-url>/api/intake/submit with JSON body
 *     → this handler verifies X-Webhook-Secret, inserts into participants
 *       + participant_family, creates a review-queue entry, returns 200
 *
 * Env:
 *   INTAKE_WEBHOOK_SECRET — required; must match Apps Script header
 */

const express = require('express');
const router = express.Router();
const db = require('../../database/connection');
const logger = require('../../utils/logger');

// Column-header aliases the form might use. Maps variants to canonical
// participants table columns.
const HEADER_ALIASES = {
    // Core identity
    'full name':               'full_name',
    'full_name':               'full_name',
    'name':                    'full_name',
    'email':                   'email',
    'email address':           'email',
    'date of birth':           'date_of_birth',
    'date_of_birth':           'date_of_birth',
    'dob':                     'date_of_birth',
    'birthplace':              'birthplace',
    'birth place':             'birthplace',
    'place of birth':          'birthplace',
    'address':                 'address_line1',
    'address_street':          'address_line1',
    'street address':          'address_line1',
    'city':                    'address_city',
    'address_city':            'address_city',
    'state':                   'address_state',
    'address_state':           'address_state',
    'zip':                     'address_zip',
    'zip code':                'address_zip',
    'address_zip':             'address_zip',

    // Financial
    'annual_income':           'annual_income',
    'annual income':           'annual_income',
    'estimated_net_worth':     'estimated_net_worth',
    'estimated net worth':     'estimated_net_worth',
    'net worth':               'estimated_net_worth',
    'real_estate_equity':      'real_estate_equity',
    'real estate equity':      'real_estate_equity',
    'inheritance_received':    'inheritance_received',
    'inheritance received':    'inheritance_received',
    'inheritance_expected':    'inheritance_expected',
    'inheritance expected':    'inheritance_expected',
    'tax_filing_status':       'tax_filing_status',
    'tax filing status':       'tax_filing_status',
    'num_dependents':          'num_dependents',
    'number of dependents':    'num_dependents',

    // Genealogy
    'self_fs_id':              'self_fs_id',
    'self fs id':              'self_fs_id',
    'your familysearch id':    'self_fs_id',
    'self_is_living':          'self_is_living',

    // Wallet
    'wallet':                  'wallet_address',
    'wallet address':          'wallet_address',
    'wallet_address':          'wallet_address',

    // Consent
    'consent_research':        'consent_research',
    'consent_income':          'consent_income',
    'consent_negative':        'consent_negative',
    'consent_blockchain':      'consent_blockchain',
};

// Family-member fields go into participant_family table
const FAMILY_PREFIXES = [
    { prefix: 'father_',            relation: 'father' },
    { prefix: 'mother_',            relation: 'mother' },
    { prefix: 'pat_grandfather_',   relation: 'paternal_grandfather' },
    { prefix: 'pat_grandmother_',   relation: 'paternal_grandmother' },
    { prefix: 'mat_grandfather_',   relation: 'maternal_grandfather' },
    { prefix: 'mat_grandmother_',   relation: 'maternal_grandmother' },
];

function normalizeKey(k) {
    return String(k || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[?:]$/, '');
}

function parseBool(v) {
    if (typeof v === 'boolean') return v;
    const s = String(v || '').toLowerCase().trim();
    return /^(yes|true|y|agree|1)$/i.test(s);
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
    const row = payload.row || {};

    // Normalize keys and map to participants columns
    const participant = {};
    const family = {};

    for (const [rawKey, val] of Object.entries(row)) {
        if (val == null || val === '') continue;
        const key = normalizeKey(rawKey);

        // Try alias
        const canon = HEADER_ALIASES[key];
        if (canon) {
            participant[canon] = val;
            continue;
        }

        // Try family-member mapping
        for (const { prefix, relation } of FAMILY_PREFIXES) {
            if (!key.startsWith(prefix.replace(/_/g, ' ')) && !key.startsWith(prefix)) continue;
            const suffix = key.replace(/^[^_]+_/, '').replace(/^(pat|mat) grandfather /, '').replace(/^(pat|mat) grandmother /, '').replace(/^father /, '').replace(/^mother /, '');
            family[relation] = family[relation] || {};
            if (suffix.includes('fs id') || suffix === 'fs_id') family[relation].fs_id = val;
            else if (suffix.includes('name')) family[relation].name = val;
            else if (suffix.includes('birth year')) family[relation].birth_year = parseNum(val);
            else if (suffix.includes('birthplace') || suffix.includes('birth place')) family[relation].birthplace = val;
            else if (suffix.includes('is living') || suffix.includes('is_living')) family[relation].is_living = parseBool(val);
        }
    }

    // Coerce types for participant columns
    const coerced = {
        full_name:          participant.full_name ? String(participant.full_name).trim() : null,
        email:              participant.email ? String(participant.email).trim().toLowerCase() : null,
        date_of_birth:      parseDate(participant.date_of_birth),
        birthplace:         participant.birthplace || null,
        address_line1:      participant.address_line1 || null,
        address_city:       participant.address_city || null,
        address_state:      participant.address_state || null,
        address_zip:        participant.address_zip || null,
        annual_income:      parseNum(participant.annual_income),
        estimated_net_worth: parseNum(participant.estimated_net_worth),
        real_estate_equity: parseNum(participant.real_estate_equity),
        inheritance_received: parseNum(participant.inheritance_received),
        inheritance_expected: parseNum(participant.inheritance_expected),
        tax_filing_status:  participant.tax_filing_status || null,
        num_dependents:     parseNum(participant.num_dependents),
        wallet_address:     participant.wallet_address || null,
        self_fs_id:         participant.self_fs_id ? String(participant.self_fs_id).trim().toUpperCase() : null,
        self_is_living:     participant.self_is_living == null ? true : parseBool(participant.self_is_living),
        consent_research:   parseBool(participant.consent_research),
        consent_income:     parseBool(participant.consent_income),
        consent_negative:   parseBool(participant.consent_negative),
        consent_blockchain: parseBool(participant.consent_blockchain),
    };

    if (!coerced.full_name) {
        return res.status(400).json({ success: false, error: 'full_name required' });
    }

    try {
        // Insert participant
        const insert = await db.query(`
            INSERT INTO participants (
                full_name, email, date_of_birth, birthplace,
                address_line1, address_city, address_state, address_zip,
                annual_income, estimated_net_worth, real_estate_equity,
                inheritance_received, inheritance_expected, tax_filing_status, num_dependents,
                wallet_address, self_fs_id, self_is_living,
                roles, intake_source, intake_date,
                consent_research, consent_income, consent_negative, consent_blockchain,
                notes
            ) VALUES (
                $1, $2, $3, $4,
                $5, $6, $7, $8,
                $9, $10, $11,
                $12, $13, $14, $15,
                $16, $17, $18,
                $19::text[], $20, NOW(),
                $21, $22, $23, $24,
                $25
            )
            RETURNING id
        `, [
            coerced.full_name, coerced.email, coerced.date_of_birth, coerced.birthplace,
            coerced.address_line1, coerced.address_city, coerced.address_state, coerced.address_zip,
            coerced.annual_income, coerced.estimated_net_worth, coerced.real_estate_equity,
            coerced.inheritance_received, coerced.inheritance_expected, coerced.tax_filing_status, coerced.num_dependents,
            coerced.wallet_address, coerced.self_fs_id, coerced.self_is_living,
            ['intake_pending_review'], 'google_form_webhook',
            coerced.consent_research, coerced.consent_income, coerced.consent_negative, coerced.consent_blockchain,
            `Intake via webhook at ${payload.submitted_at || new Date().toISOString()}. ` +
            `Raw row keys: ${Object.keys(row).slice(0, 30).join(', ')}.`,
        ]);
        const participantId = insert.rows[0].id;

        // Insert family rows
        for (const [relation, info] of Object.entries(family)) {
            if (!info.name && !info.fs_id) continue;
            await db.query(`
                INSERT INTO participant_family (
                    participant_id, relation, full_name, birth_year, birthplace, fs_id, is_living
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT DO NOTHING
            `, [
                participantId, relation,
                info.name || null,
                info.birth_year || null,
                info.birthplace || null,
                info.fs_id ? String(info.fs_id).trim().toUpperCase() : null,
                info.is_living == null ? null : info.is_living,
            ]).catch(e => {
                logger.warn('participant_family insert skipped', { e: e.message, relation });
            });
        }

        logger.info('Intake webhook accepted', {
            participant_id: participantId,
            full_name: coerced.full_name,
            self_fs_id: coerced.self_fs_id,
        });

        res.json({
            success: true,
            participant_id: participantId,
            message: 'Intake received. Awaiting human review.',
        });
    } catch (e) {
        logger.error('Intake webhook DB error', { error: e.message, stack: e.stack });
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/intake/health — simple ping so you can verify the tunnel + endpoint from a browser
router.get('/health', (req, res) => {
    res.json({ success: true, service: 'intake-webhook', time: new Date().toISOString() });
});

module.exports = router;
