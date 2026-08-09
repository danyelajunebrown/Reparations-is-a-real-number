-- 133-descent-anchors-and-frontier.sql — the work queue for DESCENT-FIRST lineage building.
--
-- WHY (user directive 2026-08-08, memory-bank/plan-descent-first-lineage.md): the project has 420,566
-- enslaver + 229,062 enslaved + 82,565 freedperson canonicals and 716,065 person_documents — and
-- canonical_family_edges holds 4,924 rows of which FOUR carry a source_document_id (0.08%). The
-- genealogical budget has been spent climbing UP from a handful of living participants into the
-- FamilySearch collaborative tree, where the frontier doubles per generation while evidence density
-- collapses (86% of one climb's 2,675 ancestors born pre-1700) and the terminal step throws a NAME into a
-- haystack of 420,566 enslavers (all 33 matches on the 2026-08-07 re-climb were `name_only_match` — the
-- Biscoe-forbidden operation at scale).
--
-- Descent inverts the epistemics: you never match a name into the corpus, you START at a person a source
-- document already identified, and walk FORWARD in time. It is also the project's own thesis — a will
-- names the children AND assigns the estate, so one descent step yields the tier-1 kinship edge and the
-- inheritance edge together. Continuity-of-holding is a forward-time claim.
--
-- WHAT THIS ADDS: only the work queue. The payload already has homes — canonical_family_edges (kinship,
-- lead-aware via the M103 polymorphic subject refs), inheritance_edges (wealth), person_documents
-- (evidence), research_findings (M128, the nulls), linkage_verdicts (M126, the conflicts). What was
-- missing is the thing that makes this a DRIP rather than a script someone remembers to run.
--
-- CLASS-NEUTRAL BY CONSTRUCTION (user decision 2026-08-08): the queue models enslaver, enslaved, and
-- freedperson lines identically. Only enslaver anchors are seedable today (probate names heirs); the
-- enslaved side is blocked at generation zero until Freedmen's Bank + the 1870→1950 census corridor land.
-- No schema change is required when they do — only new rows and a new source-class handler.
--
-- DEAD, DELIBERATELY NOT EXTENDED: slave_owner_descendants_suspected / _confirmed (M013, 9 rows) key the
-- legacy `individuals` table, carry their own confidence vocabulary, and store descendant email/phone in
-- the main DB. Superseded by these tables + the person spine.
--
-- Idempotent (IF NOT EXISTS throughout). No fabricated data — every row here is a unit of WORK, never a claim.

-- ---------------------------------------------------------------------------------------------------
-- 1. descent_anchors — the roots. One row per documented person we descend FROM.
-- ---------------------------------------------------------------------------------------------------
-- An anchor is admissible only when its identity was proven by a SOURCE DOCUMENT, not by a name match.
-- That is the whole reason descent beats ascent, so it is enforced here rather than assumed: `anchor_basis`
-- must name how identity was established, and 'image_backed_document' anchors carry the document id.
CREATE TABLE IF NOT EXISTS descent_anchors (
  anchor_id        BIGSERIAL PRIMARY KEY,
  subject_table    TEXT NOT NULL CHECK (subject_table IN ('canonical_persons','unconfirmed_persons')),
  subject_id       BIGINT NOT NULL,
  person_class     TEXT NOT NULL CHECK (person_class IN ('enslaver','enslaved','freedperson','other')),

  -- how this person's IDENTITY was proven (never "we matched the name")
  anchor_basis     TEXT NOT NULL CHECK (anchor_basis IN (
                     'image_backed_document',  -- person_documents row with s3_key (RULE 0.6 grade)
                     'curated_dataset',        -- a scholarly dataset that resolved the individual
                     'human_verdict'           -- operator sign-off, recorded in linkage_verdicts
                   )),
  anchor_evidence_document_id INTEGER REFERENCES person_documents(id) ON DELETE SET NULL,

  -- the era/place the descent starts from; drives which source class can name the next generation
  earliest_event_year INTEGER,
  latest_event_year   INTEGER,
  primary_state       TEXT,
  primary_county      TEXT,

  priority         INTEGER NOT NULL DEFAULT 100,  -- lower = worked sooner
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','active','stalled','complete','declined')),
  -- why a line stopped. 'living_generation_reached' is a SUCCESS: the line ran out of deceased people,
  -- which is where descent is supposed to stop (living people are searched, never minted).
  terminal_reason  TEXT CHECK (terminal_reason IN (
                     'living_generation_reached','no_forward_record','conflict_unresolved',
                     'identity_not_discrete','complete')),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT descent_anchors_subject_uq UNIQUE (subject_table, subject_id),
  -- an image-backed anchor must actually cite its image
  CONSTRAINT descent_anchors_image_needs_doc
    CHECK (anchor_basis <> 'image_backed_document' OR anchor_evidence_document_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_descent_anchors_work
  ON descent_anchors (status, priority, anchor_id) WHERE status IN ('pending','active');
CREATE INDEX IF NOT EXISTS idx_descent_anchors_class ON descent_anchors (person_class, status);

-- ---------------------------------------------------------------------------------------------------
-- 2. descent_frontier — the drip queue. One row per (person, generation-step) still to attempt.
-- ---------------------------------------------------------------------------------------------------
-- `source_classes_remaining` is what makes "as many sources as possible" mechanical instead of aspirational:
-- a step is not done when ONE source names the children, it is done when the era's sources are exhausted.
-- Disagreement between two classes is a signal, not an error — it routes to linkage_verdicts (M126).
CREATE TABLE IF NOT EXISTS descent_frontier (
  frontier_id      BIGSERIAL PRIMARY KEY,
  anchor_id        BIGINT NOT NULL REFERENCES descent_anchors(anchor_id) ON DELETE CASCADE,

  subject_table    TEXT NOT NULL CHECK (subject_table IN ('canonical_persons','unconfirmed_persons')),
  subject_id       BIGINT NOT NULL,
  generation_depth INTEGER NOT NULL DEFAULT 0 CHECK (generation_depth >= 0),

  era_band         TEXT,                                    -- '1750-1865' — selects the source ladder
  source_classes_attempted TEXT[] NOT NULL DEFAULT '{}',    -- 'probate','census_household','vital','freedmens_bank',…
  source_classes_remaining TEXT[] NOT NULL DEFAULT '{}',

  attempts         INTEGER NOT NULL DEFAULT 0,
  last_attempt_at  TIMESTAMPTZ,
  -- poison-pill guard, same pattern probate-drip.mjs needed after 1,076 wasted ticks on one un-extractable
  -- roll: a step that keeps failing must stop pinning the queue.
  poison_strikes   INTEGER NOT NULL DEFAULT 0,

  outcome          TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN (
                     'pending','children_found','no_record','blocked','exhausted','living_boundary')),
  outcome_note     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT descent_frontier_step_uq UNIQUE (anchor_id, subject_table, subject_id, generation_depth)
);

CREATE INDEX IF NOT EXISTS idx_descent_frontier_work
  ON descent_frontier (outcome, poison_strikes, generation_depth, frontier_id)
  WHERE outcome = 'pending';
CREATE INDEX IF NOT EXISTS idx_descent_frontier_anchor ON descent_frontier (anchor_id, generation_depth);
CREATE INDEX IF NOT EXISTS idx_descent_frontier_subject ON descent_frontier (subject_table, subject_id);

-- ---------------------------------------------------------------------------------------------------
-- 3. descent_pending_inheritance — the wealth half of a descent step, held until both ends are canonical.
-- ---------------------------------------------------------------------------------------------------
-- inheritance_edges.testator_id / heir_id are NOT NULL FKs to canonical_persons. Descendants land as LEADS
-- (standard: never a second uncontrolled door into canonical_persons), so at the moment a will is read the
-- heir has no canonical id and the inheritance edge CANNOT yet be written.
--
-- Dropping the bequest on the floor would defeat the entire point of descending through wills — the wealth
-- transfer is the thesis, not a side effect. Forcing a canonical to exist so the FK resolves would violate
-- the promotion bar (RULE 0.6). So the bequest is PARKED here, verbatim, with its document, and drains into
-- inheritance_edges the moment both ends clear promotion.
CREATE TABLE IF NOT EXISTS descent_pending_inheritance (
  pending_id       BIGSERIAL PRIMARY KEY,
  testator_table   TEXT NOT NULL CHECK (testator_table IN ('canonical_persons','unconfirmed_persons')),
  testator_id      BIGINT NOT NULL,
  heir_table       TEXT NOT NULL CHECK (heir_table IN ('canonical_persons','unconfirmed_persons')),
  heir_id          BIGINT NOT NULL,

  relationship_to_testator TEXT,          -- as the document states it, never normalized away
  asset_type       TEXT NOT NULL CHECK (asset_type IN (
                     'real_property','enslaved_persons','personal_estate','monetary_bequest',
                     'residual_estate','trust_interest','business_interest','mixed','unspecified')),
  asset_description TEXT,                 -- the bequest clause VERBATIM (audit rule: trace to a row)
  enslaved_persons_count INTEGER,

  source_document_id INTEGER REFERENCES person_documents(id) ON DELETE SET NULL,
  source_extraction_table TEXT,           -- 'probate_estate_extractions' | 'will_extractions'
  source_extraction_id    TEXT,
  document_year    INTEGER,
  document_jurisdiction TEXT,

  evidence_tier    INTEGER NOT NULL CHECK (evidence_tier BETWEEN 1 AND 3),
  confidence       NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  -- NO value estimate here on purpose. Valuation is deterministic code's job downstream, from the row —
  -- never inferred at extraction time (audit rule 1; proxy-explicitness).
  drained_to_edge_id INTEGER REFERENCES inheritance_edges(id) ON DELETE SET NULL,
  drained_at       TIMESTAMPTZ,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT descent_pending_inheritance_uq
    UNIQUE (testator_table, testator_id, heir_table, heir_id, asset_type, source_document_id)
);

CREATE INDEX IF NOT EXISTS idx_descent_pending_undrained
  ON descent_pending_inheritance (heir_table, heir_id) WHERE drained_to_edge_id IS NULL;

-- ---------------------------------------------------------------------------------------------------
-- 4. Provenance stamp on the edge tables, so the monitor can hold the engine to its own standard.
-- ---------------------------------------------------------------------------------------------------
-- The descent engine's contract is "no edge without its document". That is only enforceable if engine-written
-- edges are distinguishable from the 4,920 legacy tree-derived ones. project-health-monitor.mjs asserts:
--   SELECT count(*) FROM canonical_family_edges WHERE produced_by LIKE 'descent/%' AND source_document_id IS NULL
-- must be 0, forever.
ALTER TABLE canonical_family_edges ADD COLUMN IF NOT EXISTS produced_by TEXT;
ALTER TABLE inheritance_edges      ADD COLUMN IF NOT EXISTS produced_by TEXT;

CREATE INDEX IF NOT EXISTS idx_cfe_produced_by ON canonical_family_edges (produced_by)
  WHERE produced_by IS NOT NULL;

COMMENT ON TABLE descent_anchors IS
  'Roots of descent-first lineage building: documented people we build lines DOWN from. Identity must be document-proven (plan-descent-first-lineage.md §5.1).';
COMMENT ON TABLE descent_frontier IS
  'Drip queue of (person, generation-step) attempts. source_classes_remaining makes multi-source exhaustion mechanical.';
COMMENT ON TABLE descent_pending_inheritance IS
  'Bequests parked because the heir is still a LEAD (inheritance_edges requires canonical ids). Drains on promotion.';
COMMENT ON COLUMN canonical_family_edges.produced_by IS
  'Producer tag, e.g. descent/probate-heirs. Engine-written edges MUST carry source_document_id (monitor-enforced).';
