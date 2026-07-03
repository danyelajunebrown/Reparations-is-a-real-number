-- Migration 112: properties — the PARCEL ANCHOR for land chain-of-title
-- Date: 2026-07-02
-- Purpose (BB-1 pivot): land_transfer_events.property_id has been a bare, unpopulated UUID because the
--   parcel anchor never existed (migration 007's `properties` was never applied and its FKs point at
--   absent tables). This creates a FOCUSED anchor: a single identity for a physical parcel that many
--   transfer rows (deeds across time) point to — the spine that lets a grantor->grantee chain resolve to
--   ONE parcel and, eventually, a modern parcel number.
--
-- KEY INSIGHT the pivot rests on: a WILL bequest ("the farm in Fannington") is NOT parcel-identifying; a
--   DEED carries a recorded legal description (platted lot/block/subdivision) + a liber/folio recording
--   reference, which IS traceable through the county grantor-grantee index. So the anchor's identity
--   fields are deed-shaped (legal_description, liber_folio), with modern_parcel_apn/geometry nullable
--   until the (largely manual/browser) county-index + georeferencing work fills them.
--
-- Additive only. No data. Rerunnable (IF NOT EXISTS / guarded FK).

CREATE TABLE IF NOT EXISTS properties (
    property_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- historical identity (as recorded)
    property_name          TEXT,                    -- tract/plantation name as recorded ("Holmead's addition")
    alternate_names        TEXT[],
    property_type          TEXT,                     -- plantation | quarter | farm | lot | tract | tenement
    -- PARCEL IDENTITY (deed-shaped — what makes a parcel traceable)
    legal_description      TEXT,                     -- platted "Lots 47 & 48 in Holmead's addition", or metes-and-bounds
    lot                    TEXT,
    block                  TEXT,
    subdivision            TEXT,
    liber_folio            TEXT,                     -- recording reference, e.g. "Liber J.A.S. No. 104 folios 124-128"
    metes_and_bounds       TEXT,
    -- location
    county                 TEXT,
    state                  TEXT,
    location_description   TEXT,
    acreage                NUMERIC,
    -- plantation -> quarter hierarchy
    parent_property_id     UUID REFERENCES properties(property_id) ON DELETE SET NULL,
    -- FORWARD CONTINUITY anchor (nullable until county-index / georeferencing fills them)
    modern_parcel_apn      TEXT,                     -- assessor's parcel number (modern)
    modern_jurisdiction    TEXT,
    geometry_wkt           TEXT,                     -- georeferenced boundary (WKT), when available
    georeference_method    TEXT,                     -- how the modern link was established (audit trail)
    -- provenance
    source_document_id     INTEGER,                  -- person_documents.id of the establishing instrument
    source_archive         TEXT,
    confidence             NUMERIC DEFAULT 0.70,
    requires_human_review  BOOLEAN DEFAULT TRUE,
    notes                  TEXT,
    created_at             TIMESTAMP DEFAULT NOW(),
    updated_at             TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_properties_county_state ON properties(state, county);
CREATE INDEX IF NOT EXISTS idx_properties_apn ON properties(modern_parcel_apn) WHERE modern_parcel_apn IS NOT NULL;

-- Wire the previously-dangling land_transfer_events.property_id -> properties(property_id).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'land_transfer_events_property_id_fkey') THEN
    ALTER TABLE land_transfer_events
      ADD CONSTRAINT land_transfer_events_property_id_fkey
      FOREIGN KEY (property_id) REFERENCES properties(property_id) ON DELETE SET NULL;
  END IF;
END $$;
