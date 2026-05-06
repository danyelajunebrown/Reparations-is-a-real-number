-- Migration 055: [placeholder — number reserved]
--
-- This migration number was skipped during development (migrations jumped
-- from 053 to 056). This stub exists to close the gap in the sequence and
-- prevent apply-migrations scripts from treating the gap as an error.
--
-- Applied: safe no-op.

DO $$ BEGIN
  RAISE NOTICE 'Migration 055: placeholder — no schema changes.';
END $$;
