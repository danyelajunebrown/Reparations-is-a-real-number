#!/usr/bin/env node
/**
 * debug-doc-pipeline.js
 *
 * Rigorous end-to-end document serving diagnostic.
 * Tests every layer: DB → API → presigned URL → actual S3 bytes.
 *
 * Usage:
 *   node scripts/debug-doc-pipeline.js
 *   node scripts/debug-doc-pipeline.js --limit 20
 *   node scripts/debug-doc-pipeline.js --table person_documents --limit 50
 *   node scripts/debug-doc-pipeline.js --id james-hopewell-will-1817
 *
 * Requires: DATABASE_URL and AWS_ACCESS_KEY_ID/SECRET in .env
 * The API tests hit the LIVE Render backend (reparations-platform.onrender.com)
 */

require('dotenv').config({ override: true });
const https = require('https');
const http = require('http');
const { Pool } = require('pg');
const { S3Client, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// ── Config ────────────────────────────────────────────────────────────────────

const API_BASE = process.env.API_BASE_URL || 'https://reparations-platform.onrender.com';
const S3_BUCKET = process.env.S3_BUCKET || 'reparations-them';
const S3_REGION = process.env.S3_REGION || 'us-east-2';
const AWS_KEY = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET = process.env.AWS_SECRET_ACCESS_KEY;

const args = process.argv.slice(2);
const argMap = {};
for (let i = 0; i < args.length; i += 2) {
  argMap[args[i].replace('--', '')] = args[i + 1] || true;
}
const LIMIT = parseInt(argMap.limit) || 10;
const FILTER_TABLE = argMap.table || null;  // 'documents' | 'person_documents'
const FILTER_ID = argMap.id || null;

// ── Helpers ───────────────────────────────────────────────────────────────────

const COL_RESET = '\x1b[0m';
const COL_GREEN = '\x1b[32m';
const COL_RED = '\x1b[31m';
const COL_YELLOW = '\x1b[33m';
const COL_DIM = '\x1b[2m';
const COL_BOLD = '\x1b[1m';

function pass(s) { return `${COL_GREEN}✓ ${s}${COL_RESET}`; }
function fail(s) { return `${COL_RED}✗ ${s}${COL_RESET}`; }
function warn(s) { return `${COL_YELLOW}⚠ ${s}${COL_RESET}`; }
function dim(s)  { return `${COL_DIM}${s}${COL_RESET}`; }
function bold(s) { return `${COL_BOLD}${s}${COL_RESET}`; }

function httpGet(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        // Only grab first 1KB to detect content type
        if (body.length < 1024) body += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          location: res.headers?.location || null,
          body: body.slice(0, 512),
          ok: res.statusCode >= 200 && res.statusCode < 300
        });
      });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message, ok: false }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, error: 'timeout', ok: false });
    });
    req.setTimeout(timeoutMs);
  });
}

// ── S3 client (local credentials) ────────────────────────────────────────────

let s3Client = null;
if (AWS_KEY && AWS_SECRET) {
  s3Client = new S3Client({
    region: S3_REGION,
    credentials: { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET },
    followRegionRedirects: true
  });
}

async function tryHeadObject(key) {
  if (!s3Client) return { ok: false, error: 'no local AWS credentials' };
  try {
    const cmd = new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key });
    const r = await s3Client.send(cmd);
    return { ok: true, contentType: r.ContentType, size: r.ContentLength };
  } catch (e) {
    return { ok: false, error: e.message || e.name };
  }
}

async function tryPresignedGet(key) {
  if (!s3Client) return { ok: false, error: 'no local AWS credentials', url: null };
  try {
    const cmd = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ResponseContentDisposition: 'inline'
    });
    const url = await getSignedUrl(s3Client, cmd, { expiresIn: 120 });
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: e.message || e.name, url: null };
  }
}

async function testPresignedUrl(url) {
  if (!url) return { ok: false, status: 0, error: 'no url' };

  // Follow redirects (up to 5 hops) and record the chain
  let currentUrl = url;
  const chain = [];
  for (let hop = 0; hop < 5; hop++) {
    const r = await httpGet(currentUrl, 12000);
    chain.push({ hop, url: currentUrl.slice(0, 120), status: r.status });
    if ((r.status === 301 || r.status === 302 || r.status === 307 || r.status === 308) && r.location) {
      currentUrl = r.location;
      continue;
    }
    const isFile = r.headers?.['content-type'] && (
      r.headers['content-type'].includes('pdf') ||
      r.headers['content-type'].includes('image') ||
      r.headers['content-type'].includes('octet-stream')
    );

    // Extract S3 error code from XML body for actionable diagnosis
    let s3ErrorCode = null;
    if (!r.ok && r.body) {
      const codeMatch = r.body.match(/<Code>([^<]+)<\/Code>/);
      const msgMatch  = r.body.match(/<Message>([^<]+)<\/Message>/);
      if (codeMatch) s3ErrorCode = codeMatch[1] + (msgMatch ? ': ' + msgMatch[1] : '');
    }

    return {
      ok: r.ok && isFile,
      status: r.status,
      contentType: r.headers?.['content-type'] || '?',
      error: s3ErrorCode || r.error || (r.ok && !isFile ? `got HTML/error body (${r.body?.slice(0,120)})` : null),
      redirectChain: chain.length > 1 ? chain : null,
      finalUrl: currentUrl.slice(0, 160)
    };
  }
  return { ok: false, status: 0, error: 'too many redirects', redirectChain: chain };
}

// ── API test (via Render) ─────────────────────────────────────────────────────

async function testApiAccess(docId) {
  const url = `${API_BASE}/api/documents/${encodeURIComponent(docId)}/access`;
  const r = await httpGet(url, 15000);
  if (!r.ok) return { ok: false, status: r.status, error: r.error || r.body?.slice(0,200) };
  try {
    const json = JSON.parse(r.body + ''); // may be truncated but viewUrl should be near start
    // Try fetching full body if viewUrl not found
    if (!json.viewUrl) {
      return { ok: false, status: r.status, error: `API error: ${json.error || JSON.stringify(json).slice(0,200)}`, apiJson: json };
    }
    return { ok: true, status: r.status, viewUrl: json.viewUrl, downloadUrl: json.downloadUrl, storageType: json.storageType };
  } catch (e) {
    return { ok: false, status: r.status, error: `JSON parse failed: ${r.body?.slice(0,100)}` };
  }
}

async function testApiAccessFull(docId) {
  // Need full body for viewUrl — make a proper full request
  return new Promise((resolve) => {
    const urlObj = new URL(`${API_BASE}/api/documents/${encodeURIComponent(docId)}/access`);
    const lib = urlObj.protocol === 'https:' ? https : http;
    const req = lib.get({ host: urlObj.hostname, path: urlObj.pathname, timeout: 15000 }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.success && json.viewUrl) {
            resolve({ ok: true, status: res.statusCode, viewUrl: json.viewUrl, downloadUrl: json.downloadUrl, storageType: json.storageType });
          } else {
            resolve({ ok: false, status: res.statusCode, error: `${json.error}: ${json.message}`, apiJson: json });
          }
        } catch (e) {
          resolve({ ok: false, status: res.statusCode, error: `parse error: ${body.slice(0,100)}` });
        }
      });
    });
    req.on('error', (e) => resolve({ ok: false, status: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, error: 'timeout' }); });
    req.setTimeout(15000);
  });
}

// ── DB queries ────────────────────────────────────────────────────────────────

async function getDocumentsRows(pool, limit) {
  const r = await pool.query(`
    SELECT
      document_id AS id,
      'documents' AS table_source,
      file_path AS s3_key,
      doc_type,
      filename,
      owner_name
    FROM documents
    WHERE file_path IS NOT NULL
    LIMIT $1
  `, [limit]);
  return r.rows;
}

async function getPersonDocumentsRows(pool, limit) {
  const r = await pool.query(`
    SELECT
      id::text AS id,
      'person_documents' AS table_source,
      s3_key,
      document_type AS doc_type,
      page_reference AS filename,
      name_as_appears AS owner_name
    FROM person_documents
    WHERE s3_key IS NOT NULL AND s3_key != ''
    LIMIT $1
  `, [limit]);
  return r.rows;
}

async function getPersonDocumentsNullS3(pool) {
  const r = await pool.query(`
    SELECT COUNT(*) AS total, COUNT(s3_key) AS with_s3key
    FROM person_documents
  `);
  return r.rows[0];
}

async function getSingleDoc(pool, id) {
  // Try documents table first
  try {
    const r1 = await pool.query(`SELECT document_id AS id, 'documents' AS table_source, file_path AS s3_key, doc_type, filename, owner_name FROM documents WHERE document_id = $1`, [id]);
    if (r1.rows.length > 0) return r1.rows[0];
  } catch (e) {}
  // Try person_documents
  const intId = parseInt(id, 10);
  if (!isNaN(intId)) {
    const r2 = await pool.query(`SELECT id::text AS id, 'person_documents' AS table_source, s3_key, document_type AS doc_type, page_reference AS filename, name_as_appears AS owner_name FROM person_documents WHERE id = $1`, [intId]);
    if (r2.rows.length > 0) return r2.rows[0];
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function runTest(row) {
  const result = {
    id: row.id,
    table: row.table_source,
    doc_type: row.doc_type || '?',
    owner: (row.owner_name || '?').slice(0, 30),
    s3_key: row.s3_key || null,
    head_ok: null,
    presign_local_ok: null,
    api_ok: null,
    s3_bytes_ok: null,
    final: null
  };

  // Layer 1: Is s3_key present?
  if (!row.s3_key) {
    result.final = 'NO_S3_KEY';
    return result;
  }

  // Layer 2: HeadObject with local credentials
  const headResult = await tryHeadObject(row.s3_key);
  result.head_ok = headResult.ok;
  result.head_detail = headResult.ok ? `${headResult.contentType} ${headResult.size}b` : headResult.error;

  // Layer 3: Presigned URL generation with local credentials
  const presignResult = await tryPresignedGet(row.s3_key);
  result.presign_local_ok = presignResult.ok;
  result.presign_error = presignResult.error;

  // Layer 4: Test the presigned URL actually returns bytes
  if (presignResult.ok && presignResult.url) {
    const bytesResult = await testPresignedUrl(presignResult.url);
    result.s3_bytes_ok = bytesResult.ok;
    result.s3_bytes_status = bytesResult.status;
    result.s3_bytes_ct = bytesResult.contentType;
    result.s3_bytes_error = bytesResult.error;
  }

  // Layer 5: Test via Render API (what the frontend actually calls)
  const apiResult = await testApiAccessFull(row.id);
  result.api_ok = apiResult.ok;
  result.api_status = apiResult.status;
  result.api_error = apiResult.error;
  result.api_viewUrl = apiResult.viewUrl || null;
  result.api_storageType = apiResult.storageType;

  // Layer 6: If API returned a viewUrl, test THAT URL (what the iframe loads)
  if (apiResult.ok && apiResult.viewUrl) {
    const iframeResult = await testPresignedUrl(apiResult.viewUrl);
    result.iframe_ok = iframeResult.ok;
    result.iframe_status = iframeResult.status;
    result.iframe_ct = iframeResult.contentType;
    result.iframe_error = iframeResult.error;
    result.iframe_redirect_chain = iframeResult.redirectChain;
    result.iframe_final_url = iframeResult.finalUrl;
  }

  // Determine final status
  if (result.iframe_ok) result.final = 'FULLY_WORKING';
  else if (result.api_ok && !result.iframe_ok) result.final = 'PRESIGNED_URL_FAILS';
  else if (result.presign_local_ok && !result.api_ok) result.final = 'RENDER_CRED_FAIL';
  else if (result.head_ok && !result.presign_local_ok) result.final = 'PRESIGN_GEN_FAIL';
  else if (!result.head_ok) result.final = 'OBJECT_MISSING_OR_CREDS_BAD';
  else result.final = 'UNKNOWN';

  return result;
}

function printRow(r) {
  const status = {
    FULLY_WORKING: pass('WORKING'),
    PRESIGNED_URL_FAILS: fail('PRESIGNED_URL_FAILS'),
    RENDER_CRED_FAIL: fail('RENDER_CREDS_BAD'),
    PRESIGN_GEN_FAIL: fail('PRESIGN_GEN_FAIL'),
    OBJECT_MISSING_OR_CREDS_BAD: fail('OBJECT_MISSING_OR_LOCAL_CREDS'),
    NO_S3_KEY: warn('NO_S3_KEY'),
    UNKNOWN: warn('UNKNOWN')
  }[r.final] || warn(r.final);

  console.log(`\n${bold(r.id)} ${dim(`[${r.table}]`)}`);
  console.log(`  Owner: ${r.owner} | Type: ${r.doc_type}`);
  console.log(`  S3 key: ${r.s3_key ? dim(r.s3_key) : fail('NULL')}`);
  console.log(`  HeadObject (local):     ${r.head_ok === null ? dim('skip') : r.head_ok ? pass('200') + dim(` ${r.head_detail}`) : fail(r.head_detail)}`);
  console.log(`  Presign (local creds):  ${r.presign_local_ok === null ? dim('skip') : r.presign_local_ok ? pass('generated') : fail(r.presign_error)}`);
  console.log(`  S3 bytes (local sign):  ${r.s3_bytes_ok === undefined ? dim('skip') : r.s3_bytes_ok ? pass(`HTTP ${r.s3_bytes_status} ${r.s3_bytes_ct}`) : fail(`HTTP ${r.s3_bytes_status}: ${r.s3_bytes_error}`)}`);
  console.log(`  Render /access API:     ${r.api_ok === null ? dim('skip') : r.api_ok ? pass(`HTTP ${r.api_status}`) : fail(`HTTP ${r.api_status}: ${r.api_error}`)}`);
  if (r.api_viewUrl) {
    // Parse just the host+path prefix for diagnosis (strip query string)
    let urlDiag = r.api_viewUrl;
    try { urlDiag = new URL(r.api_viewUrl).host + new URL(r.api_viewUrl).pathname.slice(0,60); } catch(e) {}
    console.log(`  Render presigned host:  ${dim(urlDiag)}`);
  }
  if (r.iframe_ok !== undefined) {
    console.log(`  Iframe URL fetch:       ${r.iframe_ok ? pass(`HTTP ${r.iframe_status} ${r.iframe_ct}`) : fail(`HTTP ${r.iframe_status}: ${r.iframe_error}`)}`);
    if (r.iframe_redirect_chain) {
      for (const h of r.iframe_redirect_chain) {
        try {
          const u = new URL(h.url);
          console.log(`    ${dim(`hop${h.hop}: HTTP ${h.status} → ${u.host}${u.pathname.slice(0,50)}`)}`);
        } catch(e) {
          console.log(`    ${dim(`hop${h.hop}: HTTP ${h.status} → ${h.url.slice(0,80)}`)}`);
        }
      }
    }
  }
  console.log(`  ► Final verdict: ${status}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(bold('\n═══════════════════════════════════════════════════════'));
  console.log(bold(' Document Pipeline Debug — End-to-End Truth Table'));
  console.log(bold('═══════════════════════════════════════════════════════'));
  console.log(dim(`  API base:  ${API_BASE}`));
  console.log(dim(`  S3 bucket: ${S3_BUCKET} (${S3_REGION})`));
  console.log(dim(`  Local AWS: ${AWS_KEY ? pass('credentials present') : fail('NO AWS_ACCESS_KEY_ID in env')}`));
  console.log();

  // DB connection
  if (!process.env.DATABASE_URL) {
    console.error(fail('DATABASE_URL not set — cannot query DB'));
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  try {
    await pool.query('SELECT 1');
    console.log(pass('DB connection OK'));
  } catch (e) {
    console.error(fail(`DB connection failed: ${e.message}`));
    process.exit(1);
  }

  // Summary stats
  const stats = await getPersonDocumentsNullS3(pool);
  const total = parseInt(stats.total);
  const withKey = parseInt(stats.with_s3key);
  const noKey = total - withKey;
  console.log(`\n${bold('person_documents:')} ${total} total | ${pass(withKey + ' with s3_key')} | ${noKey > 0 ? warn(noKey + ' missing s3_key') : pass('0 missing')}`);

  const docsCount = await pool.query(`SELECT COUNT(*) FROM documents`);
  console.log(`${bold('documents table:')} ${docsCount.rows[0].count} total`);

  // Collect rows to test
  let rows = [];
  if (FILTER_ID) {
    const row = await getSingleDoc(pool, FILTER_ID);
    if (!row) {
      console.error(fail(`\nDocument ID '${FILTER_ID}' not found in either table`));
      await pool.end();
      process.exit(1);
    }
    rows = [row];
  } else {
    if (!FILTER_TABLE || FILTER_TABLE === 'documents') {
      const docRows = await getDocumentsRows(pool, LIMIT);
      rows.push(...docRows);
      console.log(dim(`\nSampling ${docRows.length} rows from 'documents' table`));
    }
    if (!FILTER_TABLE || FILTER_TABLE === 'person_documents') {
      const pdRows = await getPersonDocumentsRows(pool, LIMIT);
      rows.push(...pdRows);
      console.log(dim(`Sampling ${pdRows.length} rows from 'person_documents' table`));
    }
  }

  if (rows.length === 0) {
    console.log(warn('\nNo rows found to test. Check table contents.'));
    await pool.end();
    return;
  }

  console.log(bold(`\nTesting ${rows.length} documents...\n`));

  // Run tests
  const results = [];
  for (const row of rows) {
    const r = await runTest(row);
    printRow(r);
    results.push(r);
  }

  await pool.end();

  // Summary
  const counts = {};
  for (const r of results) counts[r.final] = (counts[r.final] || 0) + 1;

  console.log(bold('\n\n═══════════════════ SUMMARY ═══════════════════'));
  for (const [status, count] of Object.entries(counts)) {
    const label = status === 'FULLY_WORKING'
      ? pass(`FULLY_WORKING: ${count}`)
      : status === 'NO_S3_KEY'
        ? warn(`NO_S3_KEY (never uploaded to S3): ${count}`)
        : fail(`${status}: ${count}`);
    console.log(`  ${label}`);
  }
  console.log(bold('═══════════════════════════════════════════════\n'));

  if (counts['RENDER_CRED_FAIL'] > 0) {
    console.log(warn('ACTION: Render AWS credentials are wrong — update in Render Dashboard env vars'));
  }
  if (counts['OBJECT_MISSING_OR_CREDS_BAD'] > 0 && AWS_KEY) {
    console.log(warn('ACTION: Some S3 objects are missing — run backfill-freedmens-to-s3.js'));
  }
  if (counts['NO_S3_KEY'] > 0) {
    console.log(warn('ACTION: Some person_documents rows have null s3_key — run backfill script'));
  }
  if (counts['PRESIGNED_URL_FAILS'] > 0) {
    console.log(warn('ACTION: Presigned URL generated but S3 returns error — check bucket CORS policy'));
  }
  if (counts['FULLY_WORKING'] > 0) {
    console.log(pass(`${counts['FULLY_WORKING']} documents are fully working end-to-end`));
  }
}

main().catch((e) => {
  console.error(fail(`Fatal: ${e.message}`));
  console.error(e.stack);
  process.exit(1);
});
