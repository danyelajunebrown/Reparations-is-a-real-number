-- Add metadata fields for enslaved individuals
-- Supports: alternative name spellings, middle name, child names

-- Add alternative names (array for spelling variations)
ALTER TABLE enslaved_individuals
ADD COLUMN IF NOT EXISTS alternative_names TEXT[] DEFAULT '{}';

-- Add middle name
ALTER TABLE enslaved_individuals
ADD COLUMN IF NOT EXISTS middle_name VARCHAR(200);

-- Add child names as text (in addition to child_ids)
-- Useful when children don't have their own enslaved_individual records yet
ALTER TABLE enslaved_individuals
ADD COLUMN IF NOT EXISTS child_names TEXT[] DEFAULT '{}';

-- Add spouse name (in addition to spouse_ids)
ALTER TABLE enslaved_individuals
ADD COLUMN IF NOT EXISTS spouse_name VARCHAR(500);

-- Create indexes for searching
CREATE INDEX IF NOT EXISTS idx_enslaved_alternative_names ON enslaved_individuals USING GIN (alternative_names);
CREATE INDEX IF NOT EXISTS idx_enslaved_familysearch_id ON enslaved_individuals(familysearch_id);

-- Update the updated_at trigger to fire on metadata changes
CREATE OR REPLACE FUNCTION update_enslaved_individuals_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_enslaved_individuals_timestamp ON enslaved_individuals;
CREATE TRIGGER trigger_update_enslaved_individuals_timestamp
BEFORE UPDATE ON enslaved_individuals
FOR EACH ROW
EXECUTE FUNCTION update_enslaved_individuals_timestamp();
