/**
 * lbs-parser.js — stage-2 parser for UCL Legacies of British Slavery record pages.
 *
 * PURE + deterministic (audit rule 1: code parses, humans review; no model in the loop). Takes the raw
 * HTML archived by the Wayback fetcher (scripts/scrapers/ucl-lbs-wayback.mjs) and returns normalized
 * structured objects. The DB/spine promotion (PersonService.findOrCreateLead, dual-ledger rows,
 * canonical_family_edges, per-colony control-total tripwire) lives in scripts/ingest-ucl-lbs.mjs — this
 * module only turns HTML → data.
 *
 * DOM grammar (verified against tests/fixtures/ucl-lbs/, 2024-2026 captures):
 *   - <h1> = record name.
 *   - label/value blocks: <table class="full table"><tr><td><div class="columns .."><strong>LABEL</strong>
 *       </div><div class="columns .. small">VALUE</div></td></tr>… (claim "Further Information",
 *       person biography).
 *   - association lists: <td class="header"><div..><strong><a href="/lbs/{type}/view/{id}">NAME</a>
 *       </strong></div><div..><span class="highlight">ROLE</span></div></td> (+ an amount for claims).
 *   - claim header: <p class="date">…1836</p> reading "N Enslaved | £X s d".
 *
 * Every field is optional (older captures/records omit some) — callers must null-check.
 */

const cheerio = require('cheerio');

const PERSON_HREF = /\/lbs\/person\/view\/(-?\d+)/;
const ESTATE_HREF = /\/lbs\/estate\/view\/(-?\d+)/;
const CLAIM_HREF = /\/lbs\/claim\/view\/(-?\d+)/;

const clean = (s) => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const firstYear = (s) => { const m = (s || '').match(/\b(1[6-9]\d\d)\b/); return m ? parseInt(m[1], 10) : null; };
const intOf = (s) => { const m = (s || '').replace(/,/g, '').match(/-?\d+/); return m ? parseInt(m[0], 10) : null; };

/** "£6212 0s 3d" / "£6,212 0S 3D" → { raw, pounds, shillings, pence, decimal } (decimal £, s/20 + d/240). */
function parsePounds(text) {
  if (!text) return null;
  const m = text.replace(/,/g, '').match(/£\s*(\d+)(?:\s+(\d+)\s*[sS])?(?:\s+(\d+)\s*[dD])?/);
  if (!m) return null;
  const pounds = parseInt(m[1], 10);
  const shillings = m[2] ? parseInt(m[2], 10) : 0;
  const pence = m[3] ? parseInt(m[3], 10) : 0;
  return { raw: clean(text), pounds, shillings, pence, decimal: +(pounds + shillings / 20 + pence / 240).toFixed(4) };
}

/** Parse a `table.full.table` of strong-label / div-value rows into { LABEL: VALUE }. */
function kvTable($, table) {
  const out = {};
  $(table).find('tr').each((_, tr) => {
    const label = clean($(tr).find('strong').first().text());
    if (!label) return;
    // value = the row's text minus the label
    const full = clean($(tr).find('td').first().text());
    let value = full.startsWith(label) ? clean(full.slice(label.length)) : full;
    out[label.replace(/[?:]$/, '')] = value;
  });
  return out;
}

/** The `table.full.table` immediately following a heading whose text matches `re`. */
function tableAfterHeading($, re) {
  let found = null;
  $('h1,h2,h3,h4').each((_, h) => {
    if (found) return;
    if (re.test(clean($(h).text()))) {
      // kv tables are class="full table"; association tables (Associated Estates) are class="full".
      const t = $(h).nextAll('table.full').first();
      if (t.length) found = t;
    }
  });
  return found;
}

/** Association rows (person/estate/claim link + role + optional amount) under a heading. */
function assocRows($, re, hrefRe) {
  const table = tableAfterHeading($, re);
  const rows = [];
  if (!table) return rows;
  $(table).find('td.header, td').each((_, td) => {
    const a = $(td).find('a').filter((__, el) => hrefRe.test($(el).attr('href') || '')).first();
    if (!a.length) return;
    const id = ($(a).attr('href').match(hrefRe) || [])[1];
    // Role: with .highlight ("Awardee (Mortgagee)" — parenthetical detail sits OUTSIDE .highlight, so
    // read the .highlight's wrapping span). Without .highlight (firm "Director X"), strip the name.
    const hl = $(td).find('.highlight').first();
    let role = null;
    if (hl.length) role = clean(hl.parent().text()) || clean(hl.text()) || null;
    else { const stripped = clean(clean($(td).text()).replace(clean(a.text()), '')); role = stripped || null; }
    const amount = parsePounds($(td).text());
    rows.push({ id, name: clean(a.text()), role, amount });
  });
  return rows;
}

function h1($) { return clean($('h1').first().text()) || null; }

function parseClaim(html) {
  const $ = cheerio.load(html);
  const kv = (() => { const t = tableAfterHeading($, /^Further Information/); return t ? kvTable($, t) : {}; })();
  const header = clean($('p.date').first().text());  // "24th Oct 1836 | 206 Enslaved | £6212 0s 3d"
  const enslaved = (header.match(/([\d,]+)\s*Enslaved/) || [])[1];
  return {
    type: 'claim',
    name: h1($),
    colony: kv['Colony'] || null,
    claimNo: kv['Claim No.'] || kv['Claim No'] || null,
    estateName: kv['Estate'] || null,
    contested: kv['Contested'] ? /yes/i.test(kv['Contested']) : null,
    date: header.split('|')[0] ? clean(header.split('|')[0]) : null,
    // Year ONLY from the date segment — scanning the whole header lets a 4-digit £ amount (e.g. £1656)
    // be mistaken for a year on "No Date" claims (validation caught 10 such spurious years).
    year: firstYear(header.split('|')[0] || ''),
    enslavedCount: enslaved ? intOf(enslaved) : null,
    compensation: parsePounds(header),
    individuals: assocRows($, /Associated Individuals/, PERSON_HREF).map((r) => ({ personId: r.id, name: r.name, role: r.role })),
    estates: assocRows($, /Associated Estates/, ESTATE_HREF).map((r) => ({ estateId: r.id, name: r.name })),
    notes: clean($('.indnotes').first().text()) || null,
  };
}

function parsePerson(html) {
  const $ = cheerio.load(html);
  const bio = (() => { const t = tableAfterHeading($, /Further Information|Profile/); return t ? kvTable($, t) : {}; })();
  // birth/death: LBS renders "b. YYYY" / "d. YYYY" or "YYYY - YYYY" in the profile heading area / summary.
  const summary = clean($('.indtype, .profile, h1').first().parent().text()).slice(0, 400);
  const dm = summary.match(/\b(1[6-9]\d\d)\s*[-–]\s*(?:\d{1,2}[a-z]{0,2}\s+\w+\s+)?(1[6-9]\d\d)\b/);
  return {
    type: 'person',
    name: h1($),
    absentee: bio['Absentee'] || bio['Absentee?'] || null,
    nationality: null, // often folded into Absentee cell; refined in ingest
    nameInCompensationRecords: bio['Name in compensation records'] || null,
    spouse: bio['Spouse'] || null,
    children: bio['Children'] || null,
    school: bio['School'] || null,
    university: bio['University'] || null,
    occupation: bio['Occupation'] || null,
    birthYear: dm ? parseInt(dm[1], 10) : null,
    deathYear: dm ? parseInt(dm[2], 10) : null,
    claims: assocRows($, /Associated Claims/, CLAIM_HREF).map((r) => ({ claimId: r.id, name: r.name, role: r.role, amount: r.amount })),
    estates: assocRows($, /Associated Estates/, ESTATE_HREF).map((r) => ({ estateId: r.id, name: r.name, role: r.role })),
    relationships: parseRelationships($),
    addresses: parseAddresses($),
    bio,
  };
}

/** Relationships section: "NAME  Husband → Wife  OTHER" — typed kinship edges. */
function parseRelationships($) {
  const table = tableAfterHeading($, /Relationships/);
  const out = [];
  if (!table) return out;
  $(table).find('tr').each((_, tr) => {
    const links = $(tr).find('a').filter((__, el) => PERSON_HREF.test($(el).attr('href') || ''));
    const rel = clean($(tr).text());
    if (!links.length) return;
    const other = links.last();
    out.push({
      relationRaw: rel.slice(0, 120),
      otherPersonId: ($(other).attr('href').match(PERSON_HREF) || [])[1],
      otherName: clean(other.text()),
    });
  });
  return out;
}

function parseAddresses($) {
  const table = tableAfterHeading($, /Addresses/);
  const out = [];
  if (!table) return out;
  $(table).find('tr').each((_, tr) => { const t = clean($(tr).text()); if (t && !/^Details/i.test(t)) out.push(t.replace(/\s*Details.*$/, '')); });
  return out;
}

function parseEstate(html) {
  const $ = cheerio.load(html);
  // subheading "Grenada | St Andrew" = colony | parish (it is an <h4>)
  let colony = null, parish = null;
  $('h1,h2,h3,h4').each((_, h) => {
    if (colony) return;
    const m = clean($(h).text()).match(/^([A-Z][A-Za-z ]+?)\s*\|\s*([A-Za-z .'-]+)$/);
    if (m) { colony = clean(m[1]); parish = clean(m[2]); }
  });
  // Estate Information time-series: "1817 [Number of enslaved people] 221(Tot) 109(F) 130(M) [Name] X …
  // possessor". The rows are NOT in a table.full — scan globally for the (Tot) signature (very specific).
  const registrations = [];
  const seenReg = new Set();
  $('tr, p, li').each((_, el) => {
    const txt = clean($(el).text());
    const yr = firstYear(txt);
    if (!yr || !/\(Tot\)/.test(txt)) return;
    const key = yr + '|' + txt.slice(0, 20);
    if (seenReg.has(key)) return; seenReg.add(key);
    const tot = (txt.match(/([\d,]+)\s*\(Tot\)/) || [])[1];
    const fem = (txt.match(/([\d,]+)\s*\(F\)/) || [])[1];
    const mal = (txt.match(/([\d,]+)\s*\(M\)/) || [])[1];
    const possessor = (txt.match(/(?:lawful possession of|Belonging to[^.]*?of)\s+([^.]+?)\.?$/i) || [])[1];
    registrations.push({ year: yr, total: tot ? intOf(tot) : null, female: fem ? intOf(fem) : null, male: mal ? intOf(mal) : null, possessor: possessor ? clean(possessor) : null });
  });
  return {
    type: 'estate',
    name: h1($),
    colony, parish,
    registrations,
    claims: assocRows($, /Associated Claims/, CLAIM_HREF).map((r) => ({ claimId: r.id, name: r.name, amount: r.amount })),
    people: assocRows($, /Associated People/, PERSON_HREF).map((r) => ({ personId: r.id, name: r.name, role: r.role })),
  };
}

function parseFirm(html) {
  const $ = cheerio.load(html);
  // Firm "People & Investments" rows: <span class="label label-red">ROLE</span> … <a href person><strong>NAME</strong></a>.
  // The heading sits INSIDE the same table, so scan person anchors that carry a .label role (this also
  // excludes the People-of-Interest / nav person links, which have no .label).
  const people = [];
  const seen = new Set();
  $('a').each((_, a) => {
    const m = ($(a).attr('href') || '').match(PERSON_HREF);
    if (!m) return;
    const td = $(a).closest('td');
    const role = clean(td.find('.label').first().text()) || null;
    if (!role) return;
    const key = m[1] + '|' + role;
    if (seen.has(key)) return; seen.add(key);
    people.push({ personId: m[1], name: clean($(a).text()), role });
  });
  return { type: 'firm', name: h1($), people };
}

function parseLbs(urlType, html) {
  switch (urlType) {
    case 'claim': return parseClaim(html);
    case 'person': return parsePerson(html);
    case 'estate': return parseEstate(html);
    case 'firm': return parseFirm(html);
    default: throw new Error(`unknown LBS url_type: ${urlType}`);
  }
}

module.exports = { parseLbs, parseClaim, parsePerson, parseEstate, parseFirm, parsePounds, kvTable };
