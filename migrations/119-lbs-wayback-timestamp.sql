-- Migration 119: add wayback_ts to the LBS crawl frontier
-- Date: 2026-07-04
--
-- WHY: the live UCL site (M118) is behind a Cloudflare Turnstile that REFUSES the CDP-driven browser —
-- it never grants a durable cf_clearance, re-challenging every navigation (verified 2026-07-04, see
-- finding-ucl-lbs-source-and-scraper-research.md + activeContext). So the AUTONOMOUS path is the
-- Internet Archive (Wayback), which mirrors thousands of LBS pages and is NOT Cloudflare-protected.
--
-- The Wayback CDX API enumerates the exact archived record set + the best (HTTP 200) snapshot
-- timestamp per URL. We store that timestamp so the fetcher can pull the raw capture directly
-- (http://web.archive.org/web/{ts}id_/{url}) — resumable, deterministic, DB-is-truth.
--
-- Rows seeded 1..N by seed-ucl-lbs-frontier.mjs that are NOT archived keep wayback_ts NULL; the Wayback
-- fetcher only processes rows WHERE wayback_ts IS NOT NULL, so the two enumeration strategies coexist
-- (the seeded rows remain available for the live-site path if the dataset request or a future access
-- route reopens it).

ALTER TABLE lbs_crawl_frontier ADD COLUMN IF NOT EXISTS wayback_ts TEXT;

-- Fetch queue for the Wayback path: queued rows that ARE archived.
CREATE INDEX IF NOT EXISTS idx_lbs_frontier_wayback
    ON lbs_crawl_frontier (status)
    WHERE wayback_ts IS NOT NULL;

COMMENT ON COLUMN lbs_crawl_frontier.wayback_ts IS
  'Internet Archive snapshot timestamp (YYYYMMDDhhmmss) of the best HTTP-200 capture, from the CDX API. '
  'NULL = not archived (skip in Wayback mode). See migration 119 / ucl-lbs-wayback.mjs.';
