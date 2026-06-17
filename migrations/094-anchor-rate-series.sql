-- Migration 094: anchor_rate_series — provenance-tagged interest/return-rate
--                observations that the rate-resolver anchors compounding to.
--                (GitHub #83; anchor sources #84–#89; resolves #65, feeds #79.)
--
-- WHY: the compound/discount rate is a reference-class-indexed PARAMETER, not a
-- constant. Craemer (2015/2020) shows it dominates the result ($18.6T at 3% →
-- $6.2 quadrillion at 6%) and is "to be determined by negotiation." Law: prejudgment
-- interest = make-whole; default simple, COMPOUND for egregious wrongs; rate = the
-- harmed party's opportunity cost OR the wrongdoer's actual rate of return
-- (disgorgement), uncertainty burden on the wrongdoer. ICHEIC brought policies
-- forward at country long-term BOND rates. So we store rate OBSERVATIONS, each
-- tagged with the anchor FAMILY (which legal/economic question it answers), the
-- asset class, the place, the era, the source, and a confidence — and the resolver
-- picks the best-matching one per case, falling back to a labeled proxy.
--
-- This table is populated by the anchor-scraping fronts (#84–#89). Empty at first;
-- the resolver returns a labeled proxy until rows land, then sharpens automatically.
--
-- Anchor families (the relationships between anchors — nested by aggressiveness):
--   price_index        — CPI/commodity: purchasing-power floor (most conservative)
--   deposit_interest   — savings/passbook (Freedman's Bank): victim opportunity cost
--   bond_yield         — Treasury/govt long-term: risk-free opportunity cost (ICHEIC)
--   farmland_appreciation — asset-specific (land dispossession / 40 acres)
--   realized_return    — probate appraisal-vs-sale: wrongdoer's realized return
--   enterprise_roi     — plantation/commodity/slave-price: wrongdoer's gain (disgorgement)
--   statutory          — statutory prejudgment rate (legal anchor)
--
-- NO ROW INSERTS (no hardcoded rates — they enter via the scraping fronts).

CREATE TABLE IF NOT EXISTS anchor_rate_series (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- WHICH anchor question this rate answers (see families above).
    anchor_family TEXT NOT NULL,

    -- Reference-class dimensions the resolver matches on. NULL = wildcard
    -- (applies to any value of that dimension).
    asset_class   TEXT,              -- 'land','enslaved_labor','deposit','security','estate_nonchattel',...
    place_state   TEXT,              -- 2-letter or region; NULL = national
    place_region  TEXT,              -- 'south','northeast',... when finer than nation, coarser than state
    era           TEXT,              -- 'antebellum','reconstruction','jim_crow','modern' (optional)
    year_start    INTEGER,           -- inclusive range this observation applies to
    year_end      INTEGER,

    -- The observation itself.
    annual_rate   NUMERIC(8,5) NOT NULL,   -- e.g. 0.05000
    compounding   TEXT NOT NULL DEFAULT 'compound'  -- 'simple' | 'compound'
        CHECK (compounding IN ('simple','compound')),

    -- Provenance — every rate carries its source (project rule: no unsourced constants).
    source_name      TEXT NOT NULL,        -- 'Freedman''s Bank ledger', 'NBER macrohistory', 'USDA', ...
    source_url       TEXT,
    source_citation  TEXT,
    methodology_note TEXT,
    confidence    NUMERIC(3,2) DEFAULT 0.70,  -- 0..1

    -- Optional link back to the document/row this rate was extracted from.
    evidence_source_table TEXT,
    evidence_source_id    TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anchor_family ON anchor_rate_series(anchor_family);
CREATE INDEX IF NOT EXISTS idx_anchor_match  ON anchor_rate_series(anchor_family, asset_class, place_state, year_start, year_end);

COMMENT ON TABLE anchor_rate_series IS
  'Provenance-tagged interest/return-rate observations. The rate-resolver matches '
  '(predictor→anchor_family, asset_class, place, year) to the best observation and '
  'falls back to a labeled proxy when none matches. The compound rate is a '
  'reference-class-indexed PARAMETER disciplined by the calibration layer, never a '
  'silent global constant. Populated by anchor-scraping fronts (GitHub #84–#89).';
