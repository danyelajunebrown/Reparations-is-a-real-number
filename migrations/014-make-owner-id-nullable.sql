-- Migration 014: Make owner_individual_id nullable in descendant tables
-- Purpose: Allow descendant mapping to work independently of individuals table
--          The owner can be identified by owner_name + owner_birth_year + owner_death_year

-- Make owner_individual_id nullable in slave_owner_descendants_suspected
ALTER TABLE slave_owner_descendants_suspected
ALTER COLUMN owner_individual_id DROP NOT NULL;

-- Add index on owner_name for queries
CREATE INDEX IF NOT EXISTS idx_sods_owner_name_btree 
ON slave_owner_descendants_suspected(owner_name);

-- Make owner_individual_id nullable in slave_owner_descendants_confirmed  
ALTER TABLE slave_owner_descendants_confirmed
ALTER COLUMN owner_individual_id DROP NOT NULL;

-- Make owner_individual_id nullable in descendant_debt_assignments
ALTER TABLE descendant_debt_assignments
ALTER COLUMN owner_individual_id DROP NOT NULL;

-- Make owner_individual_id nullable in government_debt_obligations
ALTER TABLE government_debt_obligations
ALTER COLUMN owner_individual_id DROP NOT NULL;

COMMENT ON COLUMN slave_owner_descendants_suspected.owner_individual_id IS 
'Optional FK to individuals table. If NULL, owner is identified by owner_name + owner_birth_year + owner_death_year. Will be populated when individual records are created.';

COMMENT ON COLUMN slave_owner_descendants_confirmed.owner_individual_id IS 
'Optional FK to individuals table. If NULL, owner is identified by owner_name. Will be populated when individual records are created.';
