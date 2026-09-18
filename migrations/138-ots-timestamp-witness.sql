-- 138 — OpenTimestamps witness for archived sources that Wayback structurally cannot witness.
--
-- Rule 8 asks for a DUAL archive: our S3 copy plus an INDEPENDENT witness. Measured 2026-08-30:
-- 115,570 of 121,225 unwitnessed source URLs are familysearch.org, and the Wayback Machine holds NOTHING
-- for FamilySearch — archive.org/wayback/available returns {"archived_snapshots": {}} for both image and
-- record arks. FS is not captured, and its images sit behind a login, so any capture attempt would witness
-- a SIGN-IN PAGE and present it as corroboration.
--
-- The purpose of the second leg is TAMPER-EVIDENCE: proof our copy is what we say it is, unaltered since a
-- stated time. Wayback supplies that incidentally, by re-hosting. OpenTimestamps supplies it directly, by
-- anchoring the sha256 in Bitcoin — and it redistributes NOTHING, which matters because re-hosting a
-- licensed FamilySearch image is something we should not do regardless of whether we could.
--   ots_proof_s3_key : the .ots proof, stored beside the image in our bucket
--   ots_submitted_at : when the digest went to the calendars
--   ots_calendars    : which calendars attested it (redundancy — a single calendar is a single point of trust)
ALTER TABLE source_artifacts
  ADD COLUMN IF NOT EXISTS ots_proof_s3_key text,
  ADD COLUMN IF NOT EXISTS ots_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS ots_calendars    text;

COMMENT ON COLUMN source_artifacts.ots_proof_s3_key IS
  'OpenTimestamps proof (.ots) for sha256. Independent tamper-evidence where Wayback cannot witness the source (e.g. auth-gated FamilySearch). Verifiable by anyone with the hash; redistributes no licensed content.';

CREATE INDEX IF NOT EXISTS idx_source_artifacts_unwitnessed
  ON source_artifacts (dataset_label)
  WHERE wayback_url IS NULL AND ots_proof_s3_key IS NULL AND sha256 IS NOT NULL;
