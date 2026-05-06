-- Migration 059: [placeholder — number reserved]
--
-- This migration number was skipped during development (migrations jumped
-- from 056 to 060). This stub exists to close the gap in the sequence and
-- prevent apply-migrations scripts from treating the gap as an error.
--
-- Applied: safe no-op.

DO $$ BEGIN
  RAISE NOTICE 'Migration 059: placeholder — no schema changes.';
END $$;
