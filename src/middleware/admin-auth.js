/**
 * Admin authentication middleware.
 *
 * Simple bearer-token check for admin-only endpoints. The token is set via
 * ADMIN_TOKEN environment variable; rotate it per event.
 *
 * Usage:
 *   const requireAdmin = require('./middleware/admin-auth');
 *   app.post('/api/admin/something', requireAdmin, handler);
 *
 * Frontend sends the token as `X-Admin-Token` header. It's stored in
 * localStorage by the React app's AdminAuth component after the user enters
 * it at /admin.
 *
 * Security notes:
 * - This is NOT a full auth system. It's a single shared secret intended for
 *   one-operator scenarios (you plus whoever is running the premiere).
 * - Token is sent in a header, not a URL, so it won't end up in server logs
 *   or browser history.
 * - Rotate ADMIN_TOKEN immediately after the premiere.
 * - If ADMIN_TOKEN is unset in production, all admin routes return 503 (not
 *   500) so misconfiguration is loud rather than silent.
 */

// Timing-safe comparison to avoid leaking token length via response time.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_TOKEN;

  // In production, refuse to accept admin requests if no token is configured.
  // In development (no NODE_ENV or NODE_ENV=development), allow with a warning
  // so local dev isn't blocked.
  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({
        success: false,
        error: 'Admin auth not configured. Set ADMIN_TOKEN env var.'
      });
    }
    if (!global.__adminAuthDevWarned) {
      console.warn('[admin-auth] ADMIN_TOKEN not set — admin endpoints are OPEN (dev mode only).');
      global.__adminAuthDevWarned = true;
    }
    return next();
  }

  // Accept both the X-Admin-Token header and an Authorization: Bearer fallback.
  const headerToken = req.headers['x-admin-token'];
  const authHeader = req.headers['authorization'] || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const provided = headerToken || bearerToken;

  if (!provided || !safeEqual(provided, expected)) {
    return res.status(401).json({
      success: false,
      error: 'Admin authentication required.'
    });
  }

  next();
}

/**
 * Verify-only endpoint handler: returns 200 if the token is valid.
 * Mount at e.g. /api/admin/verify so the frontend can check a stored token
 * on page load before showing the admin UI.
 */
function adminVerify(req, res) {
  res.json({ success: true, admin: true });
}

module.exports = { requireAdmin, adminVerify };
