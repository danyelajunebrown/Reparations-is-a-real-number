-- Migration 118: UCL LBS crawl frontier + raw-record staging (UCL Legacies of British Slavery scrape)
-- Date: 2026-07-03
--
-- WHY: the LBS database (https://www.ucl.ac.uk/lbs) is the digitized 1834 Slave Compensation
-- Commission record — the "British 1834 compensation" tier-1 source activeContext.md flags as NEEDED:
-- dual-ledger enslaver debt (£20M paid TO named owners), enslaved-count denominators per claim/colony
-- (#116), ~67k owner-class canonicals, and the six "legacy" strands (incl. Commercial firms = the
-- continuity-of-holding substrate). Licence CC BY-NC-SA 4.0 → usable non-commercially with attribution.
--
-- There is NO bulk dump (UKDA SN-852209 has no files; it points back to the site) and no API. The site
-- is behind a Cloudflare MANAGED CHALLENGE (403 "Just a moment…" to any non-browser fetch), so the crawl
-- runs through the Mini's real Chrome via puppeteer.connect() (same lifecycle as the FS climber).
--
-- DESIGN (see memory-bank/plan-ucl-lbs-scraper.md):
--   * GRAPH CRAWL, not sequential ID walk — person IDs are mixed small-int AND large/negative hashes,
--     so we seed the dense claim/estate/firm integer spaces and follow every /lbs/{type}/view/{id} link.
--   * RAW-FIRST two-stage pipeline: this frontier + lbs_raw_records archive the HTML; parse/promote is a
--     separate, re-runnable pass (route persons through PersonService.findOrCreateLead with FULL
--     attributes per standard-external-source-ingest rule #3). Re-parse without re-crawling.
--   * DB IS TRUTH (feedback_verify_db_not_logs): progress = a GROUP BY on status, never a log tail.
--   * Kill/restart-safe: ON CONFLICT DO NOTHING is the visited-set; a watchdog resets stale 'fetching'.
--
-- NOTE: ext_id is TEXT — LBS person ids can be negative or > int4 (e.g. 2146630513, -368685485).

-- ── Frontier / visited-set: one row per (url_type, ext_id) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lbs_crawl_frontier (
    url_type        TEXT NOT NULL,           -- 'claim' | 'estate' | 'person' | 'firm'
    ext_id          TEXT NOT NULL,           -- the /view/{id} token (text; may be negative/huge)
    status          TEXT NOT NULL DEFAULT 'queued',
                                             -- queued | fetching | done | error | blocked | skipped
    discovered_from TEXT,                    -- e.g. 'seed' or 'claim:10894' (edge provenance)
    depth           INTEGER NOT NULL DEFAULT 0,
    http_status     INTEGER,
    attempts        INTEGER NOT NULL DEFAULT 0,
    s3_key          TEXT,                    -- archived raw HTML (S3), when fetched
    error           TEXT,
    claimed_at      TIMESTAMPTZ,             -- when a worker marked it 'fetching' (staleness reset key)
    fetched_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (url_type, ext_id),
    CONSTRAINT lbs_frontier_type_chk CHECK (url_type IN ('claim','estate','person','firm')),
    CONSTRAINT lbs_frontier_status_chk CHECK (status IN
        ('queued','fetching','done','error','blocked','skipped'))
);

-- pop next work item cheaply; find stale 'fetching' rows to reclaim
CREATE INDEX IF NOT EXISTS idx_lbs_frontier_status ON lbs_crawl_frontier (status);
CREATE INDEX IF NOT EXISTS idx_lbs_frontier_claimed ON lbs_crawl_frontier (claimed_at)
    WHERE status = 'fetching';

COMMENT ON TABLE lbs_crawl_frontier IS
  'UCL LBS crawl frontier + visited-set. Graph crawl over /lbs/{type}/view/{id}; resumable; '
  'ext_id is TEXT (LBS person ids can be negative/huge). See plan-ucl-lbs-scraper.md.';

-- ── Raw-record staging: archived HTML + (later) parsed JSON, one row per fetched page ───────────────
CREATE TABLE IF NOT EXISTS lbs_raw_records (
    url_type        TEXT NOT NULL,
    ext_id          TEXT NOT NULL,
    source_url      TEXT NOT NULL,           -- canonical https://www.ucl.ac.uk/lbs/{type}/view/{id}
    html_s3_key     TEXT,                    -- our S3 re-host of the raw HTML
    html_sha256     TEXT,
    source_artifact_id UUID REFERENCES source_artifacts(id) ON DELETE SET NULL,  -- Wayback/license row
    parsed          JSONB,                   -- normalized fields (filled by the parse pass)
    parse_version   INTEGER,                 -- bump to force a re-parse sweep
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    parsed_at       TIMESTAMPTZ,
    PRIMARY KEY (url_type, ext_id),
    CONSTRAINT lbs_raw_type_chk CHECK (url_type IN ('claim','estate','person','firm'))
);

CREATE INDEX IF NOT EXISTS idx_lbs_raw_unparsed ON lbs_raw_records (url_type)
    WHERE parsed IS NULL;

COMMENT ON TABLE lbs_raw_records IS
  'Raw-first LBS staging: archived HTML (html_s3_key) + Wayback/license (source_artifact_id) + parsed '
  'JSONB. Parse/promote is a separate re-runnable pass (route persons via PersonService, rule #3).';
