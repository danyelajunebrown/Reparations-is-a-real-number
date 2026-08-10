-- Migration 137: The obligation ledger — accounts, append-only entries, derived balances
-- Date: 2026-08-09
-- Standard: memory-bank/standard-obligation-ledger.md (§2 non-negotiables, §3 entry types,
--           §4 reached-class test, §6 schema)
--
-- WHAT THIS IS FOR
--   The project computes an ESTIMATE. `enslaver_lineage_ledger` holds a per-lineage figure recomputed
--   from three predictors and reconciled by ObligationReconciler; recompute it tomorrow with better data
--   and yesterday's figure is gone. An estimate is an opinion. A ledger is an ACCOUNT: entries, in order,
--   each dated and cited, producing a balance auditable backward entry by entry. Interest accrues on a
--   balance. There was no balance.
--
-- WHAT IT DOES NOT DO
--   It does not change a single dollar figure. ObligationReconciler, Craemer, the disgorgement floor and
--   the land split are untouched; they become the cited METHODOLOGY of an opening entry (principal_basis
--   = 'modeled'). Nothing is migrated into this ledger by this file.
--
-- NO ROW INSERTS. Accounts are opened deliberately, with evidence, one at a time.
--
-- Idempotent. Additive. Nothing existing is altered.

BEGIN;

-- ===========================================================================
-- 1. ACCOUNTS
-- ===========================================================================

CREATE TABLE IF NOT EXISTS obligation_accounts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- §2.1 THE VECTOR RULE. An obligation is a DIRECTED edge between two parties, originating in a
    -- specific documented act. CREDIT (owed TO, as enslaved) and DEBIT (owed BY, as enslaver) are
    -- different obligations with different counterparties and different origin-acts. A person may hold
    -- both (William Ellison). They are NEVER summed into a per-person net. Direction lives on the
    -- ACCOUNT, so a single account structurally cannot mix them.
    direction           TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),

    regime_key          TEXT,          -- -> extraction_regimes.regime_key (M136). No FK yet; that table
                                       -- is empty by design (regimes arrive via the contribute pipeline).

    origin_act_kind     TEXT NOT NULL, -- 'documented_holding' | 'priced_transfer' | 'compensation_award' | ...
    origin_year         INTEGER,
    origin_document_id  INTEGER REFERENCES person_documents(id),

    -- Polymorphic party refs. TEXT because the pool is mixed-typed: canonical_persons.id is INTEGER,
    -- corporate_entities.entity_id is UUID. Deliberately no FK; code owns cleanup, per the M101 policy.
    debtor_party_table  VARCHAR(48) NOT NULL,   -- 'canonical_persons' | 'corporate_entities' | ...
    debtor_party_id     TEXT NOT NULL,
    payee_party_table   VARCHAR(48),
    payee_party_id      TEXT,

    -- §5. 'documented_pending' is a LEGITIMATE, HONEST account state: the debit is documented, the
    -- counterparty is not yet identified. This is the normal state for most Southern lineages and must
    -- never be treated as an error.
    payee_class         TEXT NOT NULL DEFAULT 'documented_pending'
                        CHECK (payee_class IN ('documented_claimant', 'documented_pending',
                                               'native_nation', 'unresolved')),

    -- §1.5.3 Per-regime valuation is mandatory and never transferred across regimes.
    methodology_id      UUID REFERENCES estimation_methodology_registry(id),

    status              TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'succeeded', 'satisfied', 'suspended')),
    opened_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at           TIMESTAMPTZ,
    produced_by         TEXT,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_obligation_accounts_debtor
    ON obligation_accounts(debtor_party_table, debtor_party_id);
CREATE INDEX IF NOT EXISTS idx_obligation_accounts_direction ON obligation_accounts(direction, status);
CREATE INDEX IF NOT EXISTS idx_obligation_accounts_regime ON obligation_accounts(regime_key);

COMMENT ON TABLE obligation_accounts IS
  'One directed obligation = one account (standard-obligation-ledger.md §2.1). Direction lives here so a single account cannot mix credit and debit. A dual-status party (enslaved-then-enslaver) gets TWO accounts with different counterparties; they are never netted.';

-- ===========================================================================
-- 2. ENTRIES — APPEND-ONLY
-- ===========================================================================

CREATE TABLE IF NOT EXISTS obligation_entries (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id          UUID NOT NULL REFERENCES obligation_accounts(id) ON DELETE RESTRICT,
    entry_seq           INTEGER NOT NULL,          -- monotonic per account; auto-assigned by trigger

    -- §3. NOTE WHAT IS ABSENT: there is no 'assignment' or 'transfer_of_claim' entry type, and there
    -- never will be. §2.4 — a recorded claim may be INHERITED; it may never be assigned, sold, pledged,
    -- factored, or used as collateral. A fungible reparations claim reconstructs the very instrument
    -- that made slavery financeable. The absence of that entry type IS the guardrail.
    entry_type          TEXT NOT NULL CHECK (entry_type IN (
                            'origination', 'accrual', 'succession',
                            'satisfaction', 'offset_claimed', 'offset_adjudicated', 'correction')),

    effective_date      DATE NOT NULL,
    amount_usd          NUMERIC(20, 2),
    currency_year       INTEGER,

    -- §2.4b THE ANTI-LAUNDERING COLUMN. An account structure does not make an estimate into evidence.
    --   'transaction_documented' — amount from a dated priced instrument about THIS person/estate
    --                              (chattel_transfer_events, probate appraisal, LBS award, civilwardc
    --                              claimed/awarded, insurance face value, estate inventory line)
    --   'modeled'                — amount from a category-level methodology (Craemer, SCF wealth-gap,
    --                              a line-item formula). Legitimate, cited, and NEVER silently
    --                              equivalent to the above.
    -- Measured 2026-08-09: reparations_line_items = 1,970,245 rows holding 86 distinct dollar values
    -- (freedmans_bank_direct_loss: 89,406 rows, ONE value). chattel_transfer_events = 48,985 rows
    -- holding 1,486 distinct values, all priced and all linked to an enslaver.
    principal_basis     TEXT CHECK (principal_basis IN ('transaction_documented', 'modeled')),

    rate_basis          TEXT,                      -- accrual only
    rate_anchor_id      TEXT,                      -- cited series; never a bare constant (audit rule 4)

    counterparty_table  VARCHAR(48),               -- succession only
    counterparty_id     TEXT,

    asset_kind          TEXT CHECK (asset_kind IN ('cash', 'land', 'securities', 'in_kind', 'programmatic')),

    -- §4 THE REACHED-CLASS TEST. Default is 'no'. An entry earns 'yes' only when value reached parties
    -- this project can NAME as members of the documented claimant class. A fund the payer controls has
    -- not paid; it has budgeted.
    recipient_kind      TEXT CHECK (recipient_kind IN ('documented_claimant', 'descendant_organization',
                                                       'proxy_population', 'general_public',
                                                       'payer_controlled_fund')),
    reached_class       TEXT CHECK (reached_class IN ('yes', 'partial', 'no', 'undetermined')),
    documented_claimants_identified INTEGER,
    documented_claimants_receiving  INTEGER,

    -- §2.3 every entry carries a row, a document, and a methodology — or an explicit null-result finding.
    source_document_id  INTEGER REFERENCES person_documents(id),
    research_finding_id INTEGER,                   -- -> research_findings (M128)
    methodology_id      UUID REFERENCES estimation_methodology_registry(id),

    -- §2.5 land-as-satisfaction is UNRESOLVED. Such an entry is POSTED but must not reduce the balance.
    doctrine_open       TEXT,                      -- e.g. 'land_as_satisfaction'

    corrects_entry_id   UUID REFERENCES obligation_entries(id),
    produced_by         TEXT,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_obligation_entry_seq UNIQUE (account_id, entry_seq),

    -- §2.4b an origination MUST declare its basis (monitor invariant 8)
    CONSTRAINT chk_origination_declares_basis
        CHECK (entry_type <> 'origination' OR principal_basis IS NOT NULL),
    -- audit rule 4: an accrual MUST name its rate basis
    CONSTRAINT chk_accrual_declares_rate
        CHECK (entry_type <> 'accrual' OR rate_basis IS NOT NULL),
    -- §4: anything claiming to have repaired something MUST answer "did it reach the class?"
    CONSTRAINT chk_satisfaction_declares_reach
        CHECK (entry_type NOT IN ('satisfaction', 'offset_adjudicated')
               OR (recipient_kind IS NOT NULL AND reached_class IS NOT NULL)),
    -- §4: 'yes' is not assertable without a count of who actually received
    CONSTRAINT chk_reached_yes_needs_count
        CHECK (reached_class <> 'yes' OR documented_claimants_receiving IS NOT NULL),
    -- a correction must say what it corrects
    CONSTRAINT chk_correction_references
        CHECK (entry_type <> 'correction' OR corrects_entry_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_obligation_entries_account ON obligation_entries(account_id, entry_seq);
CREATE INDEX IF NOT EXISTS idx_obligation_entries_type ON obligation_entries(entry_type);
CREATE INDEX IF NOT EXISTS idx_obligation_entries_basis ON obligation_entries(principal_basis);
CREATE INDEX IF NOT EXISTS idx_obligation_entries_doctrine ON obligation_entries(doctrine_open)
    WHERE doctrine_open IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2a. §2.2 APPEND-ONLY, enforced. A wrong entry is corrected by a 'correction'
--     entry that references it — never by an UPDATE, never by a DELETE.
--     (Mirrors enslaver_evidence_compendium M053: "No row may be retracted;
--     corrections are new rows.")
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION obligation_entries_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION
      'obligation_entries is APPEND-ONLY (standard-obligation-ledger.md §2.2). Attempted % on entry %. Post a correction entry referencing it instead.',
      TG_OP, COALESCE(OLD.id::text, '(unknown)');
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_obligation_entries_no_update ON obligation_entries;
CREATE TRIGGER trg_obligation_entries_no_update
    BEFORE UPDATE OR DELETE ON obligation_entries
    FOR EACH ROW EXECUTE FUNCTION obligation_entries_append_only();

-- ---------------------------------------------------------------------------
-- 2b. entry_seq auto-assignment (monotonic per account)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION obligation_entries_assign_seq() RETURNS trigger AS $$
BEGIN
    IF NEW.entry_seq IS NULL THEN
        SELECT COALESCE(MAX(entry_seq), 0) + 1 INTO NEW.entry_seq
          FROM obligation_entries WHERE account_id = NEW.account_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_obligation_entries_seq ON obligation_entries;
CREATE TRIGGER trg_obligation_entries_seq
    BEFORE INSERT ON obligation_entries
    FOR EACH ROW EXECUTE FUNCTION obligation_entries_assign_seq();

ALTER TABLE obligation_entries ALTER COLUMN entry_seq DROP NOT NULL;

-- ===========================================================================
-- 3. BALANCES — a VIEW, never a table
-- ===========================================================================
--
-- A materialized balance is a number someone can edit; a derived balance is a number someone must
-- re-derive from entries. That is the entire point of this migration.
--
-- §2.4b: principal_documented_usd and principal_modeled_usd are SEPARATE COLUMNS and are never summed
-- into one figure. This is the plan-apr29 §4 dual-ledger discipline (documented and estimated, surfaced
-- separately, never collapsed) applied at the ENTRY level, where it had never been applied.
--
-- §2.5: a satisfaction carrying doctrine_open (e.g. land_as_satisfaction) is COUNTED but does NOT
-- reduce the balance. Fail toward non-reduction.
-- §4:  offset_claimed NEVER reduces a balance. Only offset_adjudicated can.

CREATE OR REPLACE VIEW obligation_balances AS
SELECT
    a.id                                AS account_id,
    a.direction,
    a.regime_key,
    a.payee_class,
    a.status,
    NOW()                               AS as_of,

    COALESCE(SUM(e.amount_usd) FILTER (
        WHERE e.entry_type = 'origination' AND e.principal_basis = 'transaction_documented'), 0)
                                        AS principal_documented_usd,
    COALESCE(SUM(e.amount_usd) FILTER (
        WHERE e.entry_type = 'origination' AND e.principal_basis = 'modeled'), 0)
                                        AS principal_modeled_usd,

    COALESCE(SUM(e.amount_usd) FILTER (WHERE e.entry_type = 'accrual'), 0)     AS accrued_usd,

    COALESCE(SUM(e.amount_usd) FILTER (
        WHERE e.entry_type IN ('satisfaction', 'offset_adjudicated')
          AND e.doctrine_open IS NULL), 0)                                      AS satisfied_usd,

    COALESCE(SUM(e.amount_usd) FILTER (WHERE e.entry_type = 'offset_claimed'), 0)
                                        AS claimed_offsets_unadjudicated_usd,
    COALESCE(SUM(e.amount_usd) FILTER (
        WHERE e.entry_type IN ('satisfaction', 'offset_adjudicated')
          AND e.doctrine_open IS NOT NULL), 0)                                  AS doctrine_blocked_usd,

    COALESCE(SUM(e.amount_usd) FILTER (WHERE e.entry_type = 'correction'), 0)   AS corrections_usd,

    (COALESCE(SUM(e.amount_usd) FILTER (WHERE e.entry_type IN ('origination', 'accrual', 'correction')), 0)
     - COALESCE(SUM(e.amount_usd) FILTER (
         WHERE e.entry_type IN ('satisfaction', 'offset_adjudicated')
           AND e.doctrine_open IS NULL), 0))                                    AS balance_usd,

    COUNT(e.id)                         AS entry_count,
    MAX(e.entry_seq)                    AS last_entry_seq,
    ARRAY_REMOVE(ARRAY_AGG(DISTINCT e.doctrine_open), NULL)                     AS doctrine_open_flags,
    BOOL_OR(e.entry_type IN ('satisfaction', 'offset_claimed', 'offset_adjudicated')
            AND e.reached_class IN ('undetermined', 'partial'))                 AS adjudication_required
FROM obligation_accounts a
LEFT JOIN obligation_entries e ON e.account_id = a.id
GROUP BY a.id, a.direction, a.regime_key, a.payee_class, a.status;

COMMENT ON VIEW obligation_balances IS
  'Derived balance per account (standard-obligation-ledger.md §6). NEVER materialize this. principal_documented_usd and principal_modeled_usd MUST NOT be summed into one figure by any consumer — monitor invariant 8 treats that as CRITICAL. doctrine_open satisfactions are counted in doctrine_blocked_usd and excluded from satisfied_usd (§2.5, fail toward non-reduction). offset_claimed never reduces a balance (§4).';

COMMIT;
