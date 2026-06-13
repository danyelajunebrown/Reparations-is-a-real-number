#!/usr/bin/env node
/**
 * Fail-closed test for the Internet Archive PII allowlist gate.
 * Run: node tests/unit/test-archival-gate.mjs   (exit 0 = all pass, 1 = any fail)
 *
 * The gate is a one-way door (IA is world-readable, resists deletion). These
 * tests assert it DENIES BY DEFAULT and only ALLOWS unambiguously-historical,
 * PII-free records — and that the upload path itself enforces the gate.
 */
import { checkArchivable } from '../../src/services/archival/allowlist.mjs';
import { uploadHistoricalDocument } from '../../src/services/archival/ia-archive.mjs';

let pass = 0, fail = 0;
function expect(label, record, wantAllowed) {
  const r = checkArchivable(record);
  const ok = r.allowed === wantAllowed;
  if (ok) { pass++; } else { fail++; console.log(`  ✗ ${label}\n     wanted allowed=${wantAllowed} got ${r.allowed} (${r.reason})`); }
}

// ── MUST DENY (fail closed) ──
expect('null record', null, false);
expect('non-object', 'a string', false);
expect('empty object (no sourceTable)', {}, false);
expect('denylisted: participants', { sourceTable: 'participants', personType: 'enslaved', deathYear: 1880 }, false);
expect('denylisted: daa_instruments', { sourceTable: 'daa_instruments', documentType: 'will', documentYear: 1850 }, false);
expect('denylisted: wealth_fingerprint', { sourceTable: 'wealth_fingerprint' }, false);
expect('PII field: email', { sourceTable: 'person_documents', documentType: 'will', documentYear: 1850, email: 'x@y.com' }, false);
expect('PII field: depositor_email (substring)', { sourceTable: 'canonical_persons', deathYear: 1880, depositor_email: 'x@y' }, false);
expect('PII field: net_worth', { sourceTable: 'canonical_persons', deathYear: 1880, net_worth: 1000000 }, false);
expect('PII field: address', { sourceTable: 'canonical_persons', deathYear: 1880, home_address: '1 Main St' }, false);
expect('isLiving flag', { sourceTable: 'canonical_persons', isLiving: true, deathYear: 1880 }, false);
expect('living person type: descendant', { sourceTable: 'canonical_persons', personType: 'descendant', birthYear: 1850 }, false);
expect('living person type: participant', { sourceTable: 'canonical_persons', personType: 'participant', deathYear: 1880 }, false);
expect('table not on allowlist', { sourceTable: 'random_table', documentType: 'will', documentYear: 1850 }, false);
expect('death year too recent (2010)', { sourceTable: 'canonical_persons', deathYear: 2010 }, false);
expect('birth year ≥ cutoff, no death (1990)', { sourceTable: 'canonical_persons', birthYear: 1990 }, false);
expect('no death/birth/doc year (ambiguous)', { sourceTable: 'canonical_persons' }, false);
expect('doc type not allowlisted', { sourceTable: 'person_documents', documentType: 'tax_return', documentYear: 1850 }, false);
expect('historical table but recent document (1990 will)', { sourceTable: 'person_documents', documentType: 'will', documentYear: 1990 }, false);

// ── MUST ALLOW (affirmatively historical, PII-free) ──
expect('1850 will (no person)', { sourceTable: 'person_documents', documentType: 'will', documentYear: 1850 }, true);
expect('1860 slave schedule', { sourceTable: 'person_documents', documentType: '1860_slave_schedule', documentYear: 1860 }, true);
expect('historical enslaved person (d.1880)', { sourceTable: 'canonical_persons', personType: 'enslaved', deathYear: 1880 }, true);
expect('historical enslaver (b.1790, no death)', { sourceTable: 'canonical_persons', personType: 'enslaver', birthYear: 1790 }, true);
expect('estate inventory 1845', { sourceTable: 'will_extractions', documentType: 'estate_inventory', documentYear: 1845 }, true);

// ── upload path enforces the gate ──
async function uploadTests() {
  // denied record → upload throws ARCHIVE_DENIED, never touches network/keys
  try {
    await uploadHistoricalDocument({ sourceTable: 'participants', personType: 'descendant' }, 'id', 'f.pdf', Buffer.from('x'), {}, { dryRun: true });
    fail++; console.log('  ✗ upload of participant record should have thrown');
  } catch (e) { if (e.code === 'ARCHIVE_DENIED') pass++; else { fail++; console.log(`  ✗ wrong error: ${e.message}`); } }

  // allowed historical record, dryRun → returns deterministic citation urls, no network
  try {
    const r = await uploadHistoricalDocument(
      { sourceTable: 'person_documents', documentType: 'will', documentYear: 1850 },
      'repram-doc-19', 'James-Hopewell-Will-1817.pdf', Buffer.from('x'), { collection: 'opensource' }, { dryRun: true });
    if (r.dryRun && r.item_url.includes('repram-doc-19')) pass++;
    else { fail++; console.log('  ✗ dryRun upload did not return expected citation', r); }
  } catch (e) { fail++; console.log(`  ✗ allowed dryRun upload threw: ${e.message}`); }
}

await uploadTests();
console.log(`\narchival gate: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
