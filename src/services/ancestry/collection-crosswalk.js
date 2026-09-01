/**
 * Ancestry collection → FREE primary-source crosswalk.
 *
 * The bot NEVER accesses Ancestry. A human runs the search + exports; this maps each Ancestry finding-aid
 * pointer to the FREE, redistributable source we actually ingest (FamilySearch / civilwardc / NARA /
 * Archive.org / Find A Grave), and to the pipeline that pulls it. Facts + pointers only — never Ancestry content.
 *
 * Each rule: { match (regex on the Ancestry collection title), free_source, our_pipeline, note }.
 * First match wins; falls back to a generic FamilySearch redirect (most Ancestry collections mirror an FS one).
 */

const RULES = [
  { match: /slave owner petition|compensated emancipation|slave.?owner/i,
    free_source: 'civilwardc', our_pipeline: 'civilwardc_ingest',
    note: 'DC 1862 Compensated Emancipation owner petitions → civilwardc.org TEI + NARA RG21 M520. We already ingest these (civilwardc_org).' },
  { match: /slave emancipation|emancipation record/i,
    free_source: 'civilwardc', our_pipeline: 'civilwardc_ingest',
    note: 'DC emancipation records 1851-1863 → civilwardc.org / NARA RG21.' },
  { match: /slave schedule/i,
    free_source: 'familysearch', our_pipeline: 'slave_schedule_1860',
    note: '1850/1860 US Federal Census Slave Schedules → FamilySearch / NARA M653. Our 1860-schedule pipeline.' },
  { match: /federal census|united states census|\bcensus\b/i,
    free_source: 'familysearch', our_pipeline: 'fs_climber',
    note: 'Population census → FamilySearch (same NARA microfilm). Pull via the FS scrape/climber.' },
  { match: /death cert|death index|death record|find a grave/i,
    free_source: /find a grave/i.test('') ? 'findagrave' : 'familysearch', our_pipeline: 'fs_record',
    note: 'Death certs/indexes → FamilySearch (DC deaths) ; Find A Grave is itself free (findagrave.com).' },
  { match: /marriage|divorce/i,
    free_source: 'familysearch', our_pipeline: 'fs_record',
    note: 'Marriage records → FamilySearch (same source collections).' },
  { match: /church record|baptism|christening|presbyterian|methodist|catholic/i,
    free_source: 'familysearch', our_pipeline: 'fs_record',
    note: 'Church/sacramental records → FamilySearch.' },
  { match: /family history book|genealogy|compiled genealogies|biographies/i,
    free_source: 'archive_org', our_pipeline: 'published_genealogy',
    note: 'Published genealogies → Archive.org / HathiTrust / Google Books (free full text). e.g. "Bowies and Their Kindred" (bowiestheirkindr00bowi) corroborates Hopewell→Biscoe→Chew.' },
  { match: /find a grave/i,
    free_source: 'findagrave', our_pipeline: 'web_public',
    note: 'Find A Grave is free at findagrave.com.' },
  { match: /city director|directory/i,
    free_source: 'archive_org', our_pipeline: 'web_public',
    note: 'City directories → Internet Archive / Library of Congress (many digitized free).' },
  { match: /draft|enlistment|military|pension/i,
    free_source: 'familysearch', our_pipeline: 'fs_record',
    note: 'Military/draft/pension → FamilySearch / NARA / Fold3-free-index.' },
  { match: /obituar/i,
    free_source: 'web_public', our_pipeline: 'web_public',
    note: 'Obituaries → newspapers (Chronicling America / free newspaper archives).' },
];

const FALLBACK = { free_source: 'familysearch', our_pipeline: 'fs_search_manual',
  note: 'No specific rule — most Ancestry collections mirror an FS collection of the same microfilm; search FamilySearch.' };

function crosswalk(ancestryCollection = '') {
  const c = String(ancestryCollection);
  for (const r of RULES) if (r.match.test(c)) return { ancestry_collection: c, free_source: r.free_source, our_pipeline: r.our_pipeline, note: r.note };
  return { ancestry_collection: c, ...FALLBACK };
}

module.exports = { crosswalk, RULES };
