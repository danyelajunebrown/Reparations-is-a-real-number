-- 130-participants-safe-view-and-lineage-hint.sql
--
-- Two changes, both consequences of the 2026-08-03 PII review.
--
-- (1) participants_safe — a de-identified view of participants.
--     Participant PII (names, DOB, addresses, email, exact financial figures) must not
--     enter an LLM's context; see .claude/hooks/block-pii-access.mjs. But debugging the
--     intake pipeline needs SOME shape: how many participants, from which states, roughly
--     what wealth band, how far through the pipeline. This view is that shape with every
--     identifier removed and every dollar figure bucketed. It is what the model is allowed
--     to read.
--
--     Deliberately ABSENT: full_name, email, date_of_birth, birthplace, address_*,
--     self_fs_id, other_names_used, and all raw dollar amounts.
--
-- (2) participant_family.lineage_hint — the form's "Whom is their child or inheritor?"
--     answer, verbatim.
--     The intake form presents relatives as "Parent 1/2" and "Grandparent 1-4" — no sex,
--     no lineage. The webhook nonetheless wrote fixed positional labels (father, mother,
--     pat_grandfather, …). Checked against the 2026-08-03 export that mislabels a majority
--     of rows: 4 of 6 submissions have a woman in the 'father' slot and a woman in the
--     'pat_grandfather' slot. Storing the participant's own answer — rather than inferring
--     from position — is the only non-fabricating option, and unanswered stays NULL.

-- ── (1) De-identified participant view ──────────────────────────────────────
CREATE OR REPLACE VIEW participants_safe AS
SELECT
    p.id,
    p.intake_source,
    p.intake_date,
    p.roles,
    p.address_state                                    AS state,
    -- Birth DECADE, never the date. Enough to sanity-check a generation gap.
    CASE WHEN p.date_of_birth IS NOT NULL
         THEN (EXTRACT(YEAR FROM p.date_of_birth)::int / 10) * 10 END AS birth_decade,
    -- Presence flags, not values.
    (p.email IS NOT NULL)                              AS has_email,
    (p.self_fs_id IS NOT NULL)                         AS has_self_fs_id,
    p.self_is_living,
    -- Coarse income band. Bucketed so no row is re-identifiable from a figure.
    CASE
        WHEN p.annual_income IS NULL       THEN NULL
        WHEN p.annual_income <  25000      THEN 'under_25k'
        WHEN p.annual_income <  50000      THEN '25k_50k'
        WHEN p.annual_income < 100000      THEN '50k_100k'
        WHEN p.annual_income < 250000      THEN '100k_250k'
        ELSE                                    'over_250k'
    END                                                AS income_band,
    CASE
        WHEN p.estimated_net_worth IS NULL   THEN NULL
        WHEN p.estimated_net_worth <  10000  THEN 'under_10k'
        WHEN p.estimated_net_worth < 100000  THEN '10k_100k'
        WHEN p.estimated_net_worth < 1000000 THEN '100k_1m'
        ELSE                                      'over_1m'
    END                                                AS net_worth_band,
    -- Wealth-fingerprint categoricals are already non-identifying.
    p.corporate_connection_type,
    p.trust_beneficiary,
    p.inherited_land_acres,
    p.pre_1865_business_continuity,
    p.wealth_flag_elevated,
    p.wealth_flag_reasons,
    -- Pipeline shape.
    (SELECT count(*)::int FROM participant_family f WHERE f.participant_id = p.id)                          AS family_rows,
    (SELECT count(*)::int FROM participant_family f WHERE f.participant_id = p.id AND f.fs_id IS NOT NULL)   AS family_rows_with_fs_id,
    (SELECT count(*)::int FROM participant_family f WHERE f.participant_id = p.id AND f.is_living IS FALSE)  AS family_rows_deceased
FROM participants p;

COMMENT ON VIEW participants_safe IS
  'De-identified participants. The ONLY participant view an LLM context may read — see .claude/hooks/block-pii-access.mjs. No names, no DOB, no address, no email, no FS IDs, no raw dollar figures.';

-- ── (2) Verbatim lineage hint ───────────────────────────────────────────────
ALTER TABLE participant_family ADD COLUMN IF NOT EXISTS lineage_hint TEXT;
COMMENT ON COLUMN participant_family.lineage_hint IS
  'Verbatim answer to the form''s "Whom is their child or inheritor?" (e.g. "Parent 1"). The form does not state a relative''s sex or which parent they belong to, so relationship labels must NOT be inferred from column position — that mislabels a majority of rows. NULL when unanswered.';

-- Position within the form, so a neutral label ("grandparent_2") stays traceable
-- to the block it came from without re-reading the CSV.
ALTER TABLE participant_family ADD COLUMN IF NOT EXISTS source_block_index INTEGER;
COMMENT ON COLUMN participant_family.source_block_index IS
  'Zero-based ordinal of the person block in the intake sheet (0=Parent 1 … 5=Grandparent 4). Provenance for the neutral relationship label.';
