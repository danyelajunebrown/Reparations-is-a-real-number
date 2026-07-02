-- 109-probate-progress-person-doc-index.sql
-- Index probate_scrape_progress.person_document_id (#95 fix support).
--
-- The role-aware external-assertion gate (PersonService.recomputeGate) checks whether a person's
-- estate evidences enslaved holding via:
--   person_documents pd JOIN probate_scrape_progress p ON p.person_document_id = pd.id
--   WHERE pd.canonical_person_id = <person> AND p.enslaved_count > 0
-- probate_scrape_progress had NO index on person_document_id, so this join seq-scanned the whole
-- table (86K+ rows) per person — hanging the bulk recompute and slowing the live per-person gate.
-- Created CONCURRENTLY (the NY scraper writes to this table continuously; no exclusive lock).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_psp_person_document_id
  ON probate_scrape_progress (person_document_id)
  WHERE person_document_id IS NOT NULL;
