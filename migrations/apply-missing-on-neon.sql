-- ============================================================================
-- One-shot script for missing migrations on Neon (Apr 13, 2026)
-- ============================================================================
--
-- Why this exists:
--   The live Render API returns 500 for every /api/legal/* endpoint and for
--   /api/corporate-debts/farmer-paellmann/by-sector. Investigation showed that
--   migration 031 (Triangle Trade legal framework) was never applied to the
--   Neon database, and the defendants_by_sector view from migration 021 is
--   also missing.
--
-- What this does:
--   1. Runs migration 031 in full (idempotent — uses CREATE TABLE IF NOT EXISTS
--      and CREATE OR REPLACE VIEW throughout, safe to re-run)
--   2. Re-creates the defendants_by_sector view from migration 021
--
-- How to run:
--   Option A — Neon SQL Editor (easiest):
--     1. Open https://console.neon.tech and select your project
--     2. Click "SQL Editor" in the left sidebar
--     3. Paste the contents of:
--          migrations/031-triangle-trade-legal-framework.sql
--        Run it. Then paste this entire file and run it.
--
--   Option B — psql from your machine:
--     psql "$DATABASE_URL" -f migrations/031-triangle-trade-legal-framework.sql
--     psql "$DATABASE_URL" -f migrations/apply-missing-on-neon.sql
--
--   Option C — node script (if you have a one-shot runner):
--     node -e "const {neon}=require('@neondatabase/serverless');const fs=require('fs');const sql=neon(process.env.DATABASE_URL);(async()=>{const m31=fs.readFileSync('migrations/031-triangle-trade-legal-framework.sql','utf8');const m21v=fs.readFileSync('migrations/apply-missing-on-neon.sql','utf8');await sql(m31);await sql(m21v);console.log('done');})()"
--
-- After running, verify with:
--   curl https://reparations-platform.onrender.com/api/legal/uk-1833
--   curl https://reparations-platform.onrender.com/api/corporate-debts/farmer-paellmann/by-sector
-- Both should return 200.
-- ============================================================================

-- defendants_by_sector view (from migration 021, never created on Neon)
CREATE OR REPLACE VIEW defendants_by_sector AS
SELECT
    entity_type AS sector,
    COUNT(*) AS defendant_count,
    ARRAY_AGG(modern_name ORDER BY modern_name) AS defendants,
    SUM(CASE WHEN self_concealment_alleged THEN 1 ELSE 0 END) AS concealment_alleged_count,
    SUM(CASE WHEN misleading_statements_alleged THEN 1 ELSE 0 END) AS misleading_alleged_count
FROM corporate_entities
WHERE is_farmer_paellmann_defendant = TRUE
GROUP BY entity_type
ORDER BY defendant_count DESC;

-- Verification queries — run these manually after to confirm
-- SELECT 'legal_jurisdictions' AS rel, COUNT(*) FROM legal_jurisdictions
-- UNION ALL SELECT 'legal_doctrines', COUNT(*) FROM legal_doctrines
-- UNION ALL SELECT 'garnishment_mechanisms', COUNT(*) FROM garnishment_mechanisms
-- UNION ALL SELECT 'uk_1833_compensation', COUNT(*) FROM uk_1833_compensation
-- UNION ALL SELECT 'haiti_independence_debt', COUNT(*) FROM haiti_independence_debt
-- UNION ALL SELECT 'farmer_paellmann_analysis', COUNT(*) FROM farmer_paellmann_analysis
-- UNION ALL SELECT 'defendants_by_sector', COUNT(*) FROM defendants_by_sector;
