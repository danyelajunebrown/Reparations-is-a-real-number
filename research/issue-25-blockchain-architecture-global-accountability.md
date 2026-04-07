# Issue #25: Blockchain Architecture for Global Accountability

## Current State in the Codebase

**What exists:**
- `contracts/contracts/ReparationsEscrow.sol` -- Deployed on Base Mainnet (0x914846ceA07e57d848d9d60C8238865D83d9ab1E)
- Handles: DAA record submission, USDC deposits, descendant verification, payment distribution
- `src/api/routes/blockchain.js` -- Read/write API endpoints for the contract
- `contracts/ReparationsLedger.sol` -- Earlier contract (possibly deprecated)

**What it currently does:** It is a payment escrow for individual DAA participants. Acknowledgers submit records, deposit USDC, verified descendants receive distributions.

**What the user envisions:** "The heartbeat of HOW accountability for unrepaired economic/chattel harm is quantified/computed/visualized/theorized the world over." This is fundamentally different from a payment ledger.

## The Gap Between Current and Vision

| Current State | Desired State |
|---------------|---------------|
| Payment escrow for US participants | Global accountability infrastructure |
| Records individual DAAs | Records ALL slavery-related economic events |
| Denominated in USDC | Multi-currency, multi-chain |
| One smart contract on Base | Protocol that others build on |
| Tracks acknowledger payments | Tracks corporate events, inheritance filings, wealth transfers, government actions |
| Passive (waits for submissions) | Active (listens to external data feeds) |

## Current Academic/Industry State of the Art

### Blockchain Governance Projects (DAOs)

As of 2025, there are 13,000+ DAOs created, 6,000+ with regular activity, managing $24.5 billion in collective assets across 11 million token holders.

**Relevant DAO models:**

1. **Gitcoin / Quadratic Funding:**
   - Distributes funding based on number of unique contributors, not amount contributed
   - GG23 (2024): Distributed $1.3M+ through quadratic + retroactive funding simultaneously
   - **Relevance:** The "badgeholder voting mechanism" could be adapted for verifying reparations claims. Instead of voting on who gets grants, stakeholders vote on the validity of historical claims.

2. **Nouns DAO:**
   - Treasury-governed NFT project where each NFT = 1 vote
   - Funds public goods proposals via on-chain voting
   - **Relevance:** Model for how a reparations DAO could govern fund allocation. Each verified descendant or acknowledger could hold a governance token.

3. **Kleros (Decentralized Arbitration):**
   - On-chain dispute resolution using crypto-economic incentives
   - Jurors stake tokens and are penalized for incorrect rulings
   - **Relevance:** Could be adapted for adjudicating disputed genealogical claims or contested DAAs.

4. **MakerDAO:**
   - Governs the DAI stablecoin via decentralized governance
   - Multi-collateral system with risk parameters set by token holders
   - **Relevance:** Model for how a reparations fund could be governed -- multiple asset types backing a stable reparations obligation.

### Blockchain-Based Accountability/Transparency Systems

1. **Polymarket (Prediction Markets):**
   - Uses UMA oracles to verify real-world events
   - "Throughout 2025 and into Q1 2026, prediction markets consistently front-ran official confirmations of corporate layoffs and local political upsets"
   - **Relevance:** Oracle pattern for feeding real-world events (corporate disclosures, inheritance filings) into on-chain logic

2. **Chainlink (Oracle Network):**
   - Late 2025: Launched effort to blend oracles, blockchain, and AI for real-time standardized data on corporate activity
   - **Relevance:** Could be the infrastructure layer for feeding SEC filings, property transfers, and corporate events into a reparations accountability chain

3. **Hypercerts (Impact Certificates):**
   - On-chain certificates that represent positive impact claims
   - Can be verified, traded, and used to retroactively fund proven impact
   - **Relevance:** A "Slavery Accountability Certificate" could work similarly -- on-chain records that corporations or individuals have acknowledged and addressed their slavery connections

## What Should the Chain LISTEN To?

This is the critical architecture question. The chain needs oracles that feed in:

### Category 1: Corporate Events (Automatable)
| Event | Data Source | Oracle Method |
|-------|------------|---------------|
| M&A involving Farmer-Paellmann defendants | SEC EDGAR (8-K filings) | Chainlink/custom oracle polling EDGAR API |
| Quarterly earnings of identified corporations | SEC EDGAR (10-Q) | Standard financial data oracle |
| Corporate slavery disclosures | Municipal disclosure ordinances | Custom scraper oracle |
| Stock price of identified corporations | Public market data | Chainlink price feeds (already exist) |
| Corporate name changes / restructuring | SEC EDGAR, state SOS databases | Custom oracle |

### Category 2: Wealth Transfer Events (Partially Automatable)
| Event | Data Source | Oracle Method |
|-------|------------|---------------|
| Property sales in historically enslaved-labor areas | County recorder websites | Custom scraper oracle (per-county) |
| Estate filings / probate | County courts | Mostly manual; some states digitized |
| Large charitable gifts by slaveholder descendants | IRS Form 990 (for recipient orgs) | Custom oracle on ProPublica Nonprofit Explorer API |
| Trust distributions | Private (not publicly accessible) | Requires voluntary disclosure |

### Category 3: Government Actions (Manual/Semi-Auto)
| Event | Data Source | Oracle Method |
|-------|------------|---------------|
| Municipal reparations programs (Evanston, etc.) | City council records | Manual entry with multi-sig verification |
| State reparations legislation | LegiScan API | Custom oracle |
| Federal reparations legislation (HR 40) | Congress.gov API | Custom oracle |
| International reparations resolutions (UN, ICJ) | UN documentation | Manual entry |
| Apologies by governments/institutions | News monitoring | Manual entry with verification |

### Category 4: Genealogical/Historical (Manual with Verification)
| Event | Data Source | Oracle Method |
|-------|------------|---------------|
| New enslaved person records discovered | Your platform's ancestor climber | Direct from your backend |
| New slaveholder-descendant linkages verified | Ancestor climb matches | Direct from your backend |
| DAA signings | Your platform | Direct from your backend |
| Historical document digitization | FamilySearch, National Archives | Manual entry |
| Academic research publications | DOI/CrossRef API | Custom oracle |

## Architecture: From Escrow to Protocol

### Phase 1: Enhanced Escrow (Current + Near-Term)
What you have now, improved:
```
ReparationsEscrow.sol (Base Mainnet)
  |-- DAA Records (on-chain)
  |-- USDC Deposits
  |-- Descendant Verification
  |-- Payment Distribution
  +-- NEW: Event Log (emitted events for all state changes)
```

### Phase 2: Accountability Ledger (Medium-Term)
A new contract that records accountability events, separate from payments:
```
ReparationsAccountabilityLedger.sol (Base Mainnet)
  |-- Corporate Accountability Records
  |     |-- Entity ID (linked to Farmer-Paellmann defendants)
  |     |-- Event Type (disclosure, apology, reparation, M&A)
  |     |-- Evidence Hash (IPFS)
  |     |-- Timestamp
  |     +-- Verifier Signatures (multi-sig)
  |
  |-- Individual Accountability Records
  |     |-- DAA Reference (link to Escrow contract)
  |     |-- Genealogical Evidence Hash (IPFS)
  |     |-- Payment History (cross-reference)
  |     +-- Verification Status
  |
  |-- Government Action Records
  |     |-- Jurisdiction
  |     |-- Action Type (apology, legislation, payment)
  |     |-- Evidence Hash
  |     +-- Verified By
  |
  +-- Oracle Integration Points
        |-- Chainlink Automation (for SEC filing checks)
        |-- Custom Oracle (for property/corporate events)
        +-- Manual Submission (with multi-sig verification)
```

### Phase 3: Protocol Layer (Long-Term Vision)
A standard that OTHER platforms can build on:
```
IReparationsProtocol (Interface)
  |-- registerClaim(bytes32 claimHash, ClaimType, Jurisdiction)
  |-- verifyClaim(uint256 claimId, bytes evidence)
  |-- recordAccountabilityEvent(uint256 entityId, EventType, bytes evidence)
  |-- queryDebt(uint256 entityId) returns (uint256)
  |-- queryPayments(uint256 entityId) returns (Payment[])

ReparationsRegistry.sol (Canonical registry)
  |-- Maps entity IDs to accountability records across chains
  |-- Cross-chain bridge support (Base <-> Ethereum <-> other L2s)
  |-- Governance by token holders (ReparationsDAO)

ReparationsDAO.sol (Governance)
  |-- Token: $REPAIR or similar
  |-- Voting on: methodology parameters, entity classifications, fund allocation
  |-- Quadratic voting for descendant voice amplification
  |-- Veto power for verified descendants (prevents capture by non-stakeholders)
```

## Critical Design Decisions

### 1. What Goes On-Chain vs. Off-Chain?

**On-chain (immutable, public, expensive):**
- DAA commitments (hashes, not full text)
- Payment records
- Accountability event records (hashes + metadata)
- Governance votes
- Entity classifications (slaveholder, corporation, etc.)

**Off-chain (mutable, private/semi-private, cheap):**
- Full DAA document text (IPFS, pinned)
- Genealogical research data (IPFS or your PostgreSQL)
- Personal information (income, net worth -- NEVER on-chain)
- Full-text evidence documents (IPFS)

### 2. Who Can Submit Records?

**Permissioned at first, progressively decentralized:**
- Phase 1: Only your platform's backend (server-side signer)
- Phase 2: Verified partners (CARICOM, UCL LBS, Georgetown) via multi-sig
- Phase 3: Any verified participant, with stake-weighted dispute resolution

### 3. How to Prevent Capture?

The biggest risk for a reparations DAO is capture by non-stakeholders (speculators, bad-faith actors).

**Safeguards:**
- Governance tokens are NON-TRANSFERABLE (soulbound) for verified descendants
- Acknowledger tokens grant PAYMENT rights but limited governance rights
- Academic/institutional partners get advisory roles, not voting power
- Quadratic voting ensures many small voices outweigh few large ones
- Emergency pause mechanism (already in ReparationsEscrow.sol via Pausable)

## What's Been Tried Before

### Worked:
- **Gitcoin's quadratic funding:** Proven at scale ($1.3M+ distributed in GG23). The mathematical framework (Buterin, Hitzig, Weyl 2018) is peer-reviewed.
- **Chainlink oracles:** Industry standard for feeding real-world data to smart contracts. Proven with billions in DeFi TVL.
- **IPFS for evidence storage:** Standard pattern for on-chain systems that need to reference large documents.

### Failed/Problematic:
- **ConstitutionDAO:** Demonstrated both the power and fragility of DAO fundraising. Raised $47M but governance was chaotic.
- **Token speculation:** ANY governance token risks becoming a speculative asset, distorting its governance purpose. Soulbound (non-transferable) tokens mitigate this.
- **"Blockchain for social good" projects generally:** Most fail not due to technology but due to (a) solving a problem that doesn't need blockchain, or (b) no actual community adoption.

### The Hard Question: Does This Need Blockchain?

**What blockchain UNIQUELY provides:**
1. **Immutability:** Once a DAA is recorded, it cannot be un-recorded. This matters for accountability.
2. **Transparency:** Anyone can verify the ledger. No single entity controls the record.
3. **Programmable payments:** Escrow, automated distribution, multi-sig governance.
4. **Cross-border operation:** No single government can shut it down. Critical for a GLOBAL slavery accountability system.
5. **Composability:** Other projects can build on top of your protocol.

**What blockchain DOES NOT help with:**
1. Data quality (garbage in, garbage out -- blockchain doesn't verify genealogical accuracy)
2. Community adoption (technology doesn't create moral will)
3. Legal enforceability (courts don't recognize smart contracts as legal instruments, yet)
4. Privacy (public chains expose all transactions)

## Concrete Next Steps

### Immediate (This Quarter):
1. **Add event logging to ReparationsEscrow.sol** -- ensure every state change emits a detailed event. This is the foundation for the accountability ledger.
2. **Create an IPFS pinning pipeline** -- DAA documents and evidence should be stored on IPFS with their hashes recorded on-chain.
3. **Build a public dashboard** reading from the Base Mainnet contract -- total DAAs recorded, total payments, total acknowledged debt. This IS the "heartbeat" visualization.

### Near-Term (Next 6 Months):
4. **Deploy ReparationsAccountabilityLedger.sol** -- a separate contract from the escrow that records accountability events (corporate disclosures, government actions, etc.).
5. **Build a Chainlink Automation job** that polls SEC EDGAR weekly for 8-K filings from the 17 Farmer-Paellmann defendant ticker symbols and records relevant events on-chain.
6. **Design the governance token** -- soulbound (ERC-5192), non-transferable, issued to verified participants. Use ERC-721 with transfer restrictions, not ERC-20.

### Long-Term (12+ Months):
7. **Publish the IReparationsProtocol interface** as an open standard. Invite CARICOM, UCL, and other reparations researchers to review and adopt.
8. **Implement cross-chain support** -- if the protocol is to be truly global, it needs to work beyond Base Mainnet. Consider Ethereum mainnet for the canonical registry.
9. **Launch the DAO** with quadratic voting and soulbound governance tokens. Start with a small, trusted group of verified descendants and acknowledgers.

## Key Citations

- Buterin, V., Hitzig, Z. & Weyl, E.G. (2019). "A Flexible Design for Funding Public Goods." *Management Science* 65(11): 5171-5187. (Quadratic funding paper)
- Gitcoin. (2024). "GG23: A Milestone Round for Public Goods Funding." https://gitcoin.co/blog/gitcoin-grants-23-retro
- Frontiers in Blockchain. (2025). "Decentralizing governance: exploring the dynamics and challenges of digital commons and DAOs."
- Frontiers in Blockchain. (2025). "Governance for regenerative coordination: the evolution from DAO to DAO 3.0."
- Chainlink Labs. (2025). Blending oracles, blockchain, and AI for corporate activity data.
- ERC-5192: Minimal Soulbound NFTs. https://eips.ethereum.org/EIPS/eip-5192
- OpenZeppelin. Pausable, ReentrancyGuard, Ownable contracts (already used in your ReparationsEscrow.sol).
