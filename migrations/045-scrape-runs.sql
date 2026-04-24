-- 045: scrape_runs — per-branch run state queryable from any machine.
-- So "where's Memphis?" is a SQL query, not an SSH tail.

CREATE TABLE IF NOT EXISTS scrape_runs (
    id               SERIAL PRIMARY KEY,
    runner           TEXT NOT NULL,          -- 'freedmens-full-11', 'climber', etc.
    branch           TEXT NOT NULL,          -- 'Memphis, Tennessee' | 'P4RF-PFQ' etc.
    host             TEXT NOT NULL,          -- hostname of machine doing work
    pid              INTEGER,
    status           TEXT NOT NULL,          -- running | done | crashed | killed
    started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at      TIMESTAMPTZ,
    exit_code        INTEGER,
    pages_ocrd       INTEGER DEFAULT 0,
    records_parsed   INTEGER DEFAULT 0,
    matches          INTEGER DEFAULT 0,
    db_updates       INTEGER DEFAULT 0,
    errors           INTEGER DEFAULT 0,
    last_heartbeat   TIMESTAMPTZ,
    last_log_tail    TEXT,                   -- last ~2KB of log for quick inspection
    metadata         JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_scrape_runs_runner_status ON scrape_runs(runner, status);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_started_at ON scrape_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_active ON scrape_runs(runner, branch) WHERE status = 'running';
