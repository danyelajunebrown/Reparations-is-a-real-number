// verify-deploy.mjs — post-publish gate. Waits for GitHub Pages to propagate the
// bundle we just built (matches dist/version.json SHA against the live version.json),
// then runs the route smoke test against the deployed site. Fails loudly if the live
// bundle is broken. Chained after `gh-pages` in deploy:gh-pages.
//
// It's a post-publish ALARM (the push already happened; it can't un-publish) — but it
// tests the REAL deployed artifact incl. GH-Pages SPA routing, and tells you to
// redeploy/fix within a couple minutes instead of finding out from a user.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = (process.env.BASE_URL || 'https://danyelajunebrown.github.io/Reparations-is-a-real-number').replace(/\/+$/, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  let expected;
  try {
    expected = JSON.parse(readFileSync(join(HERE, '..', 'frontend', 'dist', 'version.json'), 'utf8')).sha;
  } catch (e) {
    console.error('verify-deploy: cannot read frontend/dist/version.json — build first.', e.message);
    process.exit(2);
  }
  console.log(`verify-deploy: waiting for GitHub Pages to serve build ${expected} …`);

  const TRIES = 24, INTERVAL = 15000; // ~6 min
  let live = null;
  for (let i = 0; i < TRIES; i++) {
    try {
      const r = await fetch(`${SITE}/version.json`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const j = await r.json().catch(() => null);
      live = j?.sha;
      if (live === expected) { console.log(`verify-deploy: live SHA ${live} matches (after ${i * INTERVAL / 1000}s).`); break; }
    } catch { /* CDN warming */ }
    if (i < TRIES - 1) await sleep(INTERVAL);
  }
  if (live !== expected) {
    console.error(`verify-deploy: timed out — live SHA is ${live ?? 'unknown'}, expected ${expected}. Skipping smoke test (propagation slow); run it manually once live.`);
    process.exit(1);
  }

  console.log('verify-deploy: running route smoke test against the deployed bundle…\n');
  try {
    // Quote the path — the repo path contains a space ("danyelajunebrown GITHUB").
    execSync(`node "${join(HERE, 'smoke-test-frontend.mjs')}"`, { stdio: 'inherit', env: { ...process.env, BASE_URL: SITE } });
    console.log('\nverify-deploy: ✅ deploy verified.');
  } catch {
    console.error('\nverify-deploy: ❌ smoke test FAILED on the live bundle — fix and redeploy.');
    process.exit(1);
  }
}

main().catch(e => { console.error('verify-deploy FATAL', e); process.exit(2); });
