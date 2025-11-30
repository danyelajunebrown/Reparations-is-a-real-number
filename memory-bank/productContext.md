# Product Context: Reparations Is A Real Number

## User Personas

### 1. **Sarah - Descendant Seeking Reparations**
- **Background:** African American woman researching her family history, discovered ancestors enslaved by James Hopewell
- **Goals:**
  - Verify her ancestral connection to enslaved persons
  - Calculate reparations owed to her family
  - Receive payment distribution through blockchain
- **Pain Points:**
  - Historical records are scattered and difficult to access
  - No transparent system for calculating what's owed
  - Legal barriers to pursuing reparations
- **Needs:**
  - Easy document upload and OCR processing
  - Integration with FamilySearch for genealogical verification
  - Clear calculation methodology showing her share
  - Secure blockchain payment mechanism

### 2. **Dr. James - Genealogical Researcher**
- **Background:** Professional genealogist specializing in African American history
- **Goals:**
  - Access historical documents for client research
  - Build comprehensive family trees
  - Contribute verified records to the platform
- **Pain Points:**
  - Documents stored in multiple archives
  - Handwritten 1700s-1800s documents difficult to read
  - No centralized database of enslaved persons
- **Needs:**
  - High-quality OCR with Google Vision API
  - Search functionality across all documents
  - Export capabilities for research reports
  - Collaboration tools for verification

### 3. **Professor Martinez - Historian & Archivist**
- **Background:** University professor contributing primary source documents
- **Goals:**
  - Digitize and preserve historical records
  - Ensure academic rigor in data extraction
  - Build cases for institutional reparations
- **Pain Points:**
  - Document authenticity verification
  - OCR accuracy varies with document condition
  - Need for peer review process
- **Needs:**
  - Document upload with metadata (date, location, source)
  - Human verification queue for OCR results
  - Citation and provenance tracking
  - Statistical dashboard for research

### 4. **Attorney Chen - Legal Advocate**
- **Background:** Civil rights lawyer building reparations cases
- **Goals:**
  - Access defensible reparations calculations
  - Track slaveowner debt inheritance chains
  - Present evidence in legal proceedings
- **Pain Points:**
  - Economic models must be legally defensible
  - Need immutable proof of records (blockchain/IPFS)
  - Tracking debts across generations
- **Needs:**
  - Transparent calculation breakdowns
  - IPFS document hashing for immutability
  - Smart contract audit trail
  - Export functionality for legal documents

## Core Product Features

### Document Processing Pipeline
**User Flow:**
1. User uploads historical document (PDF, JPG, PNG, HEIC)
2. System detects actual file type (magic number validation)
3. File stored to AWS S3 with IPFS hash generated
4. OCR processing (Google Vision API → Tesseract.js fallback)
5. Data extraction: enslaved names, owner info, relationships
6. Database insert with verification queue flag
7. User receives document ID and OCR results

**Technical Implementation:**
- Multer for file uploads (50MB limit)
- StorageAdapter with S3 persistence (fixes Render ephemeral filesystem)
- File type detection prevents corruption (.pdf with text content)
- PostgreSQL with `documents`, `enslaved_people`, `families` tables

### Genealogical Verification
**User Flow:**
1. User enters descendant information (name, birth year, location)
2. System queries FamilySearch API for family tree data
3. Algorithm matches enslaved ancestors to descendants
4. Calculates descendant share percentage
5. Verification queue for human review
6. Approved records move to blockchain queue

**Technical Implementation:**
- FamilySearch OAuth integration
- `familysearch-reparations-integration.js` module
- `verification_reviews` table with reviewer assignments
- Views: `verification_queue`, `blockchain_queue`

### Reparations Calculation Engine
**Economic Model:**
- **Base Wage Theft:** Minimum wage equivalent for labor (1700s-1865)
- **Inflation Adjustment:** CPI-adjusted to current dollars
- **Compound Interest:** 6% annual rate from emancipation to present
- **Pain & Suffering Damages:** Multiplier based on severity
- **Descendant Distribution:** Equal shares among verified descendants

**User Experience:**
- Detailed breakdown shown to users
- `reparations_breakdown` table stores component values
- Statistical dashboard shows aggregate calculations
- Exportable reports for legal use

**Technical Implementation:**
- `reparations-calculator.js` module
- Inflation data from historical CPI
- `debt-tracker.js` for inheritance chain tracking
- PostgreSQL views: `owner_summary`, `stats_dashboard`

### Blockchain Payment Distribution
**User Flow:**
1. Verified descendant registers Ethereum wallet address
2. Reparations amount calculated and approved
3. Smart contract escrow created with IPFS proof
4. Payment deposited by responsible party (estate, institution)
5. Multi-signature verification triggers distribution
6. Funds transferred to descendant wallets
7. Immutable transaction recorded on-chain

**Technical Implementation:**
- Solidity smart contracts: `ReparationsEscrow.sol`, `ReparationsLedger.sol`
- Web3.js integration in frontend (`app.js`)
- MetaMask wallet connection
- OpenZeppelin patterns: ReentrancyGuard, Ownable, Pausable

### Research Assistant (FREE Natural Language Processing)
**User Flow:**
1. User types question: "How many enslaved people did James Hopewell own?"
2. System extracts entities (person: "James Hopewell")
3. Intent classification: count query
4. Database search: `documents` and `enslaved_people` tables
5. Natural language response: "James Hopewell enslaved 32 people..."
6. Context stored for follow-up questions
7. User asks: "How much does he owe?" (pronoun resolution)
8. System retrieves reparations total for same person

**Technical Implementation:**
- Regex-based pattern matching (no external AI APIs)
- In-memory session management
- Entity extraction from capitalization patterns
- Intent classification: search/count/stats/lineage
- Pronoun resolution using context
- `/api/llm-query` endpoint
- Zero API costs, works offline

**Supported Question Types:**
- Person searches: "Do you have James Hopewell?"
- Count queries: "How many enslaved people did he own?"
- Reparations: "How much does James Hopewell owe?"
- Statistics: "Show me database statistics"
- Follow-ups: "Tell me more about them" (context-aware)

## User Workflows

### Primary Workflow: Descendant Claims Process
```
Document Upload → OCR Processing → Data Extraction
                                          ↓
Genealogy Verification ← User Submits Ancestry Info
                                          ↓
Descendant Matching ← FamilySearch API Query
                                          ↓
Reparations Calculation ← Economic Model Applied
                                          ↓
Human Verification Queue ← Reviewer Assignment
                                          ↓
Blockchain Submission ← Smart Contract Creation
                                          ↓
Payment Distribution ← Escrow Release Triggered
                                          ↓
Transaction Complete ← Funds Transferred to Wallet
```

### Secondary Workflow: Historical Research
```
Researcher Uploads Document → Metadata Entry (date, location, source)
                                          ↓
OCR Processing (Google Vision) → Text Extraction
                                          ↓
Human Verification → Correction of OCR Errors
                                          ↓
Enslaved Names Extracted → Family Groupings Created
                                          ↓
Database Entry → Searchable via Research Assistant
                                          ↓
Export for Publication → Citation with IPFS Hash
```

### Tertiary Workflow: Legal Documentation
```
Attorney Searches Database → Finds Relevant Documents
                                          ↓
Reparations Calculation Accessed → Detailed Breakdown Exported
                                          ↓
Debt Inheritance Chain Traced → Multi-Generational Tracking
                                          ↓
IPFS Hash Retrieved → Immutable Document Proof
                                          ↓
Smart Contract Evidence → Blockchain Transaction History
                                          ↓
Legal Brief Prepared → Court Submission
```

## Privacy & Ethical Considerations

### Data Sensitivity
- **Personal Information:** Handling living descendants' names, addresses, financial data
- **Ancestral Records:** Respectful treatment of enslaved persons' histories
- **Family Relationships:** Sensitive genealogical connections
- **Financial Data:** Reparations amounts and payment information

### Security Measures
- **Authentication:** JWT-based authentication (currently not implemented - PRIORITY)
- **Database Encryption:** PostgreSQL SSL connections
- **Blockchain Privacy:** Wallet addresses pseudonymous
- **IPFS:** Public hashes, but content can be private
- **S3 Storage:** Private bucket with IAM access control

### Ethical Guidelines
1. **Consent:** Descendants must opt-in to claims process
2. **Transparency:** All calculations publicly auditable
3. **Accuracy:** Human verification required before blockchain submission
4. **Respect:** Enslaved persons' names handled with dignity
5. **No Exploitation:** Platform is NOT for profit or political agenda
6. **Academic Rigor:** Historical claims must be verifiable
7. **Legal Compliance:** GDPR/privacy law adherence for descendant data

### Bias Mitigation
- **OCR Quality:** Multiple services prevent single-vendor bias
- **Calculation Model:** Transparent, peer-reviewable methodology
- **Verification:** Human review prevents algorithmic errors
- **Genealogy:** Multiple sources (FamilySearch, Ancestry) cross-referenced
- **Historical Records:** Acknowledge incomplete documentation for certain regions/time periods

### Accessibility
- **Language:** Support for multiple languages (planned)
- **Interface:** Screen reader compatible (needs improvement)
- **Education:** Documentation explains blockchain/genealogy concepts
- **Assistance:** Research Assistant uses plain language
- **Cost:** Free to use (blockchain gas fees explained upfront)

## Product Constraints

### Technical Limitations
- **OCR Accuracy:** 1700s handwriting difficult to read (60-80% confidence)
- **Document Condition:** Faded, damaged records may be unreadable
- **Blockchain Costs:** Ethereum gas fees can be expensive
- **Processing Time:** Large PDFs take minutes to process
- **Storage Costs:** S3 and IPFS hosting costs scale with document volume

### Data Constraints
- **Incomplete Records:** Many enslaved persons not documented
- **Name Variations:** Spelling inconsistencies across documents
- **Fragmented Families:** Genealogical gaps due to forced separation
- **Regional Bias:** More records for certain states (Virginia, Maryland, South Carolina)
- **Time Period:** Most documents 1700s-1865, few earlier records

### Legal & Regulatory
- **No Legal Authority:** Platform cannot enforce payments
- **Jurisdictional Issues:** International descendants, multi-state estates
- **Statute of Limitations:** Legal barriers to claims
- **Estate Complexity:** Tracking multi-generational debt difficult
- **Privacy Laws:** GDPR, CCPA compliance required

### User Experience Constraints
- **Learning Curve:** Blockchain/wallet setup intimidating for non-technical users
- **Verification Delays:** Human review creates bottlenecks
- **Payment Uncertainty:** Cannot guarantee responsible parties will pay
- **Emotional Impact:** Confronting ancestral trauma is difficult
- **Trust:** Users may distrust blockchain/crypto technology

## Success Metrics

### User Acquisition
- Number of descendants registered
- Number of researchers contributing documents
- Number of legal advocates using platform

### Document Processing
- Documents uploaded per month
- OCR success rate (% with >80% confidence)
- Average processing time per document
- IPFS hashes generated

### Genealogical Verification
- Enslaved ancestors identified
- Descendants verified and connected
- FamilySearch API query success rate
- Verification queue processing time

### Economic Impact
- Total reparations calculated
- Average reparations per descendant
- Number of debt inheritance chains traced
- Breakdown by region/time period

### Blockchain Activity
- Smart contracts deployed
- Payment deposits received
- Distributions executed
- Transaction success rate
- Gas fees paid (monitoring costs)

### User Engagement
- Research Assistant queries per day
- Average session duration
- Document downloads/exports
- Repeat user rate

---

*This document provides the product perspective for the Reparations Platform. It focuses on user needs, workflows, and ethical considerations.*
