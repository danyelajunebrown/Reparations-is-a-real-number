-- Migration 036: Participant Model
--
-- Creates a participant identity that ties together:
--   - Multiple ancestor climb sessions (one per grandparent)
--   - The downward genealogy (grandparents → parents → participant)
--   - DAA records
--   - Blockchain wallet address
--   - Financial disclosure (for DAA calculation)
--
-- Design principle: A participant is a living person who has engaged
-- with the system. They may be a descendant of enslavers, a descendant
-- of enslaved people, or both. The system does not assume their role.

-- The participant record
CREATE TABLE IF NOT EXISTS participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identity
    full_name TEXT NOT NULL,
    email TEXT,
    date_of_birth DATE,
    birthplace TEXT,

    -- Address (for DAA mailing)
    address_line1 TEXT,
    address_city TEXT,
    address_state TEXT,
    address_zip TEXT,

    -- Financial disclosure (for DAA calculation)
    annual_income DECIMAL(12,2),
    estimated_net_worth DECIMAL(14,2),
    real_estate_equity DECIMAL(14,2),
    inheritance_received DECIMAL(14,2),
    inheritance_expected DECIMAL(14,2),
    tax_filing_status TEXT,
    num_dependents INTEGER,

    -- Blockchain
    wallet_address TEXT,  -- Ethereum/Base address (0x...)
    blockchain_record_ids INTEGER[],  -- On-chain record IDs from ReparationsEscrow

    -- FamilySearch
    self_fs_id TEXT,  -- Participant's own FS ID (may be living/restricted)
    self_is_living BOOLEAN DEFAULT true,

    -- Role in the system
    -- A participant can be BOTH an enslaver descendant AND an enslaved descendant
    -- (e.g., Adrian Brown who is half-Black half-white)
    roles TEXT[] DEFAULT '{}',  -- 'enslaver_descendant', 'enslaved_descendant', 'both', 'unknown'

    -- Intake
    intake_source TEXT,  -- 'google_form', 'kiosk', 'manual', 'premiere_may2026'
    intake_date TIMESTAMP DEFAULT NOW(),
    consent_research BOOLEAN DEFAULT false,
    consent_income BOOLEAN DEFAULT false,
    consent_negative BOOLEAN DEFAULT false,
    consent_blockchain BOOLEAN DEFAULT false,

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    notes TEXT
);

-- Participant's known family tree (grandparents, parents)
-- This is the DOWNWARD chain from grandparents to the participant
CREATE TABLE IF NOT EXISTS participant_family (
    id SERIAL PRIMARY KEY,
    participant_id UUID REFERENCES participants(id) ON DELETE CASCADE,

    -- The family member
    relationship TEXT NOT NULL,  -- 'father', 'mother', 'pat_grandfather', 'pat_grandmother', 'mat_grandfather', 'mat_grandmother'
    full_name TEXT NOT NULL,
    birth_year INTEGER,
    birthplace TEXT,
    fs_id TEXT,  -- FamilySearch Person ID
    is_living BOOLEAN DEFAULT false,

    -- Linkage to canonical_persons (if this person is also a known enslaver)
    canonical_person_id INTEGER REFERENCES canonical_persons(id),

    -- Linkage to climb sessions (grandparent → climb)
    climb_session_id UUID REFERENCES ancestor_climb_sessions(id),

    created_at TIMESTAMP DEFAULT NOW()
);

-- Link participants to their climb sessions
CREATE TABLE IF NOT EXISTS participant_climb_sessions (
    participant_id UUID REFERENCES participants(id) ON DELETE CASCADE,
    session_id UUID REFERENCES ancestor_climb_sessions(id) ON DELETE CASCADE,
    relationship_to_climbed_person TEXT,  -- 'self', 'maternal_grandmother', 'paternal_grandfather', etc.
    PRIMARY KEY (participant_id, session_id)
);

-- Link participants to their DAAs
CREATE TABLE IF NOT EXISTS participant_daas (
    participant_id UUID REFERENCES participants(id) ON DELETE CASCADE,
    daa_id UUID,  -- References debt_acknowledgment_agreements.daa_id
    PRIMARY KEY (participant_id, daa_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_participants_email ON participants(email);
CREATE INDEX IF NOT EXISTS idx_participants_wallet ON participants(wallet_address);
CREATE INDEX IF NOT EXISTS idx_participants_fs_id ON participants(self_fs_id);
CREATE INDEX IF NOT EXISTS idx_participant_family_participant ON participant_family(participant_id);
CREATE INDEX IF NOT EXISTS idx_participant_family_fs_id ON participant_family(fs_id);
CREATE INDEX IF NOT EXISTS idx_participant_climb_sessions_participant ON participant_climb_sessions(participant_id);

-- Insert Eli Neal as the first participant
-- (His data is already in the system from tree screenshot + climbs)
INSERT INTO participants (full_name, intake_source, notes)
VALUES ('Eli Neal', 'manual', 'First premiere participant. Data from FamilySearch tree screenshot Apr 5, 2026.')
ON CONFLICT DO NOTHING;
