/**
 * Ops notification helper. Posts to ntfy.sh (or any webhook set in
 * OPS_NOTIFY_WEBHOOK). Used by scrapers, watchdogs, DAA generator, etc.
 *
 * Fails silent — notifications are observability, not business logic.
 * Don't break pipelines if ntfy is unreachable.
 *
 * Usage:
 *   const { notify } = require('./utils/notify');
 *   await notify('freedmens-remaining crashed on Savannah R8', { severity: 'error', tags: ['scraper'] });
 */

const os = require('os');

const DEFAULT_URL = process.env.OPS_NOTIFY_WEBHOOK || '';

const PRIORITY_FOR = {
    debug: 1,
    info: 3,
    warn: 4,
    error: 5,
    critical: 5,
};

const EMOJI_FOR = {
    debug: '🔍',
    info: 'ℹ️',
    warn: '⚠️',
    error: '❌',
    critical: '🚨',
};

async function notify(message, opts = {}) {
    const severity = opts.severity || 'info';
    const tags = opts.tags || [];
    const url = opts.url || DEFAULT_URL;
    if (!url) return { skipped: 'no webhook' };

    // ntfy title/tags headers must be ASCII — no emojis in headers.
    const title = `[${os.hostname()}] ${opts.title || severity.toUpperCase()}`;
    const priority = PRIORITY_FOR[severity] || 3;
    const emoji = EMOJI_FOR[severity] || '';
    const body = emoji ? `${emoji} ${message}` : String(message);

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Title': title,
                'Priority': String(priority),
                'Tags': tags.join(','),
            },
            body,
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return { ok: false, status: res.status };
        return { ok: true };
    } catch (e) {
        // Never throw — observability must not break callers.
        return { ok: false, error: e.message };
    }
}

module.exports = { notify };
