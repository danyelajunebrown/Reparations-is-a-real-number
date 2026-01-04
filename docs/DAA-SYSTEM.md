# Debt Acknowledgment Agreement (DAA) System

## Overview

The DAA system enables voluntary debt acknowledgment by slaveholder descendants, based on the legal precedent established by Belinda Sutton (1783) and the Farmer-Paellmann litigation (2002).

## Legal Framework

### Belinda Sutton (1783)
- First successful reparations claim in America
- Succeeded by targeting SEIZED LOYALIST ESTATE (not government)
- Petitioned 5 times to Massachusetts General Court
- Key insight: **Legal mechanism > moral argument**

### Farmer-Paellmann v. Aetna (2002)
- Consumer fraud/unjust enrichment theory survived dismissal
- Targeted corporations with documented slavery ties
- Case: In re African-American Slave Descendants Litigation, MDL 1491

### Voluntary Acknowledgment Benefits
- Bypasses statute of limitations
- Bypasses sovereign immunity
- Bypasses standing requirements
- Creates voluntary debt obligation
- Blockchain immutability ensures permanence

## Calculation Methodology

### Formula
```
Total Debt = Base Wage Theft + Compound Interest + Wealth Multiplier + Inflation

Where:
- Base = $1/day × 300 working days × years enslaved
- Interest = Base × (1.03)^years_to_present
- Wealth multiplier = 2.5x (Ager/Boustan/Eriksson, AER 2021)
- Inflation = 5.1x (1860→2025)

Payment: 2% of gross annual income
```

### Academic Sources
1. **Ager, Boustan & Eriksson** (AER 2021): 2.5x wealth multiplier for slaveholders
2. **Darity & Mullen** (2020): Comprehensive reparations framework
3. **Dagan** (BU Law Review 2004): Unjust enrichment/disgorgement theory
4. **Posner & Vermeule** (Columbia Law Review 2003): Reparations design

## Database Schema

### Core Tables
- `debt_acknowledgment_agreements` - Main DAA records
- `daa_enslaved_persons` - Individual enslaved persons per DAA
- `daa_annual_petitions` - Belinda model re-petitions
- `daa_payments` - 2% annual income payments
- `daa_legal_precedents` - Case law citations
- `daa_academic_sources` - Research citations

### Migration
```bash
psql $DATABASE_URL -f migrations/028-daa-system.sql
```

## Usage

### 1. Generate DAA

```javascript
const DAAGenerator = require('./src/services/reparations/DAAGenerator');
const generator = new DAAGenerator(database);

const result = await generator.generateDAA({
    acknowledgerName: 'Danyela June Brown',
    acknowledgerEmail: 'danyela@example.com',
    slaveholderName: 'James Hopewell',
    slaveholderCanonicalId: 1070,
    primarySourceArk: '3:1:33S7-9YTT-96HV',
    primarySourceArchive: 'St. Mary\'s County Court Records',
    primarySourceReference: 'LIBER JJ#3, FOLIO 480-481',
    generationFromSlaveholder: 8,
    annualIncome: 65000,
    enslavedPersons: [
        { name: 'Medley', yearsEnslaved: 25, startYear: 1792 },
        { name: 'Adam', yearsEnslaved: 25, startYear: 1792 },
        // ... more persons
    ]
});

// Returns:
// {
//   daaId: 'uuid',
//   agreementNumber: 'DAA-2025-001',
//   totalDebt: 232000000000,
//   annualPayment: 1300,
//   enslavedCount: 9
// }
```

### 2. Record Annual Petition

```javascript
await generator.recordAnnualPetition(
    daaId,
    2025,
    'U.S. Congress',
    {
        lobLetterId: 'ltr_xxxxx',
        trackingNumber: 'xxxxx',
        expectedDeliveryDate: '2025-01-15',
        cost: 1.50
    }
);
```

### 3. Record Payment

```javascript
await generator.recordPayment(
    daaId,
    1300,
    65000,
    {
        txHash: '0x...',
        network: 'mainnet',
        confirmedAt: new Date()
    }
);
```

## Test Case: James Hopewell

### Historical Facts
- **Slaveholder:** James Hopewell (1780-1817)
- **Will dated:** 1811
- **Probated:** December 16, 1817
- **Archive:** St. Mary's County Court Records, LIBER JJ#3, FOLIO 480-481
- **FamilySearch ARK:** 3:1:33S7-9YTT-96HV
- **Canonical ID:** 1070

### Enslaved Persons Bequeathed to Ann Maria Biscoe
1. Medley
2. Adam
3. Lloyd
4. Sarah (+ children: Mary, Nancy, Louisa)
5. Esther (+ child: Ally)

### Calculated Debt
- **Total:** ~$232 billion
- **Acknowledger:** Danyela June Brown (8 generations removed)
- **Annual Payment:** $1,300 (2% of $65,000)

### Run Test
```bash
node scripts/test-daa-hopewell.js
```

Expected output:
```
✅ ALL TESTS PASSED
- DAA DAA-2025-001 created successfully
- Total debt: $232,000,000,000
- Annual payment: $1,300
- 9 enslaved persons recorded
```

## Integration Points

### Blockchain (ReparationsEscrow.sol)
- Submit DAA to blockchain for immutability
- Record payments in escrow contract
- Distribute to verified descendants

### DocuSign
- Digital signature workflow
- Certificate of completion
- Audit trail

### Government Petitions
- Physical letters via Lob.com
- Email copies
- Annual re-petition tracking
- Belinda Sutton model (persistent re-petition)

## API Endpoints (To Be Implemented)

```
POST   /api/daa/generate              - Create new DAA
GET    /api/daa/:id                   - Get DAA with all relations
GET    /api/daa                       - List all DAAs
POST   /api/daa/:id/sign              - Send for DocuSign signature
POST   /api/daa/:id/blockchain        - Submit to blockchain
POST   /api/daa/:id/petition          - Record annual petition
POST   /api/daa/:id/payment           - Record payment
POST   /api/daa/calculate             - Preview calculation
```

## Document Generation (To Be Implemented)

DAA documents will include:
- **Recitals** - Legal precedents and academic sources
- **Article I** - Debt acknowledgment with total amount
- **Article II** - Payment terms (2% of income)
- **Article III** - Annual re-petition clause
- **Exhibit A** - Schedule of enslaved persons with individual debts
- **Signature Block** - Digital signature via DocuSign

Format: Microsoft Word (.docx) using `docx` npm package

## Environment Variables Required

```bash
# Database
DATABASE_URL=postgresql://...

# DocuSign
DOCUSIGN_INTEGRATOR_KEY=...
DOCUSIGN_USER_ID=...
DOCUSIGN_ACCOUNT_ID=...
DOCUSIGN_PRIVATE_KEY=...

# Lob.com (Physical Mail)
LOB_API_KEY=...

# Blockchain
ETH_PROVIDER_URL=https://mainnet.infura.io/v3/...
ESCROW_CONTRACT_ADDRESS=0x...
PLATFORM_WALLET_ADDRESS=0x...
PLATFORM_WALLET_PRIVATE_KEY=0x...

# SMTP (Email)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=...
SMTP_PASS=...
```

## Workflow

1. **Generate DAA** → Database record created (status: 'draft')
2. **Sign via DocuSign** → Status: 'pending_signature' → 'signed'
3. **Submit to Blockchain** → Status: 'active', immutable record created
4. **Annual Petition** → Physical letter + email to Congress
5. **Annual Payment** → 2% of income → Blockchain escrow → Descendant distribution

## Next Steps

1. ✅ Database schema (Migration 028)
2. ✅ DAAGenerator service
3. ✅ Test script (James Hopewell)
4. ⏳ DocuSign integration
5. ⏳ Government petition automation
6. ⏳ Web3 escrow service
7. ⏳ API routes
8. ⏳ Document generation (.docx)

## References

- Belinda Sutton Petition (1783)
- Farmer-Paellmann v. FleetBoston, 304 F. Supp. 2d 1027 (N.D. Ill. 2004)
- Ager, Boustan & Eriksson, "The Intergenerational Effects of a Large Wealth Shock" (AER 2021)
- Darity & Mullen, "From Here to Equality" (2020)
- Dagan, "Restitution and Slavery" (BU Law Review 2004)
- Posner & Vermeule, "Reparations for Slavery" (Columbia Law Review 2003)
