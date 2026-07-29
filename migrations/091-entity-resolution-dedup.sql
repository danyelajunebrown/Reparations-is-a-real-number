-- Migration 091: Entity-resolution dedup infrastructure
--
-- Two tables backing the canonical_persons dedup resolver
-- (scripts/resolve-canonical-dedup.mjs) and its human-review queue.
--
-- WHY: canonical_persons holds many duplicate records of the same historical
-- person (the "three Ann Biscoe" problem — see the Biscoe gold resolution).
-- The blocking keys could not be computed before because last_name is dirty
-- (multi-token, NULL, inverted "Surname, First", org/partnership names) and a
-- single phonetic code separates spelling variants like Biscoe/Briscoe
-- (metaphone BSK vs BRSK). The fix is MULTI-KEY blocking: each person emits
-- several keys (metaphone, dmetaphone, surname suffix, surname prefix) derived
-- from a CLEANED surname; two persons are compared if they share ANY key.
-- Biscoe and Briscoe share the suffix key 'scoe' and so co-block.
--
-- Phonetic codes are for BLOCKING ONLY (research/entity-resolution-methodology.md:
-- relying on them to MATCH yields 20-70% false rates). Final link/separate
-- decisions come from the scored resolver + human review here.

-- ---------------------------------------------------------------------------
-- 1. person_blocking_keys — one row per (person, key). A self-join on key_value
--    produces candidate pairs. Disjunctive (multi-pass) blocking.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS person_blocking_keys (
    canonical_person_id INTEGER NOT NULL REFERENCES canonical_persons(id) ON DELETE CASCADE,
    key_type            VARCHAR(8) NOT NULL,   -- 'mp' metaphone | 'dm' dmetaphone | 's4' suffix-4 | 'p4' prefix-4
    key_value           VARCHAR(64) NOT NULL,  -- e.g. 'mp:BSK', 's4:scoe'
    surname             VARCHAR(64),           -- the cleaned surname this key came from (debug/audit)
    PRIMARY KEY (canonical_person_id, key_value)
);
-- The candidate-pair self-join hits this constantly; index on key_value.
CREATE INDEX IF NOT EXISTS idx_pbk_key_value ON person_blocking_keys (key_value);

-- ---------------------------------------------------------------------------
-- 2. dedup_candidate_pairs — scored candidate duplicate pairs awaiting review.
--    Canonical ordering person_a_id < person_b_id so each unordered pair is
--    stored once. route encodes the resolver's decision; status tracks human
--    review. Confirmed merges are executed by merge-canonical-persons logic
--    (survivor = the lower id by convention, overridable by the reviewer).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dedup_candidate_pairs (
    id           BIGSERIAL PRIMARY KEY,
    person_a_id  INTEGER NOT NULL REFERENCES canonical_persons(id) ON DELETE CASCADE,
    person_b_id  INTEGER NOT NULL REFERENCES canonical_persons(id) ON DELETE CASCADE,
    score        NUMERIC(6,2) NOT NULL,
    route        VARCHAR(24) NOT NULL,   -- 'auto_merge_candidate' | 'review' | 'excluded'
    exclude_reason TEXT,                 -- populated when route='excluded' (hard non-merge)
    evidence     JSONB NOT NULL DEFAULT '[]'::jsonb,  -- array of human-readable scoring factors
    blocking_keys TEXT[],               -- which shared keys put this pair in a block
    -- denormalized snapshot for fast review-queue rendering (names drift rarely)
    a_name       TEXT,
    b_name       TEXT,
    -- review lifecycle
    status       VARCHAR(24) NOT NULL DEFAULT 'pending',  -- pending | confirmed_merge | confirmed_distinct | skipped | merged
    reviewed_by  TEXT,
    reviewed_at  TIMESTAMPTZ,
    reviewer_notes TEXT,
    survivor_id  INTEGER,               -- chosen survivor on a confirmed_merge
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT dedup_pair_order CHECK (person_a_id < person_b_id),
    CONSTRAINT dedup_pair_unique UNIQUE (person_a_id, person_b_id)
);
CREATE INDEX IF NOT EXISTS idx_dedup_status ON dedup_candidate_pairs (status, route, score DESC);
CREATE INDEX IF NOT EXISTS idx_dedup_person_a ON dedup_candidate_pairs (person_a_id);
CREATE INDEX IF NOT EXISTS idx_dedup_person_b ON dedup_candidate_pairs (person_b_id);
