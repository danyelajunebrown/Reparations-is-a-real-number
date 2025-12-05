-- Migration: Add debug columns to extraction_jobs table
-- Date: December 5, 2025
-- Purpose: Add columns for detailed extraction debugging and status messages

-- Add status_message column for human-readable status updates
ALTER TABLE extraction_jobs
ADD COLUMN IF NOT EXISTS status_message TEXT;

-- Add debug_log column for comprehensive debugging information
ALTER TABLE extraction_jobs
ADD COLUMN IF NOT EXISTS debug_log JSONB;

-- Add updated_at column to track last update time
ALTER TABLE extraction_jobs
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Add started_at column if it doesn't exist
ALTER TABLE extraction_jobs
ADD COLUMN IF NOT EXISTS started_at TIMESTAMP;

-- Update started_at to be set when status changes to processing
-- (This will be handled by the application code)

-- Create index on status for faster queries
CREATE INDEX IF NOT EXISTS idx_extraction_jobs_status ON extraction_jobs(status);

-- Create index on session_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_extraction_jobs_session_id ON extraction_jobs(session_id);

-- Verify the changes
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'extraction_jobs'
ORDER BY ordinal_position;
