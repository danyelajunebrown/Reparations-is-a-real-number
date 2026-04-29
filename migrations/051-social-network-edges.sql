-- Migration 051: social_network_edges
-- Date: 2026-04-29
--
-- Per memory-bank/plan-apr29-will-source-registry-dual-ledger-daa.md §2.M051.
--
-- Captures NON-enslaver relationships surfaced by source documents:
-- witnesses, executors, registrars, neighbors, co-signatories. The
-- Henry Weaver test case (plan §6.2) names Frederick L. Moore, William K.
-- Grimes, William P. Mayfield, Philip T. Hall — these belong here,
-- NOT in canonical_persons promoted to person_type='enslaver'.
--
-- The whole point of this table is to absorb the social-network signal
-- without contaminating enslaver classification. Pipeline writers MUST
-- route witnesses/executors/registrars here and never promote them to
-- enslaver via this surface.

CREATE TABLE IF NOT EXISTS social_network_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Both ends of the edge. Nullable because a row may be ingested before
    -- one end is matched (e.g., a witness whose name appears once and isn't
    -- yet in canonical_persons).
    person_a_canonical_id INTEGER REFERENCES canonical_persons(id) ON DELETE CASCADE,
    person_a_name_text TEXT,    -- preserved for unmatched names
    person_b_canonical_id INTEGER REFERENCES canonical_persons(id) ON DELETE CASCADE,
    person_b_name_text TEXT,

    edge_type TEXT NOT NULL
        CHECK (edge_type IN (
            'witnessed',           -- A witnessed B's document
            'executor_of',         -- A is executor of B's estate
            'attested',            -- A attested to B's document/oath
            'co_signed',           -- A and B co-signed
            'neighbor_of',         -- A and B are neighbors per source
            'named_in_document',   -- A named in document concerning B (catch-all, soft)
            'registrar_of'         -- A registered B's document (court official)
        )),

    -- Source context.
    context_document_id INTEGER REFERENCES person_documents(id) ON DELETE SET NULL,
    context_event_date DATE,

    provenance_jsonb JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- At least one end must be identified by name or canonical id.
    CHECK (
        person_a_canonical_id IS NOT NULL
        OR person_a_name_text IS NOT NULL
    ),
    CHECK (
        person_b_canonical_id IS NOT NULL
        OR person_b_name_text IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_social_network_edges_a
    ON social_network_edges(person_a_canonical_id);
CREATE INDEX IF NOT EXISTS idx_social_network_edges_b
    ON social_network_edges(person_b_canonical_id);
CREATE INDEX IF NOT EXISTS idx_social_network_edges_edge_type
    ON social_network_edges(edge_type);
CREATE INDEX IF NOT EXISTS idx_social_network_edges_document
    ON social_network_edges(context_document_id);

COMMENT ON TABLE social_network_edges IS
    'NON-enslaver relationships from source documents. See plan-apr29 §6.2 — '
    'witnesses, executors, registrars, neighbors. Writers MUST NOT promote '
    'these persons to canonical_persons.person_type=enslaver via this surface. '
    'Enslaver classification flows only through enslaver_evidence_compendium (M053).';
