#!/usr/bin/env node
/**
 * Scan parsed Freedmen's Bank pages and recommend additional documents
 * to import into Document AI for the underrepresented labels.
 *
 * Strategy:
 *   1. Map each Document AI label to one or more parsed-JSON field keys
 *      (and optional OCR substring fallbacks for labels that aren't extracted).
 *   2. For every parsed-JSON file, score the page by how many target labels
 *      have substantive (non-empty, multi-word) values.
 *   3. Output a ranked list — prioritising pages that cover MANY weak labels
 *      at once, and rotating across branches so the trainer sees template
 *      variation rather than 50 Savannah pages in a row.
 *
 * Usage:
 *   node scripts/find-docai-training-candidates.js               # default top N=40
 *   node scripts/find-docai-training-candidates.js --per-label 6 # rank per label
 *   node scripts/find-docai-training-candidates.js --already-imported list.txt
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(
  __dirname,
  '..',
  'debug',
  'freedmens-bank',
  'enslaver-test'
);

// Document AI label -> { parsedFields: [field keys], ocrPatterns: [regex] }
// ocrPatterns are used as a fallback for labels the parser doesn't extract
// (e.g. "How_Funds_Can_be_Drawn" is a form-section header, not a value field).
const LABELS = {
  How_Funds_Can_be_Drawn: {
    parsedFields: [],
    // The printed heading rarely OCRs cleanly. So we also match the bequest /
    // withdrawal clauses written under it ("if I should die ... paid to ...",
    // "drawn by ...", "in case of decease/death", "I wish my funds ...").
    ocrPatterns: [
      /how\s+(the\s+)?funds\s+can\s+be\s+drawn/i,
      /funds\s+can\s+be\s+drawn/i,
      /should\s+die/i,
      /in\s+case\s+of\s+(death|decease)/i,
      /drawn\s+by/i,
      /i\s+wish\s+(my|the)\s+(funds|money)/i,
      /(funds|money)\s+(shall|to\s+be)\s+paid/i,
    ],
  },
  Wife: {
    parsedFields: ['spouse_name'],
    ocrPatterns: [/\bwife\s+of\b/i, /\bwife\s*[:.]/i],
  },
  further_facts: {
    parsedFields: ['further_facts'],
    ocrPatterns: [/further\s+facts/i],
  },
  height: {
    parsedFields: ['height_and_complexion'],
    ocrPatterns: [/\bheight\b/i, /\bft\b.*\bin\b/i],
  },
  husband: {
    parsedFields: ['spouse_name'],
    ocrPatterns: [/\bhusband\s+of\b/i, /\bhusband\s*[:.]/i],
  },
  last_master: {
    parsedFields: ['last_master'],
    ocrPatterns: [/last\s+master/i, /name\s+of\s+last\s+master/i],
  },
  last_mistress: {
    parsedFields: ['last_mistress'],
    ocrPatterns: [/last\s+mistress/i, /name\s+of\s+last\s+mistress/i],
  },
  last_residence_of_slave: {
    parsedFields: ['slave_residence', 'raised_in'],
    ocrPatterns: [/last\s+residence\s+of\s+depositor\s+while\s+a\s+slave/i,
                  /residence.*while.*slave/i],
  },
  marital_status: {
    parsedFields: ['marital_status'],
    ocrPatterns: [/married\s+or\s+single/i],
  },
  name_of_last_owner: {
    parsedFields: ['last_master'],   // "name of last owner" is a label variant
    ocrPatterns: [/name\s+of\s+last\s+owner/i, /last\s+owner/i],
  },
  plantation: {
    parsedFields: ['plantation'],
    ocrPatterns: [/\bplantation\b/i],
  },
};

// Tunables
const MIN_WORDS = 2;          // a value needs ≥N tokens to count as "filled"
const TOP_N = 40;             // total recommendations
const PER_LABEL_FLOOR = 4;    // each label gets at least this many candidates
const MIN_ACCT_GAP = 25;      // when picking from same branch, enforce min gap
                              //   between acct numbers so we don't grab 7
                              //   consecutive same-template / same-handwriting
                              //   pages
const args = process.argv.slice(2);
const perLabelOnly = args.includes('--per-label');
const noCopy = args.includes('--no-copy');
const importedListPath = (() => {
  const i = args.indexOf('--already-imported');
  return i >= 0 ? args[i + 1] : null;
})();
const UPLOAD_DIR = path.join(__dirname, '..', 'debug', 'docai-to-upload');

// Optional: skip pages already imported.  Accepts:
//   - full path:        ".../charleston-south-carolina-roll-21/acct-100.png"
//   - relative path:    "charleston-south-carolina-roll-21/acct-100.png"
//   - underscore form:  "charleston_south_carolina_21__acct-100.png"
//   - just basename:    "acct-100.png"  (matches across branches — broad)
// Normalizes underscores↔hyphens and strips the optional "roll" / "rolls" word
// so the docai-training-batch naming convention "lines up" with branch dirs.
const norm = (s) =>
  s
    .toLowerCase()
    .replace(/\.png$/, '')
    .replace(/_+/g, '-')          // underscores -> hyphens
    .replace(/-+/g, '-')          // collapse repeats
    .replace(/-roll(s)?-/g, '-')  // strip "-roll-" / "-rolls-"
    .replace(/-$/, '')
    .replace(/^-/, '');

const importedSet = new Set();
if (importedListPath && fs.existsSync(importedListPath)) {
  fs.readFileSync(importedListPath, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((s) => {
      // store both the raw entry and the normalized form
      importedSet.add(s);
      importedSet.add(norm(path.basename(s)));
      importedSet.add(norm(s));
    });
  console.error(`[info] excluding ${importedSet.size / 3 | 0} already-imported pages`);
}

const isImported = (branch, acct) => {
  if (!importedSet.size) return false;
  const candidates = [
    `${branch}/${acct}.png`,
    `${acct}.png`,
    norm(`${branch}__${acct}`),
    norm(`${branch}/${acct}`),
  ];
  return candidates.some((c) => importedSet.has(c));
};

const wordCount = (v) =>
  typeof v === 'string'
    ? v.replace(/[^\w]+/g, ' ').trim().split(/\s+/).filter(Boolean).length
    : 0;

// Walk every branch folder, every parsed JSON.
const branches = fs
  .readdirSync(ROOT)
  .filter((d) => fs.statSync(path.join(ROOT, d)).isDirectory());

const candidates = []; // { branch, acct, image, hits: {label: chars}, score }

for (const branch of branches) {
  const dir = path.join(ROOT, branch);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('-parsed.json'));
  for (const f of files) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch {
      continue;
    }
    const acct = f.replace('-parsed.json', '');
    const imageRel = `${branch}/${acct}.png`;
    if (isImported(branch, acct)) continue;

    // Lazily read OCR text only if any label needs the fallback
    let ocrText = null;
    const ocr = () => {
      if (ocrText !== null) return ocrText;
      const p = path.join(dir, `${acct}-ocr.txt`);
      ocrText = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
      return ocrText;
    };

    // Aggregate every record's fields into one bag (most pages = 1 record anyway)
    const bag = {};
    for (const r of parsed.records || []) {
      for (const [k, v] of Object.entries(r.fields || {})) {
        if (k === '__debug') continue;
        if (typeof v !== 'string' || !v.trim()) continue;
        if (!bag[k] || v.length > bag[k].length) bag[k] = v;
      }
    }

    const hits = {};
    for (const [label, spec] of Object.entries(LABELS)) {
      let best = null;
      for (const fk of spec.parsedFields) {
        const v = bag[fk];
        if (v && wordCount(v) >= MIN_WORDS) {
          if (!best || v.length > best.length) best = v;
        }
      }
      // OCR fallback for label-presence (lower-quality signal but proves the
      // form HAS the field even when the value is blank)
      if (!best && spec.ocrPatterns.length) {
        const t = ocr();
        if (t && spec.ocrPatterns.some((re) => re.test(t))) {
          best = '[ocr-detected-blank]';
        }
      }
      if (best) hits[label] = best.slice(0, 60);
    }

    const score = Object.keys(hits).length;
    if (score === 0) continue;
    candidates.push({ branch, acct, image: imageRel, hits, score });
  }
}

console.error(`[info] scanned ${candidates.length} pages with ≥1 hit`);

// ---------- Selection ----------
// Pass 1: ensure each label gets PER_LABEL_FLOOR candidates from diverse branches.
// Pass 2: fill remaining slots with highest-multi-label-score pages, round-robin
// across branches so we don't blow the budget on one roll.

const chosen = new Map(); // image -> candidate
const labelCounts = Object.fromEntries(Object.keys(LABELS).map((l) => [l, 0]));
const branchCounts = {};
const branchAccts = {}; // branch -> [acct numbers already picked]

const tooClose = (cand) => {
  const acctNum = parseInt((cand.acct.match(/\d+/) || [0])[0], 10);
  const picked = branchAccts[cand.branch] || [];
  return picked.some((a) => Math.abs(a - acctNum) < MIN_ACCT_GAP);
};

const pickCandidate = (cand, reason) => {
  if (chosen.has(cand.image)) return false;
  chosen.set(cand.image, { ...cand, reason });
  for (const l of Object.keys(cand.hits)) labelCounts[l]++;
  branchCounts[cand.branch] = (branchCounts[cand.branch] || 0) + 1;
  const acctNum = parseInt((cand.acct.match(/\d+/) || [0])[0], 10);
  (branchAccts[cand.branch] ||= []).push(acctNum);
  return true;
};

// Per-label: pick the top hits for each label, rotating branches AND
// enforcing acct-number spread within a branch.
for (const label of Object.keys(LABELS)) {
  const matches = candidates
    .filter((c) => c.hits[label])
    .sort((a, b) => {
      // Prefer real values over OCR-detected-blank
      const aReal = (c) => c.hits[label] !== '[ocr-detected-blank]';
      if (aReal(a) !== aReal(b)) return aReal(a) ? -1 : 1;
      return b.score - a.score;
    });
  const seenBranch = new Set();
  let picked = 0;
  // Pass A: respect both branch-rotation and acct-spread
  for (const c of matches) {
    if (picked >= PER_LABEL_FLOOR) break;
    if (chosen.has(c.image)) { picked++; continue; }
    if (seenBranch.has(c.branch)) continue;
    if (tooClose(c)) continue;
    if (pickCandidate(c, `floor:${label}`)) {
      seenBranch.add(c.branch);
      picked++;
    }
  }
  // Pass B: if we couldn't fill the floor under strict rules, relax
  // branch-rotation but still keep acct-spread
  if (picked < PER_LABEL_FLOOR) {
    for (const c of matches) {
      if (picked >= PER_LABEL_FLOOR) break;
      if (chosen.has(c.image)) continue;
      if (tooClose(c)) continue;
      if (pickCandidate(c, `floor-relaxed:${label}`)) picked++;
    }
  }
}

if (!perLabelOnly) {
  // Fill remaining slots: highest score, branch + acct-spread rules
  const remaining = candidates
    .filter((c) => !chosen.has(c.image))
    .sort((a, b) => b.score - a.score);
  for (const c of remaining) {
    if (chosen.size >= TOP_N) break;
    const cap = Math.ceil(TOP_N / 6); // ~6 branches share the budget
    if ((branchCounts[c.branch] || 0) >= cap) continue;
    if (tooClose(c)) continue;
    pickCandidate(c, `multi-hit(${c.score})`);
  }
}

// ---------- Output ----------
const out = [...chosen.values()].sort(
  (a, b) => b.score - a.score || a.branch.localeCompare(b.branch)
);

console.log('\n=== RECOMMENDED DOCUMENTS TO IMPORT ===\n');
console.log(`Total: ${out.length} pages\n`);
console.log('Per-label coverage after picking:');
for (const [l, n] of Object.entries(labelCounts).sort((a, b) => a[1] - b[1])) {
  console.log(`  ${n.toString().padStart(3)}  ${l}`);
}
console.log('\nPer-branch distribution:');
for (const [b, n] of Object.entries(branchCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n.toString().padStart(3)}  ${b}`);
}
console.log('\n--- pages (image path → labels covered) ---');
for (const c of out) {
  const labels = Object.keys(c.hits).join(', ');
  console.log(`\n${c.image}    [${c.score} labels — ${c.reason}]`);
  console.log(`  ${labels}`);
  for (const [l, v] of Object.entries(c.hits)) {
    console.log(`    ${l.padEnd(28)} = ${v}`);
  }
}

// Also write a plain list of paths for easy copying
const listPath = path.join(__dirname, '..', 'debug', 'docai-candidates.txt');
fs.writeFileSync(
  listPath,
  out.map((c) => path.join(ROOT, c.image)).join('\n') + '\n'
);
console.error(`\n[info] absolute paths written to ${listPath}`);

// Copy every picked PNG into a single flat upload folder, prefixed with the
// branch name so filenames stay unique. This is the folder you drag into the
// Document AI labeling UI.
if (!noCopy) {
  if (fs.existsSync(UPLOAD_DIR)) {
    for (const f of fs.readdirSync(UPLOAD_DIR)) {
      if (f.endsWith('.png')) fs.unlinkSync(path.join(UPLOAD_DIR, f));
    }
  } else {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  let copied = 0, missing = 0;
  const manifest = [];
  for (const c of out) {
    const src = path.join(ROOT, c.image);
    if (!fs.existsSync(src)) { missing++; continue; }
    const dest = path.join(
      UPLOAD_DIR,
      `${c.branch}__${c.acct}.png`
    );
    fs.copyFileSync(src, dest);
    copied++;
    manifest.push({
      file: path.basename(dest),
      branch: c.branch,
      acct: c.acct,
      labels_covered: Object.keys(c.hits),
      reason: c.reason,
    });
  }
  fs.writeFileSync(
    path.join(UPLOAD_DIR, '_manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  console.error(
    `[info] copied ${copied} PNGs into ${UPLOAD_DIR}` +
      (missing ? ` (${missing} source files missing)` : '')
  );
  console.error(
    `[info] manifest written to ${path.join(UPLOAD_DIR, '_manifest.json')}`
  );
}
