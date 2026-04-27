-- Migration 037: Participant Wealth Fingerprint
--
-- Adds corporate connection, trust/estate, family business, and inherited land
-- fields to participants table. These fields feed:
--   - TieredPaymentCalculator.CORPORATE_ADJUSTMENT (corporateConnection)
--   - WealthGapCalculator.calculateIndividualShare (wealth inputs)
--   - CorporateSuccessionTracer reverse lookup (corporate affiliations)
--
-- Without these fields, the DAA payment calculation falls back to flat 2%
-- of income, missing participants whose real wealth is in trusts, land,
-- or corporate positions tied to Farmer-Paellmann defendants.

-- ── Corporate Connection ────────────────────────────────────────────────
ALTER TABLE participants ADD COLUMN IF NOT EXISTS corporate_connections TEXT[];
-- Array of corporate_entities keys from CorporateSuccessionTracer.KNOWN_CHAINS
-- e.g., ARRAY['jpmorgan', 'aetna'] if participant has connections to both.
-- Populated from intake form checklist of Farmer-Paellmann defendants.

ALTER TABLE participants ADD COLUMN IF NOT EXISTS corporate_connection_type TEXT DEFAULT 'none';
-- Maps to TieredPaymentCalculator.CORPORATE_ADJUSTMENT:
--   'none'     = no known connection (1.0x)
--   'indirect' = employed by / stockholder of a defendant company (1.2x)
--   'direct'   = inherited wealth traceable to a defendant company (1.5x)
--   'owner'    = owns or controls a company with documented slavery ties (2.0x)

ALTER TABLE participants ADD COLUMN IF NOT EXISTS corporate_connection_details TEXT;
-- Free-text: "Board member at JPMorgan Chase since 2018" or
-- "Family trust holds CSX stock from grandfather's railroad career"

-- ── Trust & Estate ──────────────────────────────────────────────────────
ALTER TABLE participants ADD COLUMN IF NOT EXISTS trust_beneficiary TEXT DEFAULT 'no';
-- 'no', 'revocable', 'irrevocable', 'unsure'

ALTER TABLE participants ADD COLUMN IF NOT EXISTS trust_corpus DECIMAL(14,2);
-- Approximate total corpus of trust/estate (not just participant's share)

-- ── Family Business ─────────────────────────────────────────────────────
ALTER TABLE participants ADD COLUMN IF NOT EXISTS family_business_ownership TEXT DEFAULT 'no';
-- 'no', 'founded_in_lifetime', 'inherited_multigenerational', 'unsure'

ALTER TABLE participants ADD COLUMN IF NOT EXISTS family_business_details TEXT;
-- "Textile manufacturing, founded 1847" — sector + founding year

-- ── Inherited Land ──────────────────────────────────────────────────────
ALTER TABLE participants ADD COLUMN IF NOT EXISTS inherited_land_acres TEXT DEFAULT 'none';
-- 'none', 'under_500', '500_to_5000', 'over_5000', 'unsure'

ALTER TABLE participants ADD COLUMN IF NOT EXISTS inherited_land_states TEXT[];
-- States where inherited land is held (feeds county-level slave schedule lookup)

ALTER TABLE participants ADD COLUMN IF NOT EXISTS inherited_land_use TEXT[];
-- ARRAY subset of: 'timber', 'mineral_rights', 'agricultural', 'ranching',
-- 'residential_commercial', 'heir_property', 'other'

-- ── Executive/Board History ─────────────────────────────────────────────
ALTER TABLE participants ADD COLUMN IF NOT EXISTS executive_board_history TEXT;
-- "3 generations of banking executives" or "grandfather was Norfolk Southern VP"

-- ── Pre-1865 Family Business Continuity ─────────────────────────────────
ALTER TABLE participants ADD COLUMN IF NOT EXISTS pre_1865_business_continuity TEXT DEFAULT 'no';
-- 'no', 'yes', 'unsure'

ALTER TABLE participants ADD COLUMN IF NOT EXISTS pre_1865_business_details TEXT;
-- "Family plantation in Beaufort County SC, still operated as farm by cousins"

-- ── Computed Wealth Flag ────────────────────────────────────────────────
-- The system computes this from all financial + fingerprint fields.
-- TRUE if any of: trust corpus > $1M, inherited land > 500 acres,
-- corporate connection != 'none', pre-1865 continuity = 'yes',
-- or net_worth > 10x annual income.
ALTER TABLE participants ADD COLUMN IF NOT EXISTS wealth_flag_elevated BOOLEAN DEFAULT FALSE;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS wealth_flag_reasons TEXT[];

-- Index for elevated wealth participants (for admin triage)
CREATE INDEX IF NOT EXISTS idx_participants_wealth_flag ON participants(wealth_flag_elevated) WHERE wealth_flag_elevated = TRUE;

COMMENT ON COLUMN participants.corporate_connections IS 'Keys from CorporateSuccessionTracer.KNOWN_CHAINS — Farmer-Paellmann defendants self-reported by participant';
COMMENT ON COLUMN participants.corporate_connection_type IS 'Maps to TieredPaymentCalculator.CORPORATE_ADJUSTMENT: none/indirect/direct/owner';
COMMENT ON COLUMN participants.wealth_flag_elevated IS 'Auto-computed: TRUE if trust/land/corporate/pre-1865 signals indicate wealth beyond income';
