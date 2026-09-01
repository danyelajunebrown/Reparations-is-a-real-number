-- Migration 125: Indigenous land provenance + the land NON-CLAIM rule
-- Date: 2026-07-18
--
-- USER DIRECTIVE (2026-07-17): DAAs for Dutchess enslavers/enslaved must be "cognizant of wealth
-- over time" but "make NO claim to the land of the Native peoples — that ought to be restituted
-- SEPARATELY." Recorded decision: land is a VALUATION INSTRUMENT (it measures enslaver wealth over
-- time) but NEVER a claimed asset in a descendant DAA. See
-- memory-bank/finding-land-nonclaim-and-dutchess-audit-jul17.md §1,§3 and wealth-tracing-framework.md.
--
-- The active wrong this fixes: DisgorgementCalculator.forEnslaver sums land_transfer_events
-- consideration into the disgorgement total that flows to the descendant lineage ledger — i.e. the
-- system already monetizes land (incl. ceded Muscogee/Wampanoag/Mohican-Munsee ground) into a
-- reparations obligation collectible by a descendant. This table + the calculator split stop that:
-- land value is tagged with its Indigenous origin and routed to a SEPARATE restitution class owed to
-- the Native nation, never to the enslaved-descendant.
--
-- This is the schema anchor for "Link 0" — the fact that a chain of title does NOT bottom out in a
-- legitimate title (the enslaver's patent traces to a Native cession), which the "land-primary"
-- wealth-tracing methodology had no representation for.

CREATE TABLE IF NOT EXISTS indigenous_land_provenance (
    id                  SERIAL PRIMARY KEY,

    -- Scope: attach to a specific parcel (properties.property_id) OR a region (county/state) when the
    -- Indigenous origin is established at that granularity (a patent covering a whole tract).
    property_id         UUID,                       -- properties(property_id), nullable
    region_type         TEXT,                       -- 'county' | 'state' | 'patent' | 'parcel'
    county              TEXT,
    state               TEXT,

    -- The Native owners the land was taken from (as recorded + the modern successor nation).
    native_nation       TEXT[] NOT NULL,            -- e.g. {Muhheaconneok (Mohican), Munsee (Sepasco-Esopus)}
    successor_nation    TEXT,                        -- e.g. 'Stockbridge-Munsee Community'
    original_owners_as_recorded TEXT,                -- literal grantors, e.g. 'Aran Kee, Kreme Much, Korra Kee'

    -- The instrument in which the title originates (the patent/deed that recites the cession).
    origin_instrument   TEXT,                        -- '1688 Schuyler Patent'
    origin_reference    TEXT,                        -- 'NYS Archives, Endorsed Land Papers Vol XLIV p.31'
    cession_recital     TEXT,                        -- 'Purchased of and from the Indyans, Naturall Owners & Possessors'
    consideration_recorded TEXT,                     -- 'guns, kettles, blankets, 40 fathoms of wampum, rum' (1686 Rhinebeck deed)

    -- The NON-CLAIM rule, made explicit + enforceable in code.
    claim_disposition   TEXT NOT NULL DEFAULT 'restituted_separately_to_native_nation',
    descendant_claimable BOOLEAN NOT NULL DEFAULT FALSE,   -- land value is NEVER descendant-claimable

    source_url          TEXT,
    confidence          NUMERIC DEFAULT 0.85,
    notes               TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_indig_prov_region ON indigenous_land_provenance(state, county);
CREATE INDEX IF NOT EXISTS idx_indig_prov_property ON indigenous_land_provenance(property_id) WHERE property_id IS NOT NULL;

COMMENT ON TABLE indigenous_land_provenance IS
  'Link 0: the Indigenous origin of a chain of title. Land value derived from these regions/parcels '
  'is VALUATION CONTEXT for enslaver wealth over time but is NEVER claimable by an enslaved-descendant '
  '(descendant_claimable=FALSE); it is owed to the Native nation and restituted SEPARATELY. '
  'DisgorgementCalculator routes land value to native_land_restitution_usd, out of descendant_claimable_usd.';

-- Seed the Dutchess County / Massena origin (from the user-supplied Massena Chain of Title packet).
INSERT INTO indigenous_land_provenance
  (region_type, county, state, native_nation, successor_nation, original_owners_as_recorded,
   origin_instrument, origin_reference, cession_recital, consideration_recorded, source_url, notes)
SELECT 'county', 'Dutchess', 'New York',
       ARRAY['Muhheaconneok (Mohican)','Munsee (Sepasco-Esopus)'],
       'Stockbridge-Munsee Community',
       'Aran Kee, Kreme Much, Korra Kee (1686 Rhinebeck Indian deed grantors)',
       '1688 Schuyler Patent (Gov. Thomas Dongan to Col. Peter Schuyler)',
       'NYS Archives, Endorsed Land Papers (A0272) Vol. XLIV p.31 (44:31)',
       'Purchased of and from the Indyans, Naturall Owners & Possessors',
       'trade goods: guns, kettles, blankets, 40 fathoms of wampum, rum (1686 Rhinebeck deed)',
       'Massena Chain of Title packet (Barrytown, Town of Red Hook, Dutchess County)',
       'Barrytown/Red Hook parcel is the Massena property (Bard College); the Beekman/Livingston '
       || 'enslaver families in this county hold under this patent. Land value from Dutchess enslaver '
       || 'lineages is Native-restitution class, NOT descendant-claimable.'
WHERE NOT EXISTS (SELECT 1 FROM indigenous_land_provenance WHERE county='Dutchess' AND state='New York');
