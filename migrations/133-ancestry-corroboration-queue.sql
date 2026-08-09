-- 133 — ancestry_corroboration_queue: the bot-driven worklist for human-actuated Ancestry corroboration.
--
-- User directive (2026-08-09): the bot DRIVES (queue, search-generation, notify, ingest, crosswalk, corroborate,
-- track); the human ACTUATES one step (running the search in their own browser + exporting) — that keeps the
-- ToS/ALE line (no automated ACCESS to Ancestry) while solving "there's no way I can trigger billions of searches
-- and stay organized." No Ancestry data is stored — only FACTS corroborated + POINTERS to FREE primary sources.

CREATE TABLE IF NOT EXISTS ancestry_corroboration_queue (
  id                  BIGSERIAL PRIMARY KEY,
  canonical_person_id INTEGER,                 -- who we're corroborating
  person_name         TEXT,
  search_url          TEXT,                    -- the ancestrylibrary.com search the HUMAN opens (never the bot)
  what_to_confirm     TEXT,                    -- checklist the bot generated (birth yr, parentage, 1862 petition…)
  priority            INTEGER DEFAULT 100,     -- lower = sooner (DAA anchors / ambiguous identities first)
  status              TEXT DEFAULT 'pending',  -- pending → notified → captured → done | skipped
  result              JSONB,                   -- {records:[…], corroborations:[…], redirects:[…]} from the export
  notified_at         TIMESTAMPTZ,
  captured_at         TIMESTAMPTZ,
  done_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ancestry_queue_person ON ancestry_corroboration_queue(canonical_person_id);
CREATE INDEX IF NOT EXISTS idx_ancestry_queue_status ON ancestry_corroboration_queue(status, priority);

-- Redirects the bot discovers: "Ancestry says a record exists → go pull the FREE primary source from here."
CREATE TABLE IF NOT EXISTS source_redirect_leads (
  id                  BIGSERIAL PRIMARY KEY,
  canonical_person_id INTEGER,
  ancestry_collection TEXT,                    -- what Ancestry called it (finding-aid pointer only)
  free_source         TEXT,                    -- familysearch | civilwardc | nara | archive_org | findagrave | …
  free_target         TEXT,                    -- collection id / URL / search to run at the FREE source
  our_pipeline        TEXT,                    -- which of our ingesters handles it
  status              TEXT DEFAULT 'queued',   -- queued → pulled | have_already | unavailable
  note                TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_source_redirect_status ON source_redirect_leads(status, free_source);

COMMENT ON TABLE ancestry_corroboration_queue IS
  'Bot-driven, human-actuated. The bot generates searches + ingests the human export; the human is the only one who ACCESSES Ancestry (ToS/ALE line). Stores facts + free-source pointers, never Ancestry content.';
