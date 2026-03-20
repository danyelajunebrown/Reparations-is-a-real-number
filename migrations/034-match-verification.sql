-- ============================================================================
-- Migration 034: Match Verification Pipeline
-- ============================================================================
-- Adds race-aware verification columns to ancestor_climb_matches.
-- New classification taxonomy replaces the old debt/credit/mixed system.
-- ============================================================================

-- 1. Add verification columns
ALTER TABLE ancestor_climb_matches
  ADD COLUMN IF NOT EXISTS verification_status VARCHAR(50) DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS verification_evidence JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS confidence_adjusted DECIMAL(4,3),
  ADD COLUMN IF NOT EXISTS requires_human_review BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_reason TEXT;

-- 2. Expand classification values
-- Old: 'debt', 'credit', 'mixed'
-- New taxonomy (CHECK constraint won't break old rows — we migrate them below):
COMMENT ON COLUMN ancestor_climb_matches.classification IS
  'Match classification taxonomy:
   confirmed_slaveholder — corroborated by race=White + property + era
   enslaved_ancestor — ancestor appears Black in census or enslaved records
   free_poc — free person of color, not a slaveholder
   free_poc_slaveholder — free POC who owned slaves, needs nuanced handling
   temporal_impossible — birth year outside slavery window
   common_name_suspect — high-frequency name at deep generation
   ambiguous_needs_review — conflicting evidence
   unverified — not yet evaluated
   debt — legacy classification (pre-034)
   credit — legacy classification (pre-034)
   mixed — legacy classification (pre-034)';

-- 3. Migrate old classifications to unverified status
UPDATE ancestor_climb_matches
SET verification_status = 'legacy_unverified',
    verification_evidence = '[]'::jsonb
WHERE verification_status IS NULL OR verification_status = 'unverified';

-- 4. Index for review queue
CREATE INDEX IF NOT EXISTS idx_acm_needs_review
  ON ancestor_climb_matches(requires_human_review)
  WHERE requires_human_review = true;

-- 5. Index for verification status filtering
CREATE INDEX IF NOT EXISTS idx_acm_verification_status
  ON ancestor_climb_matches(verification_status);

-- 6. Index for confidence_adjusted queries
CREATE INDEX IF NOT EXISTS idx_acm_confidence_adjusted
  ON ancestor_climb_matches(confidence_adjusted)
  WHERE confidence_adjusted IS NOT NULL;
