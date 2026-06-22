-- Migration 098: chattel_transfer_events — the enslaver→enslaver HUMAN-CHATTEL
--                transfer primitive (the holdings-continuity edge).
--
-- WHY (user direction, Jun 21): the reparations claim is CONTINUITY OF HOLDING —
-- an unbroken, documented chain from extraction → continuously-held value → present
-- holder. land_transfer_events covers LAND; wealth_transfer_events covers
-- bankruptcy/foreclosure; entity_successions covers CORPORATE entities. None covers
-- the most basic continuity edge: enslaver A sold/bequeathed enslaved person X to
-- enslaver B for a price. That sale moved slavery-derived value between named
-- enslavers; chaining these forward (with land + business + corporate transfers)
-- toward present holders is the continuity spine.
--
-- The Hall Louisiana DB alone yields ~49K priced such transfers (1719–1820).
-- This is the human-chattel analog of land_transfer_events: grantor→grantee+value,
-- plus the enslaved person whose sale price IS the transferred value.
--
-- Additive. NO ROW INSERTS (populated by scripts/build-hall-transfers.mjs etc.).

CREATE TABLE IF NOT EXISTS chattel_transfer_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The enslaved person transferred (the value carrier). Canonical where resolved.
    enslaved_person_id INTEGER REFERENCES canonical_persons(id) ON DELETE SET NULL,
    enslaved_name_text TEXT,

    -- The two enslaver parties (the continuity edge: value flows from → to).
    from_enslaver_id INTEGER REFERENCES canonical_persons(id) ON DELETE SET NULL,
    from_enslaver_name TEXT,
    to_enslaver_id INTEGER REFERENCES canonical_persons(id) ON DELETE SET NULL,
    to_enslaver_name TEXT,

    transfer_type TEXT,                  -- 'sale','estate_sale','inheritance','mortgage','seizure',...
    transfer_year INTEGER,
    transfer_date TEXT,

    -- Value (nominal, in the document's currency — NOT USD; Hall used piastre/peso/livre/$).
    value_amount NUMERIC(14,2),
    value_currency TEXT,                 -- decoded: piastre/peso/livre/us_dollar/...
    value_usd_equiv NUMERIC(14,2),       -- when convertible (Hall INVVALP/SALEVALP common-denominator)

    place_state TEXT,
    place_locality TEXT,                 -- parish

    -- Provenance.
    source_table TEXT,
    source_external_system TEXT,         -- 'hall_louisiana'
    source_external_id TEXT,             -- record_index / docno
    source_citation TEXT,
    confidence NUMERIC(3,2) DEFAULT 0.75,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (source_external_system, source_external_id, transfer_type)
);

CREATE INDEX IF NOT EXISTS idx_chattel_from ON chattel_transfer_events(from_enslaver_id);
CREATE INDEX IF NOT EXISTS idx_chattel_to ON chattel_transfer_events(to_enslaver_id);
CREATE INDEX IF NOT EXISTS idx_chattel_enslaved ON chattel_transfer_events(enslaved_person_id);
CREATE INDEX IF NOT EXISTS idx_chattel_year ON chattel_transfer_events(transfer_year);

COMMENT ON TABLE chattel_transfer_events IS
  'Enslaver→enslaver human-chattel transfer (sale/estate-sale/inheritance) — the '
  'holdings-continuity primitive. Each row: enslaved person X moved from enslaver A '
  'to enslaver B for a documented value. Chaining these (+ land/business/corporate '
  'transfers) toward present holders is the continuity-of-holding spine of the '
  'reparations claim. Hall Louisiana DB seeds ~49K priced transfers (1719–1820).';
