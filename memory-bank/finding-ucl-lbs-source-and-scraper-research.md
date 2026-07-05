# FINDING — UCL Legacies of British Slavery (LBS): source model + scraper research

_Research pass 2026-07-03 (branch audit/probate-classifier). Target the user asked for:
recover ALL persons + all spine attributes from https://www.ucl.ac.uk/lbs/search/ , fully
autonomous, running on the Mac Mini. Grounded in [[standard-external-source-ingest]],
[[standard-canonical-person-and-document-gate]], [[reference-benchmark-sources-register]]._

## Why this source matters (memory-bank fit)
`activeContext.md` already names **"British 1817-34 Slave Registers + 1834 compensation
(denominator + dual-ledger enslaver debt in one)"** as a **tier-1 NEEDED** scrape target and the
`reference-benchmark-sources-register` lists the T71 Slave Registers. LBS **is** the digitized 1834
Slave Compensation Commission record — it delivers, in one source:
1. **Dual-ledger debt evidence** (AUDIT rule #3): the £20M paid TO enslavers, per claim, to named
   awardees with roles. Compensation TO the owner = evidence of debt owed to the enslaved.
2. **Reference-class denominators** (#116): enslaved counts per claim/estate/colony/parish across the
   British Caribbean, Mauritius, Cape at abolition (~670,000 enslaved, ~40,000 claims).
3. **Enslaver canonical spine**: ~47,000 named owner-class individuals (Phase 1) + ~20,000 pre-1833
   owners from the Slave Registers (Phase 2), with rich biography + kinship + addresses.
4. **Continuity-of-holding substrate** ([[project_direction_identity_over_payment]]): the six legacy
   strands — **Commercial** (firms/banks), Cultural, Imperial, Historical, Physical, Political — are
   exactly the family-business / institutional threads the disgorgement spine needs.

**Licence: CC BY-NC-SA 4.0** (confirmed on the JSDP dataset article + UKDA SN-852209). Our project is
non-commercial → **usable with attribution + sharealike**, same footing as Enslaved.org/Hall. Cite
UCL LBS + the underlying primaries (TNA T71, BPP 1837-38 (215) XLVIII, PROB11) per the citation
discipline in the register.

## NO bulk dump exists — the web app is the only access
- UKDA **ReShare SN-852209** has **"No Files to display"**; it redirects back to the UCL site. The
  DOI (10.5255/UKDA-SN-852209) is a catalogue pointer, not a download.
- The DB itself is **MySQL, 99 tables / 861 fields** (JSDP article, McClelland 2020), served by a PHP
  front end. There is no public API and no CSV export. **→ Scraping the rendered pages is the path.**

## RESOLUTION (2026-07-04): live site UNSCRAPEABLE via CDP → pivoted to Wayback + data request
Live-test verdict: the Cloudflare challenge here is a **Turnstile** that **refuses the CDP-driven
browser and grants NO durable `cf_clearance`** — only a one-shot per-navigation token + `__cf_bm`, so
EVERY navigation re-challenges (the "solve once, reuse" model FAILS; verified across repeated VNC
Turnstile solves — cf_clearance never persisted). **FlareSolverr researched + ruled out**: current
reporting is unambiguous it cannot clear Turnstile/managed challenges (returns "Just a moment…" HTML or
times out). Only paid per-solve token APIs (CapSolver/2Captcha) clear Turnstile — a paid dep, adversarial
to a charity WAF, rejected. **DECISION (user): Wayback + data request.**
- **Wayback path BUILT + RUNNING** (`scripts/scrapers/ucl-lbs-wayback.mjs`, M119 `wayback_ts`): the
  Internet Archive mirrors LBS and is NOT Cloudflare-protected. CDX API enumerated the archived universe
  = **~22,190 records: claim 4,796 · estate 4,605 · person 12,242 · firm 547** (partial vs ~90k live, but
  substantial — esp. 12k persons + the dual-ledger claims). No Chrome, plain HTTP `…/web/{ts}id_/{url}`;
  same DOM → same stage-2 parser. Full `--fetch` running unattended on the Mini (nohup, ~overnight),
  streaming HTML→S3 (`sources/ucl-lbs/{type}/{id}.html`) + `lbs_raw_records`. Politeness ~1.6s.
- **Data request DRAFTED** (`research/ucl-lbs-data-request.md`) — the authoritative/complete route: the
  full relational export is CC BY-NC-SA + deposited (UKDA SN-852209); LBS shares extracts with
  researchers. A granted dump SUPERSEDES the Wayback corpus (100% coverage) via the same parser mapping.
- The live-site CDP crawler (`ucl-lbs-crawler.mjs`) is KEPT but PARKED (works only if a future
  non-Cloudflare access route opens); the 73k seeded frontier rows coexist (wayback_ts NULL = ignored by
  the Wayback fetcher).

## HARD CONSTRAINT #1 — the site is behind a Cloudflare "managed challenge"
Diagnostic (single probe, MacBook): every `/lbs/*` URL returns **HTTP 403 + "Just a moment…"** with
`window._cf_chl_opt … cType:'managed'` and a JS/cookie challenge. This is **not** a UA block — plain
`curl`/`fetch`/WebFetch (any UA) cannot pass it. Implications for design:
- Must use a **real browser that executes the challenge JS and holds the `cf_clearance` cookie** — i.e.
  the SAME `puppeteer.connect()` to a real Chrome on `127.0.0.1:9222` pattern the FS climber uses
  (CLAUDE.md FamilySearch rules). A headless/stealth browser MAY be challenged harder; the Mini's real,
  logged-in-desktop Chrome is the reliable vehicle. Solve the interstitial ONCE (human via VNC if it
  ever shows an interactive turnstile), then `cf_clearance` persists for the browser session.
- **Politeness is mandatory** (CC-licensed academic charity site, shared Cloudflare): serial requests,
  1.5–3 s jittered delay, honour 429/503 with backoff, a descriptive UA, run overnight. This is a
  ~90–100k page crawl — it must look like a slow researcher, not a flood, or Cloudflare will harden.
- **The Wayback Machine is NOT behind Cloudflare** — used it to reverse-engineer the DOM below, and it
  is a viable *fallback/augment* for pages that resist live fetch (raw HTML via the `id_` suffix).

## Entity + URL model (verified against archived DOM)
Central key = **PersonID** (McClelland: "the single most important field… join this ID to other
tables"). Four record types, all `GET /lbs/<type>/view/<id>`:

| Type | URL | ID shape | ~count |
|------|-----|----------|--------|
| **claim** | `/lbs/claim/view/{id}` | small int from 1 (+ some hashed) | ~40,000 |
| **estate** | `/lbs/estate/view/{id}` | small int 1..~24,289 | ~8,000 |
| **person** | `/lbs/person/view/{id}` | **MIXED**: small ints (6914, 45720) AND large/negative hashes (2146630513, -368685485) | ~47,000+20,000 |
| **firm** | `/lbs/firm/view/{id}` | small int | (commercial legacies) |

**Person IDs are the trap:** Phase-2 / auto-generated persons use large positive OR negative hashed
IDs. A pure sequential `person/view/1..N` walk **misses them**. → enumerate persons by **graph crawl**,
not by counting.

### CLAIM page (`Details of Claim`) — the dual-ledger core
Fields (archived claim/view/10894, Grenada 770 "Telescope Estate"):
- `Colony`, `Claim No.`, `Estate` (→ `/estate/view/`), `Contested` (Yes/No), award **date**,
  **`N Enslaved`** (e.g. "206 Enslaved"), **compensation `£ s d`** (e.g. "£6212 0s 3d").
- **`Associated Individuals (n)`**: each = a person NAME + `/person/view/{id}` link + **ROLE string**,
  e.g. `Awardee (Mortgagee)`, `Unsuccessful claimant (Legatee)`, `Previous owner (not making a claim)`,
  `Trustee`, `Executor`, `Counterclaimant`. **Awardee = who received the money** (debt evidence).
- **`Associated Estates (n)`**, `Claim Notes`, `Further Information`, `Documents of Interest`.

### PERSON page (`Profile & Legacies Summary`) — the spine record
Fields (archived person/view/-1012574016, "Thomas Barrett Lennard"):
- `<h1>` = **name**; biography block: `Absentee?`, `British/Irish`, `Name in compensation records`,
  `Spouse`, `Children`, `School`, `University`, `Occupation`. **Birth/death** dates appear in prose /
  a dates block (e.g. "1785 - 4th Jan 1846"); a letter-key legend explains date categories.
- **`Associated Claims (n)`** / **`Associated Estates (n)`**: colony/estate + **£ amount + role**
  (per-person dual-ledger line).
- **`Relationships (n)`**: typed kinship, e.g. `Thomas… Husband → Wife Mary Bridger Shedden`; `Children`
  field yields parent→child edges → feeds `canonical_family_edges` ([[standard-genealogical-edge-evidence]]).
- **`Addresses (n)`** (structured place hierarchy); **Legacies Summary** across the six strands
  (`Political`, `Commercial`, …) with sub-records (e.g. MP party + elections).
- **`Sources`** section = primary/secondary citations (this is the corroborating-document material for
  the gate — a person with a will/register citation can be promoted, not just gated-secondary).
- **`sex` is NOT an explicit field** — infer from title / "wife of" / pronoun / given name (CLAUDE.md
  `sex` inference), never fabricate.

### ESTATE page — denominator + owner-continuity
Estate name, colony/parish, enslaved counts over time, and the chain of owners (→ persons), which is
the estate-level continuity thread.

## Enumeration strategy (autonomous, resumable) — GRAPH CRAWL, not ID walk
Reaches the hashed person IDs; naturally resumable; a DB frontier makes it Mini-durable:
1. **Seed** the frontier with the dense small-integer spaces we CAN count: `claim/view/1..~46000` and
   `estate/view/1..~25000` (+ `firm/view/1..M`). These are cheap to enumerate and every owner-class
   person hangs off at least one claim or estate.
2. **Crawl**: for each fetched page, extract ALL `/lbs/{person,estate,claim,firm}/view/{id}` links and
   push unseen ones onto the frontier. This pulls in every hashed/negative person ID by reference.
3. **Visited set + frontier = a Postgres table** (see plan) → kill/restart safe, dedup, progress query
   (the [[feedback_verify_db_not_logs]] rule: truth is the DB, not a log).
4. Terminate when the frontier drains. Expect ~90–100k pages total; at ~2 s politeness ≈ 2–3 nights.

## What lands on the spine (per [[standard-external-source-ingest]] rule #3 — full attributes, not thin)
- **Person → `PersonService.findOrCreateLead`** with name, inferred sex, birth/death year, occupation,
  addresses(→primary_state/place), spouse/children, `Absentee?`, British/Irish → gated **secondary**
  canonical/lead; `person_external_ids` **`id_system='ucl_lbs_person'`** (product-specific per rule #4;
  NB person id can be negative — store as text).
- **Claim → dual-ledger row**: colony, parish, estate, £-awarded, enslaved-count, date, contested, +
  the awardee/claimant/role edges. Awarded-£ feeds the compensation-as-debt ledger; enslaved-count feeds
  `slave_economy_benchmarks` (#116) as an **aggregate**, NEVER as placeholder enslaved persons
  (AUDIT rule #5 — LBS rarely names the enslaved; do not mint "Unnamed" rows).
- **Relationships → `canonical_family_edges`** (Husband/Wife/parent/child), tier per the edge-evidence
  standard (a stated relationship on a sourced person page = a real evidenced edge).
- **Provenance**: S3-archive each fetched HTML page + a Wayback snapshot into `source_artifacts`
  (M100 pattern) so the citation is a stored document, not a live URL (gate rule: real file, not a
  pointer). Cite UCL LBS + the underlying TNA T71 / BPP primary.
- **Namespace discipline (rule #4):** keep claim/estate/firm ids in separate `id_system`s
  (`ucl_lbs_claim` / `ucl_lbs_estate` / `ucl_lbs_firm`); never cross-match a person to a claim id.

## Open questions to resolve DURING iterative build (on the Mini, against live DOM)
- Exact CSS selectors for each field (archived DOM ≈ live, but classes may have drifted) — build a
  parser fixture per type from the FIRST few live pages, snapshot to `tests/fixtures/ucl-lbs/`.
- Whether `/lbs/search/` exposes a paginated all-records listing (would augment the seed) — search was
  Cloudflare-blocked from the MacBook; check live on the Mini.
- Firm-page field set (no archived firm snapshot found) — inspect live.
- Birth/death parse: dates are prose with a category-letter key; needs a small date-normalizer.

## See also
[[standard-external-source-ingest]] · [[standard-canonical-person-and-document-gate]] ·
[[standard-genealogical-edge-evidence]] · [[reference-benchmark-sources-register]] ·
[[project_direction_identity_over_payment]] · [[plan-ucl-lbs-scraper]]
