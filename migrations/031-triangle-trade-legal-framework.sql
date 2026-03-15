-- Migration 031: Triangle Trade Legal Framework
-- Date: January 5, 2026
-- Purpose: Comprehensive legal infrastructure for reparations claims across ALL
--          Triangle Trade jurisdictions (UK, US, France, Spain, Netherlands)
--
-- CORE LEGAL STRATEGY:
-- 1. UK 1833 loan (paid off 2015) PROVES governments CAN enforce multi-generational
--    financial obligations for slavery-related debt
-- 2. Haiti's "debt of independence" shows reparations logic was APPLIED IN REVERSE
--    against the enslaved - $21 billion extortion for their own freedom
-- 3. Farmer-Paellmann (2004) failed on standing/SOL - analyze what arguments
--    COULD work now given changed circumstances (UK 2015, Netherlands 2023)
-- 4. DAAs (individual claims) are our "way in" per Mullen/Darity framework
--    while acknowledging government mechanism (C) is ethically correct
--
-- Key texts needed:
-- - Slavery Abolition Act 1833 (UK)
-- - Code Noir 1685/1724 (France)
-- - 13th Amendment case law (US)
-- - Asiento treaties (Spain)
-- - Netherlands 2023 apology documents

-- =============================================================================
-- SECTION 1: JURISDICTIONS (Triangle Trade Participants)
-- =============================================================================

CREATE TABLE IF NOT EXISTS legal_jurisdictions (
    jurisdiction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Identity
    country_name VARCHAR(200) NOT NULL,
    historical_name VARCHAR(200),           -- e.g., "Kingdom of Great Britain"
    region VARCHAR(100),                    -- Europe, Americas, Africa, Caribbean
    
    -- Triangle Trade role
    trade_role VARCHAR(100)[],              -- ['origin', 'transport', 'destination', 'colonial_power']
    
    -- Slavery timeline
    slavery_legal_start INTEGER,            -- Year slavery became legal/practiced
    slavery_legal_end INTEGER,              -- Year abolished
    emancipation_date DATE,
    compensation_scheme BOOLEAN DEFAULT FALSE,
    compensation_to_whom VARCHAR(100),      -- 'owners', 'enslaved', 'both', 'none'
    
    -- Modern status
    has_issued_apology BOOLEAN DEFAULT FALSE,
    apology_date DATE,
    has_paid_reparations BOOLEAN DEFAULT FALSE,
    reparations_amount DECIMAL(20, 2),
    reparations_currency VARCHAR(10),
    
    -- Legal system type
    legal_system VARCHAR(100),              -- 'common_law', 'civil_law', 'mixed'
    
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed core Triangle Trade jurisdictions
INSERT INTO legal_jurisdictions (
    country_name, historical_name, region, trade_role,
    slavery_legal_start, slavery_legal_end, emancipation_date,
    compensation_scheme, compensation_to_whom, legal_system,
    has_issued_apology, apology_date, has_paid_reparations, reparations_amount, reparations_currency
) VALUES
-- UNITED KINGDOM - PRIMARY PRECEDENT
(
    'United Kingdom',
    'Kingdom of Great Britain',
    'Europe',
    ARRAY['colonial_power', 'transport', 'financial_center'],
    1562, 1833, '1834-08-01',
    TRUE, 'owners',
    'common_law',
    TRUE, '2006-11-27',
    FALSE, NULL, NULL
),
-- FRANCE - HAITI COUNTER-PRECEDENT
(
    'France',
    'Kingdom of France',
    'Europe',
    ARRAY['colonial_power', 'transport', 'destination'],
    1642, 1848, '1848-04-27',
    TRUE, 'owners',
    'civil_law',
    FALSE, NULL,
    FALSE, NULL, NULL
),
-- HAITI - VICTIM OF INVERSE REPARATIONS
(
    'Haiti',
    'Saint-Domingue (French colony)',
    'Caribbean',
    ARRAY['destination', 'origin_post_independence'],
    1697, 1804, '1804-01-01',
    FALSE, 'none',
    'civil_law',
    FALSE, NULL,
    FALSE, NULL, NULL
),
-- UNITED STATES
(
    'United States',
    'British America / United States',
    'Americas',
    ARRAY['destination', 'origin_domestic'],
    1619, 1865, '1865-12-06',
    FALSE, 'none',  -- DC was limited exception
    'common_law',
    FALSE, NULL,
    FALSE, NULL, NULL
),
-- SPAIN - CUBA/PUERTO RICO
(
    'Spain',
    'Spanish Empire',
    'Europe',
    ARRAY['colonial_power', 'transport', 'destination'],
    1501, 1886, '1886-10-07',  -- Final abolition in Cuba
    TRUE, 'owners',
    'civil_law',
    FALSE, NULL,
    FALSE, NULL, NULL
),
-- NETHERLANDS - 2023 PRECEDENT
(
    'Netherlands',
    'Dutch Republic',
    'Europe',
    ARRAY['colonial_power', 'transport', 'financial_center'],
    1619, 1863, '1863-07-01',
    TRUE, 'owners',
    'civil_law',
    TRUE, '2022-12-19',
    TRUE, 200000000, 'EUR'
),
-- PORTUGAL
(
    'Portugal',
    'Kingdom of Portugal',
    'Europe',
    ARRAY['colonial_power', 'transport', 'origin'],
    1441, 1869, '1869-02-25',  -- Final abolition in colonies
    FALSE, 'none',
    'civil_law',
    FALSE, NULL,
    FALSE, NULL, NULL
)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- SECTION 2: LEGAL TEXTS & STATUTES
-- =============================================================================

CREATE TABLE IF NOT EXISTS legal_texts (
    text_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Identity
    title VARCHAR(500) NOT NULL,
    short_title VARCHAR(200),
    jurisdiction_id UUID REFERENCES legal_jurisdictions(jurisdiction_id),
    
    -- Type and status
    text_type VARCHAR(100),                 -- 'statute', 'treaty', 'case_law', 'constitution', 'code', 'decree'
    legal_status VARCHAR(100),              -- 'in_force', 'repealed', 'superseded', 'historical'
    
    -- Dates
    enacted_date DATE,
    effective_date DATE,
    repealed_date DATE,
    
    -- Content
    full_text TEXT,                         -- Complete text if available
    summary TEXT,                           -- Executive summary
    key_provisions TEXT[],                  -- Critical sections
    
    -- Citation
    official_citation VARCHAR(500),         -- e.g., "3 & 4 Will. IV c. 73"
    common_citation VARCHAR(500),           -- e.g., "Slavery Abolition Act 1833"
    
    -- Relevance to reparations
    reparations_relevance TEXT,             -- How this text supports/undermines reparations claims
    key_arguments TEXT[],                   -- Specific legal arguments derived from this text
    
    -- Source
    source_url TEXT,
    source_archive VARCHAR(500),
    digitized BOOLEAN DEFAULT FALSE,
    s3_key TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- SECTION 3: UK 1833 LOAN - PRIMARY PRECEDENT
-- =============================================================================

CREATE TABLE IF NOT EXISTS uk_1833_compensation (
    record_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- The devastating facts
    loan_amount_original DECIMAL(20, 2) DEFAULT 20000000,  -- £20 million
    loan_currency VARCHAR(10) DEFAULT 'GBP',
    loan_date DATE DEFAULT '1833-08-28',
    
    -- Payment timeline
    final_payment_date DATE DEFAULT '2015-02-01',
    years_to_payoff INTEGER DEFAULT 182,
    
    -- Modern value estimates
    modern_value_gbp DECIMAL(20, 2) DEFAULT 17000000000,   -- £17 billion
    modern_value_usd DECIMAL(20, 2) DEFAULT 20000000000,   -- ~$20 billion
    
    -- Who paid (critical: taxpayers including descendants of enslaved)
    paid_by VARCHAR(200) DEFAULT 'British taxpayers (including descendants of enslaved)',
    
    -- Who received ($0 to enslaved)
    enslaved_received DECIMAL(20, 2) DEFAULT 0,
    owners_received DECIMAL(20, 2) DEFAULT 20000000,
    
    -- Enslaved population affected
    enslaved_count INTEGER DEFAULT 800000,
    
    -- Legal arguments this enables
    arguments JSONB DEFAULT '{
        "intergenerational_debt_transfer": {
            "fact": "Government enforced 182 years of taxpayer payments for slavery debt",
            "proves": "Legal mechanisms EXIST for multi-generational financial obligations",
            "implication": "Cannot argue ''too much time has passed'' - UK finished paying in 2015"
        },
        "inversion_argument": {
            "fact": "Government created 182-year payment TO slave owners (wrong party)",
            "proves": "Same mechanism can apply in OTHER direction",
            "implication": "Legal machinery exists, was simply pointed at wrong beneficiaries"
        },
        "garnishment_precedent": {
            "fact": "Debt was collected via taxation over 182 years",
            "proves": "Slavery debts ARE inheritable by nations/institutions",
            "implication": "Future generations CAN be obligated to pay for past wrongs"
        },
        "descendants_paid_oppressors": {
            "fact": "Descendants of enslaved in Britain paid taxes toward this loan until 2015",
            "proves": "System already extracted value FROM victims to PAY perpetrators",
            "implication": "Reparations would merely CORRECT this ongoing injustice"
        }
    }',
    
    -- Sources
    primary_source VARCHAR(500) DEFAULT 'Slavery Abolition Act 1833 (3 & 4 Will. IV c. 73)',
    treasury_records TEXT,
    academic_sources TEXT[],
    
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert the core record
INSERT INTO uk_1833_compensation (notes) VALUES 
('Primary legal precedent for intergenerational debt transfer. The £20M loan was not fully paid off until February 2015 - 182 years after issuance. This demolishes any argument that "too much time has passed" for reparations claims.')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- SECTION 4: HAITI INVERSE DEBT - COUNTER-PRECEDENT
-- =============================================================================

CREATE TABLE IF NOT EXISTS haiti_independence_debt (
    record_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- The extortion
    original_demand DECIMAL(20, 2) DEFAULT 150000000,      -- 150 million francs
    original_currency VARCHAR(20) DEFAULT 'French Francs',
    demand_date DATE DEFAULT '1825-04-17',
    
    -- What Haiti actually paid
    amount_paid DECIMAL(20, 2) DEFAULT 90000000,           -- ~90 million francs
    payment_currency VARCHAR(20) DEFAULT 'French Francs',
    final_payment_year INTEGER DEFAULT 1947,
    years_paying INTEGER DEFAULT 122,
    
    -- Modern value
    modern_value_usd DECIMAL(20, 2) DEFAULT 21000000000,   -- $21 billion
    
    -- The double indemnity
    france_extorted_for VARCHAR(500) DEFAULT 'Lost property (enslaved humans) and plantations',
    haiti_gained VARCHAR(500) DEFAULT 'Recognition of independence they had ALREADY won by revolution',
    
    -- Legal arguments this enables
    arguments JSONB DEFAULT '{
        "inverse_reparations": {
            "fact": "France forced Haiti to pay $21 billion (modern value) for their OWN freedom",
            "proves": "Reparations logic WAS applied - just in REVERSE against victims",
            "implication": "If France could demand payment for ''lost property'' (enslaved humans), descendants of enslaved can demand payment for stolen labor"
        },
        "precedent_for_calculation": {
            "fact": "France calculated specific monetary value per enslaved person",
            "proves": "Historical valuations exist and were legally enforced",
            "implication": "Methodology for calculating debt already established by oppressor nations"
        },
        "compound_interest_precedent": {
            "fact": "Haiti paid over 122 years with interest",
            "proves": "Long-term debt repayment with interest is established norm",
            "implication": "Reparations calculations using compound interest are historically consistent"
        },
        "economic_devastation_evidence": {
            "fact": "Debt payments kept Haiti impoverished for generations",
            "proves": "Direct causal link between slavery extraction and modern poverty",
            "implication": "Economic damages are traceable and calculable"
        }
    }',
    
    -- Sources
    primary_source VARCHAR(500) DEFAULT 'Royal Ordinance of Charles X (April 17, 1825)',
    french_archives TEXT,
    academic_sources TEXT[] DEFAULT ARRAY[
        'Marlene Daut, "When France Extorted Haiti" (2020)',
        'Thomas Piketty, "Capital and Ideology" (2020), Chapter 7'
    ],
    
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert the core record
INSERT INTO haiti_independence_debt (notes) VALUES 
('Counter-precedent showing reparations logic applied IN REVERSE against enslaved. France extorted $21 billion from Haiti for their own freedom - proving financial mechanisms for slavery debts were actively enforced. Haiti finished paying in 1947 with assistance from US loans.')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- SECTION 5: FARMER-PAELLMANN FAILURE ANALYSIS
-- =============================================================================

CREATE TABLE IF NOT EXISTS farmer_paellmann_analysis (
    analysis_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Case identification
    case_name VARCHAR(500) DEFAULT 'In re African-American Slave Descendants Litigation',
    citation VARCHAR(200) DEFAULT '304 F. Supp. 2d 1027 (N.D. Ill. 2004)',
    court VARCHAR(200) DEFAULT 'United States District Court, Northern District of Illinois',
    judge VARCHAR(200) DEFAULT 'Charles R. Norgle Sr.',
    decision_date DATE DEFAULT '2004-01-26',
    
    -- Outcome
    outcome VARCHAR(100) DEFAULT 'Dismissed',
    
    -- Failure points (what arguments FAILED and why)
    failure_points JSONB DEFAULT '{
        "standing": {
            "court_reasoning": "Plaintiffs could not trace specific injury to specific defendants",
            "weakness_exploited": "Class action attempted to represent ALL descendants without specific lineage documentation",
            "how_we_address": "DAAs target SPECIFIC descendant-to-descendant connections with documented lineage",
            "changed_circumstances": "WikiTree, FamilySearch, DNA databases now enable precise lineage documentation"
        },
        "statute_of_limitations": {
            "court_reasoning": "Claims time-barred under applicable state statutes",
            "weakness_exploited": "Filed as tort claims with typical SOL periods",
            "how_we_address": "UK 2015 loan payoff demonstrates NO SOL on slavery debts - ongoing payments",
            "changed_circumstances": "Netherlands 2023 compensation proves ongoing obligation"
        },
        "political_question_doctrine": {
            "court_reasoning": "Reparations is a political question for Congress, not courts",
            "weakness_exploited": "Framed as policy request rather than legal obligation",
            "how_we_address": "DAAs are private contracts, not government policy demands",
            "changed_circumstances": "Individual acknowledgment bypasses political question"
        },
        "unjust_enrichment": {
            "court_reasoning": "Could not prove direct enrichment of modern corporations from specific plaintiffs ancestors",
            "weakness_exploited": "Class action made specific connections impossible",
            "how_we_address": "Document-by-document evidence chain from will to inheritance to descendant",
            "changed_circumstances": "UCL LBS database provides compensation records linking specific estates"
        },
        "successor_liability": {
            "court_reasoning": "Corporate successors not liable for predecessor torts under state law",
            "weakness_exploited": "Relied on general tort principles",
            "how_we_address": "Shift to unjust enrichment and constructive trust theories",
            "changed_circumstances": "Corporate acknowledgments (JPMorgan 2005, Aetna) create estoppel"
        }
    }',
    
    -- Defendants (17 total)
    defendant_count INTEGER DEFAULT 17,
    
    -- What HAS changed since 2004
    changed_circumstances JSONB DEFAULT '{
        "uk_loan_2015": "UK finished paying 1833 slavery compensation in 2015 - demolished ''too much time'' argument",
        "netherlands_2023": "Dutch government paid €200M reparations in 2023 - proves ongoing obligation recognized",
        "corporate_acknowledgments": "JPMorgan (2005), Aetna, other corporations have publicly acknowledged slavery involvement",
        "genealogy_technology": "WikiTree, FamilySearch, AncestryDNA enable precise descendant-to-descendant matching",
        "ucl_lbs_database": "UCL Legacies of British Slavery database documents 3,000+ slaveholders with compensation records",
        "digitized_archives": "Millions of primary source documents now searchable and citable"
    }',
    
    -- Strategic lessons
    strategic_lessons TEXT[] DEFAULT ARRAY[
        'Avoid class action - pursue individual claims with documented lineage',
        'Use UK 2015 payoff to demolish statute of limitations defense',
        'Frame as unjust enrichment and constructive trust, not tort',
        'Document specific evidence chains from primary sources',
        'Target individual descendants, not just corporations',
        'Use DAAs as private contracts to bypass political question doctrine'
    ],
    
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert the analysis record
INSERT INTO farmer_paellmann_analysis (notes) VALUES 
('Strategic analysis of why Farmer-Paellmann failed and how changed circumstances since 2004 enable new approaches. Key insight: class action was too broad, evidence chains too weak. Solution: DAAs with documented lineage, compound interest from UK precedent, individual targeting.')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- SECTION 6: LEGAL DOCTRINES (Universal Theories)
-- =============================================================================

CREATE TABLE IF NOT EXISTS legal_doctrines (
    doctrine_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Identity
    doctrine_name VARCHAR(300) NOT NULL,
    short_name VARCHAR(100),
    
    -- Type
    doctrine_type VARCHAR(100),             -- 'equity', 'tort', 'contract', 'constitutional', 'international'
    
    -- Jurisdictions where applicable
    applicable_jurisdictions TEXT[],        -- ARRAY of jurisdiction names
    
    -- Core definition
    definition TEXT,
    elements TEXT[],                        -- Required elements to prove
    
    -- Application to reparations
    reparations_application TEXT,           -- How this doctrine supports reparations
    supporting_cases TEXT[],                -- Case citations
    opposing_cases TEXT[],                  -- Cases where doctrine failed
    
    -- Sources
    restatement_citation TEXT,              -- E.g., "Restatement (Third) of Restitution § 40"
    treatise_citations TEXT[],
    
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed core doctrines
INSERT INTO legal_doctrines (
    doctrine_name, short_name, doctrine_type, applicable_jurisdictions,
    definition, elements, reparations_application, supporting_cases
) VALUES
(
    'Unjust Enrichment',
    'unjust_enrichment',
    'equity',
    ARRAY['United States', 'United Kingdom', 'France', 'Netherlands'],
    'A party that has been unjustly enriched at the expense of another is required to make restitution.',
    ARRAY[
        'Defendant received a benefit',
        'At plaintiff''s expense',
        'Under circumstances making retention unjust'
    ],
    'Slaveholder descendants inherited wealth created by enslaved labor. Retention of this wealth without compensation is unjust. UCL LBS compensation records PROVE the benefit received.',
    ARRAY['Restatement (Third) of Restitution and Unjust Enrichment (2011)']
),
(
    'Constructive Trust',
    'constructive_trust',
    'equity',
    ARRAY['United States', 'United Kingdom'],
    'Equity imposes a trust on property held by one who would be unjustly enriched if permitted to retain it.',
    ARRAY[
        'Defendant holds legal title to property',
        'Property was wrongfully obtained or is wrongfully retained',
        'Plaintiff has equitable claim to property'
    ],
    'Inherited wealth from slavery is held in constructive trust for descendants of enslaved. Legal title passed through wills, but equitable title belongs to those whose labor created the wealth.',
    ARRAY['Beatty v. Guggenheim Exploration Co., 225 N.Y. 380 (1919)']
),
(
    'Successor Liability',
    'successor_liability',
    'tort',
    ARRAY['United States'],
    'A corporation that acquires another may be liable for the predecessor''s debts under certain circumstances.',
    ARRAY[
        'Express or implied assumption of liability',
        'De facto merger',
        'Mere continuation of predecessor',
        'Fraudulent transaction to escape liability'
    ],
    'Modern corporations that acquired slavery-era predecessors (see Farmer-Paellmann defendants) assumed liabilities. JPMorgan, Aetna acknowledgments may create estoppel.',
    ARRAY['Ray v. Alad Corp., 19 Cal. 3d 22 (1977)']
),
(
    'Badges and Incidents of Slavery',
    'badges_incidents',
    'constitutional',
    ARRAY['United States'],
    'The 13th Amendment empowers Congress to eliminate not just slavery itself but also the ''badges and incidents'' of slavery.',
    ARRAY[
        'Condition or burden exists',
        'Condition traces to slavery',
        'Condition perpetuates subordination'
    ],
    'Racial wealth gap, lack of inherited wealth, and economic inequality are badges of slavery that persist. Reparations would eliminate these vestiges.',
    ARRAY['Jones v. Alfred H. Mayer Co., 392 U.S. 409 (1968)', 'The Civil Rights Cases, 109 U.S. 3 (1883)']
)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- SECTION 7: GARNISHMENT MECHANISM OPTIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS garnishment_mechanisms (
    mechanism_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Identity
    mechanism_type VARCHAR(100) NOT NULL,   -- 'individual_estate', 'class_action', 'government_taxation', 'corporate_settlement'
    mechanism_name VARCHAR(300),
    
    -- Target defendant type
    defendant_type VARCHAR(100),            -- 'individual', 'corporation', 'government', 'institution'
    
    -- Legal basis
    legal_theory VARCHAR(300),
    applicable_doctrines UUID[],            -- References to legal_doctrines
    
    -- Precedent
    precedent_case VARCHAR(500),
    precedent_jurisdiction VARCHAR(100),
    
    -- Mullen/Darity assessment
    mullen_darity_rating VARCHAR(50),       -- 'ethically_correct', 'practical_entry_point', 'rejected'
    mullen_darity_rationale TEXT,
    
    -- Implementation
    implementation_steps TEXT[],
    challenges TEXT[],
    
    -- Our strategy position
    our_position VARCHAR(100),              -- 'primary', 'secondary', 'backup', 'rejected'
    position_rationale TEXT,
    
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed mechanism options per user direction
INSERT INTO garnishment_mechanisms (
    mechanism_type, mechanism_name, defendant_type,
    legal_theory, precedent_case, precedent_jurisdiction,
    mullen_darity_rating, mullen_darity_rationale,
    our_position, position_rationale
) VALUES
(
    'individual_estate',
    'Private DAA Claims Against Individual Descendant Estates',
    'individual',
    'Unjust enrichment + Constructive trust',
    'Henrietta Wood v. Zebulon Ward (1876)',
    'United States',
    'practical_entry_point',
    'While government mechanism is ethically correct (governments enacted/taxed slave industries), individual claims provide proof of concept and build momentum for broader change.',
    'primary',
    'Our way in. Farmer-Paellmann class action was dismissed, but individual claims with documented lineage avoid standing issues. Each DAA signed is evidence of concept working.'
),
(
    'class_action',
    'Class Action Against Corporate Successors',
    'corporation',
    'Successor liability + Unjust enrichment',
    'In re African-American Slave Descendants Litigation (2004) - FAILED but circumstances changed',
    'United States',
    'practical_entry_point',
    'Corporate entities are easier to document than individuals. Public companies have disclosure requirements. BUT Farmer-Paellmann was dismissed.',
    'secondary',
    'Always thinking class action in our handling, but learned from Farmer-Paellmann failures. Need individual DAA successes first to demonstrate viability.'
),
(
    'government_taxation',
    'Government-Mandated Taxation Scheme (UK Loan Model in Reverse)',
    'government',
    'Legislative authority + UK 1833 precedent',
    'Slavery Abolition Act 1833 (created 182-year payment obligation)',
    'United Kingdom',
    'ethically_correct',
    'Per Mullen and Darity, ONLY ethical mechanism. Governments enacted slavery, taxed slave industries, enforced Fugitive Slave Act. They bear primary responsibility.',
    'ultimate_goal',
    'The correct answer. UK proved it works over 182 years. But requires political will we cannot force. Individual DAAs build political pressure toward this goal.'
),
(
    'corporate_settlement',
    'Negotiated Corporate Settlement',
    'corporation',
    'Reputational pressure + Acknowledgment estoppel',
    'JPMorgan $5M scholarship fund (2005), Aetna public apology',
    'United States',
    'practical_entry_point',
    'Companies may settle to avoid litigation costs and reputational damage. Creates precedent for larger claims.',
    'opportunistic',
    'Accept when offered, but insufficient alone. $5M scholarship is insulting compared to documented debt. Use settlements as admissions for larger claims.'
)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- SECTION 8: ESCROW TRACKING (Credit Side - Per User Direction)
-- =============================================================================

CREATE TABLE IF NOT EXISTS reparations_escrow (
    escrow_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Payment source (debtor)
    debtor_person_id UUID,                  -- References canonical_persons if known
    debtor_name VARCHAR(500),
    debtor_type VARCHAR(100),               -- 'individual', 'corporation', 'government'
    
    -- Payment amount
    amount DECIMAL(20, 2),
    currency VARCHAR(10) DEFAULT 'USD',
    
    -- Status
    escrow_status VARCHAR(100) DEFAULT 'pending',  -- 'pending', 'funded', 'disputed', 'distributed'
    
    -- Linked DAA
    daa_id UUID,                            -- References daa_documents if exists
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    funded_at TIMESTAMP,
    distributed_at TIMESTAMP,
    
    notes TEXT
);

-- NOTE: Per user direction, credit tracking (who receives payments) will be handled
-- via escrow when "somebody bites" - we cross that bridge when someone actually pays.
-- The strategy is NOT to build elaborate credit tracking now, but to be ready with
-- escrow infrastructure for when payments begin.

COMMENT ON TABLE reparations_escrow IS 'Tracks reparations payments in escrow. Credit distribution to enslaved descendants handled when payments actually arrive - "we will cross that bridge when somebody bites."';

-- =============================================================================
-- SECTION 9: CODE NOIR (France)
-- =============================================================================

INSERT INTO legal_texts (
    title, short_title, text_type, legal_status,
    enacted_date, effective_date,
    official_citation, common_citation,
    summary, key_provisions,
    reparations_relevance
) VALUES
(
    'Le Code Noir ou recueil des règlements rendus jusqu''à présent',
    'Code Noir',
    'code',
    'historical',
    '1685-03-01',
    '1685-03-01',
    'Ordonnance de mars 1685',
    'Code Noir (1685)',
    'French royal decree defining conditions of slavery in French colonial empire. Treated enslaved persons as movable property (meubles), regulated punishment, prohibited family separation (unenforced), required Catholic baptism.',
    ARRAY[
        'Article 44: Declares enslaved persons to be "meubles" (movable property)',
        'Article 38: Prohibits separation of families (rarely enforced)',
        'Article 42: Masters may sell enslaved persons as any other movable property',
        'Article 47: Spouse and prepubescent children cannot be seized separately'
    ],
    'Legal codification of personhood-as-property provides foundation for calculating business value of enslaved persons. Article 44 defining enslaved as "meubles" demonstrates state''s active role in dehumanization. France''s legal framework was explicit about economic nature of slavery.'
),
(
    'Code Noir (Louisiana Revision)',
    'Code Noir Louisiana',
    'code',
    'historical',
    '1724-03-01',
    '1724-03-01',
    'Code Noir ou Loi Municipale (1724)',
    'Louisiana Code Noir (1724)',
    'Adaptation of French Code Noir for Louisiana colony. Added racial mixing prohibitions, excluded free Black people from inheriting from white persons, strengthened control mechanisms.',
    ARRAY[
        'Prohibited interracial marriage',
        'Free Black people could not inherit from white persons',
        'Required manumission approval by Superior Council',
        'Prohibited enslaved persons from owning property'
    ],
    'Louisiana Code Noir remained in effect under Spanish rule and influenced US slave codes after Louisiana Purchase. Direct lineage from French colonial law to American slavery demonstrates European complicity requiring European reparations participation.'
)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- SECTION 10: SPAIN - ASIENTO SYSTEM
-- =============================================================================

INSERT INTO legal_texts (
    title, short_title, text_type, legal_status,
    enacted_date, effective_date,
    official_citation, common_citation,
    summary, key_provisions,
    reparations_relevance
) VALUES
(
    'Treaty of Utrecht - British Asiento',
    'British Asiento',
    'treaty',
    'historical',
    '1713-03-26',
    '1713-03-26',
    'Treaty of Utrecht, Article 12 (1713)',
    'British Asiento (1713)',
    'Treaty granting Britain exclusive right to supply 4,800 enslaved Africans annually to Spanish America for 30 years. South Sea Company held contract.',
    ARRAY[
        'Britain to supply 4,800 enslaved Africans annually',
        'Contract duration: 30 years (1713-1743)',
        'South Sea Company designated as contractor',
        'Spain received 33.3% of profits'
    ],
    'International treaty BETWEEN colonial powers to share profits from slave trade. Both Britain AND Spain legally liable. South Sea Company collapse (1720) demonstrates speculative bubble built on slavery - modern equivalent would be securities fraud built on human trafficking.'
)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- SECTION 11: CUBA ABOLITION
-- =============================================================================

INSERT INTO legal_texts (
    title, short_title, text_type, legal_status,
    enacted_date, effective_date,
    official_citation, common_citation,
    summary, key_provisions,
    reparations_relevance
) VALUES
(
    'Moret Law (Spanish Gradual Abolition)',
    'Moret Law',
    'statute',
    'historical',
    '1870-07-04',
    '1870-07-04',
    'Ley Moret (July 4, 1870)',
    'Moret Law / Free Womb Law (1870)',
    'Spanish law freeing children born to enslaved mothers, enslaved over 60 years old, and those who served in Spanish military. Beginning of gradual abolition in Cuba/Puerto Rico.',
    ARRAY[
        'Children born to enslaved mothers after 1868 declared free',
        'Enslaved persons over 60 freed',
        'Military service = emancipation',
        'Owners compensated for freed children''s labor until age 18'
    ],
    'Spain''s gradual abolition maintained compensation TO OWNERS through patronato (apprenticeship) system until 1886. Cuban sugar plantations continued operating with quasi-enslaved labor. Demonstrates slavery''s end was NEGOTIATED to protect owner interests, not justice for enslaved.'
),
(
    'Royal Decree Abolishing Slavery in Cuba',
    'Cuba Abolition Decree',
    'decree',
    'historical',
    '1886-10-07',
    '1886-10-07',
    'Real Decreto de 7 de octubre de 1886',
    'Cuban Abolition (1886)',
    'Final abolition of slavery in Cuba, ending the patronato (apprenticeship) system. Cuba was last major Spanish colony to abolish slavery.',
    ARRAY[
        'Ended patronato system',
        'Full emancipation for ~25,000 remaining patrocinados',
        'No compensation to formerly enslaved',
        'Owners had received compensation during gradual phase'
    ],
    'Cuba 1886 = LAST abolition in Western Hemisphere. Spanish owners extracted maximum value through 16-year gradual process. Sugar wealth flowed to Spain throughout - modern Spanish institutions, banks, and families retain this wealth.'
)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- SECTION 12: NETHERLANDS 2023 - CONTEMPORARY PRECEDENT
-- =============================================================================

INSERT INTO legal_texts (
    title, short_title, text_type, legal_status,
    enacted_date, effective_date,
    official_citation, common_citation,
    summary, key_provisions,
    reparations_relevance
) VALUES
(
    'Dutch Government Slavery Apology and Reparations Fund',
    'Netherlands 2023 Apology',
    'decree',
    'in_force',
    '2022-12-19',
    '2023-07-01',  -- Keti Koti (July 1) commemoration
    'Dutch Government Statement, December 19, 2022',
    'Netherlands Slavery Apology (2022/2023)',
    'Prime Minister Mark Rutte formally apologized for Dutch role in slavery. Government established €200 million fund for awareness, commemoration, and community support.',
    ARRAY[
        'Formal government apology for 250 years of Dutch slavery',
        '€200 million fund established',
        'Apology addressed to Suriname, Caribbean Netherlands, descendants worldwide',
        'King Willem-Alexander subsequently apologized (July 2023)'
    ],
    'CRITICAL CONTEMPORARY PRECEDENT: Proves governments CAN and DO acknowledge slavery debt in 2023. €200M is inadequate (Dutch slave trade was worth billions) but establishes principle of ongoing obligation. Demolishes "too much time has passed" defense alongside UK 2015 payoff.'
)
ON CONFLICT DO NOTHING;

-- =============================================================================
-- SECTION 13: VIEWS FOR ANALYSIS
-- =============================================================================

-- View: Legal precedents by strength
CREATE OR REPLACE VIEW legal_precedents_by_strength AS
SELECT
    'UK 1833 Loan' AS precedent_name,
    'PRIMARY - Intergenerational Debt' AS category,
    '182 years of government-enforced payments' AS key_fact,
    '2015' AS resolution_year,
    'Proves slavery debts CAN be collected over centuries' AS legal_significance
UNION ALL
SELECT
    'Haiti Independence Debt',
    'COUNTER-PRECEDENT - Inverse Reparations',
    '$21 billion extorted from victims for their own freedom',
    '1947',
    'Proves reparations logic was APPLIED against victims - must be reversed'
UNION ALL
SELECT
    'Netherlands 2023',
    'CONTEMPORARY - Active Recognition',
    '€200M fund + formal apology',
    '2023',
    'Proves ongoing obligation recognized by modern governments'
UNION ALL
SELECT
    'Farmer-Paellmann 2004',
    'FAILURE ANALYSIS - Strategic Lessons',
    'Class action dismissed on standing/SOL',
    '2004',
    'Individual claims with documented lineage avoid these failures';

-- View: Jurisdiction-specific strategies
CREATE OR REPLACE VIEW jurisdiction_strategies AS
SELECT 
    lj.country_name,
    lj.legal_system,
    lj.compensation_to_whom AS historical_compensation,
    lj.has_paid_reparations,
    CASE 
        WHEN lj.country_name = 'United Kingdom' THEN 'UK 1833 loan as primary precedent for intergenerational debt'
        WHEN lj.country_name = 'France' THEN 'Haiti inverse debt + Code Noir property classification'
        WHEN lj.country_name = 'Haiti' THEN 'Victim status - OWED reparations from France'
        WHEN lj.country_name = 'United States' THEN 'DAAs + Farmer-Paellmann lessons + 13th Amendment badges'
        WHEN lj.country_name = 'Spain' THEN 'Asiento treaties + Cuba gradual abolition compensation evidence'
        WHEN lj.country_name = 'Netherlands' THEN '2023 precedent proves ongoing obligation'
        ELSE 'Strategy pending'
    END AS recommended_approach
FROM legal_jurisdictions lj;

-- =============================================================================
-- SECTION 14: INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_legal_texts_jurisdiction ON legal_texts(jurisdiction_id);
CREATE INDEX IF NOT EXISTS idx_legal_texts_type ON legal_texts(text_type);
CREATE INDEX IF NOT EXISTS idx_legal_doctrines_type ON legal_doctrines(doctrine_type);
CREATE INDEX IF NOT EXISTS idx_garnishment_defendant_type ON garnishment_mechanisms(defendant_type);
CREATE INDEX IF NOT EXISTS idx_escrow_status ON reparations_escrow(escrow_status);

-- =============================================================================
-- MIGRATION COMPLETE
-- =============================================================================

SELECT 'Migration 031: Triangle Trade Legal Framework Complete' AS status;
SELECT 
    (SELECT COUNT(*) FROM legal_jurisdictions) AS jurisdictions,
    (SELECT COUNT(*) FROM legal_texts) AS legal_texts,
    (SELECT COUNT(*) FROM legal_doctrines) AS doctrines,
    (SELECT COUNT(*) FROM garnishment_mechanisms) AS mechanisms;
