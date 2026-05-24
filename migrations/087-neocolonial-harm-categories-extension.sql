-- Migration 087: Neocolonial Harm Categories Extension
-- Date: 2026-05-23
-- Purpose: Extend reparations_harm_categories to support neocolonial-era harms
--          where the perpetrator may be a multilateral institution (IMF,
--          World Bank, BIS, WTO) rather than a single sovereign, and where
--          the extraction mechanism is structural-financial rather than
--          coercive-physical.
--
-- The new 'neocolonial' era value joins the existing 'antebellum',
-- 'reconstruction', 'jim_crow', 'modern' values.
--
-- Harm categories that will enter via contribute pipeline once the M085 pipe
-- extension (one-column extension of /promote/:leadId) is in place:
--   * haiti_double_debt        — France 1825 indemnity + Citibank/National
--                                 City Bank reroute via US occupation customs
--                                 receivership 1922-1947. NYT 'The Ransom'
--                                 series 2022. Modern obligation: French
--                                 Republic + Citigroup.
--   * cfa_franc_seigniorage    — 14 African states required to deposit 50-65%
--                                 of foreign reserves with French Treasury
--                                 1945-present. Modern beneficiary: Banque
--                                 de France.
--   * imf_sap_extraction       — Zaire 1976-78, Peru 1977, Mexico 1982,
--                                 Jamaica 1977, Ghana 1983, Tanzania 1986,
--                                 Argentina 2001. Primary sources: IMF
--                                 Article IV consultation papers.
--   * tariff_escalation        — UNCTAD Trade and Development Report (annual
--                                 since 1981). EU/US/Japan MFN schedules:
--                                 ~0% raw materials → 15-40% processed goods
--                                 for cocoa, palm oil, coffee, cotton,
--                                 fertilizer precursors.
--   * vulture_fund_litigation  — Elliott Associates v. Peru; NML v. Argentina.
--                                 Modern entities: Elliott Management /
--                                 Paul Singer.
--
-- NO ROW INSERTS for the harm categories themselves — those enter via
-- contribute pipeline.

ALTER TABLE reparations_harm_categories
    ADD COLUMN IF NOT EXISTS perpetrating_multilateral VARCHAR(100),
    ADD COLUMN IF NOT EXISTS extraction_mechanism VARCHAR(100);

COMMENT ON COLUMN reparations_harm_categories.era IS 'Era of the harm. Accepted values: antebellum, reconstruction, jim_crow, modern, neocolonial. Neocolonial extends the framework to post-1945 structural-financial extraction (IMF SAPs, tariff escalation, CFA franc reserve seigniorage, vulture-fund litigation, sovereign debt buybacks).';
COMMENT ON COLUMN reparations_harm_categories.perpetrating_multilateral IS 'Multilateral institution responsible when there is no single sovereign perpetrator: IMF, World Bank, BIS, WTO, EU, OECD. Used for neocolonial-era harm categories where extraction is structural-financial.';
COMMENT ON COLUMN reparations_harm_categories.extraction_mechanism IS 'How the extraction operates. Distinguishes structural-financial mechanisms from coercive-physical ones. Lets the platform compute and present continuities — e.g., manufactured_goods_dependency in 1750 (actor_roles row) and tariff_escalation in 2026 (this column) are the same structural pattern at different scales. Vocabulary: currency_devaluation, tariff_escalation, reserve_seigniorage, sovereign_debt_buyback, structural_adjustment, vulture_litigation, export_dumping, manufactured_goods_dependency.';
