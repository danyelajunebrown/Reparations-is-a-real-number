# Reparations Calculation Formula - CORRECTED

## Critical Conceptual Correction

**INCORRECT (Previous Understanding):**
```
Total Debt = Original Enslavement Debt
           + Compensation TO Owners (wrong party paid)
           + Broken Promises (awarded but unpaid)
```

**CORRECT (Current Understanding):**
```
Total Reparations = Wage Theft
                  + Portion of Business Proceeds
                  + Damages
```

## Why the Correction Matters

### Compensation TO Owners is NOT Added to Debt

Compensation payments TO slave owners serve a different purpose in our calculations:

1. **Compensation is EVIDENCE**, not a component of debt
2. It tells us the **business/asset value at time of emancipation**
3. It reveals what the economic system valued at that moment
4. We use this information to **calculate proceeds**, not add it directly

### The Role of Compensation in Calculations

```
Compensation Payment → Evidence of Business Value → Calculate Proceeds Portion
                                                            ↓
                                                    Add to Reparations Total
```

**Example: Isaac Royall Jr. Estate**

- Compensation received by heirs: £X (hypothetical)
- This tells us: The Royall estate was worth £X at emancipation
- We then research: What portion of that £X came from Belinda Sutton's 50 years of labor?
- **Her portion of proceeds** = What she's owed, NOT the compensation amount itself

## The Three Components (Corrected Formula)

### Component 1: Wage Theft

**Definition:** Unpaid wages for labor performed

**Calculation:**
- Years of enslavement × Fair market wage rate × Hours worked
- Adjusted for inflation to modern value
- May vary by skill level, type of work, region

**Example:**
```
Belinda Sutton: 50 years as domestic servant
Fair wage (1733-1783): £20/year
Total wage theft: £1,000
Modern value: ~$850,000
```

### Component 2: Portion of Business Proceeds

**Definition:** The enslaved person's rightful share of business value/proceeds

**Calculation Process:**
1. Research owner's business assets and reports from time period
2. Determine what portion of business value came from enslaved person's:
   - Labor hours
   - Human capital
   - Productivity
   - Skills and training
3. That portion of business value (and ongoing proceeds) belongs to them

**Why Compensation Helps:**
- Compensation TO owner tells us: "Business was worth $X at emancipation"
- We then calculate: "What % of that $X was due to enslaved person's contribution?"
- That % × $X = Portion of business proceeds owed

**Example:**
```
Isaac Royall Jr. Estate Value: £10,000 (1783)
Belinda's contribution: 50 years of labor in household operations
Research needed:
- What was household's economic value?
- What portion came from her labor vs other factors?
- What were ongoing proceeds from estate assets?

Hypothetical calculation:
If her labor = 30% of estate value
Then her portion = £3,000 = ~$2,550,000 modern value
```

### Component 3: Damages

**Definition:** Compensation for human rights violations beyond economic loss

**Categories:**
- Human dignity violations
- Family separation
- Physical/psychological harm
- Loss of freedom
- Cultural destruction
- Generational trauma

**Calculation:**
- Base amount per category (e.g., $50,000 for human dignity)
- Multiplied by severity and duration
- Adjusted for compound interest (delayed justice)

**Example:**
```
Base damages: $100,000
Compound interest (2% × 242 years): ×146
Total damages: ~$14,600,000
```

## Complete Example: Belinda Sutton Case

### Historical Facts:
- Enslaved by Isaac Royall Jr.: 1733-1783 (50 years)
- Petition filed: February 14, 1783
- Award granted: £15 annually + £12 back payment
- Payments made: Only £27 total (23% fulfillment)

### Reparations Calculation (Corrected Formula):

#### Component 1: Wage Theft
```
Years enslaved: 50
Fair wage: £20/year (conservative)
Total: £1,000
Modern value: $850,000
```

#### Component 2: Portion of Business Proceeds
```
Royall Estate value at emancipation: ~£10,000 (estimated)
Research needed on:
- Household operations and management
- Belinda's role and responsibilities
- What portion of estate value came from her labor

Placeholder calculation (pending research):
Contribution estimate: 30% of household operations
Her portion: £3,000 = $2,550,000 modern value
```

#### Component 3: Damages
```
Base damages: $100,000
- Human dignity violation: $50,000
- 50 years loss of freedom: $50,000
Compound interest (2% × 242 years): ×146
Total: $14,600,000
```

#### Total Reparations Owed:
```
Wage Theft:           $850,000
Business Proceeds:  $2,550,000
Damages:           $14,600,000
------------------------
TOTAL:            $18,000,000
```

### What About the Broken Promise?

The **broken promise** (awarded £15/year but only paid £27) is captured in **Component 1 (Wage Theft)**:

- The petition and award PROVE wage theft occurred
- The government ACKNOWLEDGED the debt
- Only paying 23% = **evidence of ongoing theft**
- The unpaid amount adds to wage theft total
- Broken promise penalty = additional damages

So broken promises don't need a separate component—they're evidence that strengthens the wage theft and damages calculations.

## Research Requirements

### For Each Enslaved Person's Business Proceeds Calculation:

1. **Owner's Business/Asset Data:**
   - Business type (plantation, factory, shipping, etc.)
   - Asset valuations at time of emancipation
   - Financial records, business reports, tax records
   - What compensation payment represented

2. **Business Operations Research:**
   - Total workforce (enslaved + free workers)
   - Labor organization and structure
   - Productivity metrics
   - Revenue and profit data
   - Cost structure

3. **Enslaved Person's Contribution:**
   - Years of service
   - Type of labor performed
   - Skill level
   - Role in business operations
   - Comparable free worker wages

### Archive Sources by Business Type:

**Plantation:**
- State Historical Societies
- University Special Collections
- Plantation Records Archives
- Look for: Crop yields, labor schedules, overseer reports, financial ledgers

**Factory/Industry:**
- Business Archives
- Corporate Records
- Industrial History Collections
- Look for: Production records, employment records, financial statements

**Shipping/Maritime:**
- Maritime Museums
- Port Authority Records
- Customs Records
- Look for: Ship manifests, cargo records, crew lists, voyage profits

**Banking/Finance:**
- Financial Institution Archives
- Bank Records
- Corporate Histories
- Look for: Loans secured by enslaved people, asset valuations

## Database Implementation

### New Tables (Migration 012):

1. **business_asset_records** - Store business/asset data
2. **proceeds_calculation_methods** - Store calculation methodologies
3. **proceeds_research_needed** - Track what research is needed
4. **calculated_reparations** - Final calculations using corrected formula

### Key Fields:

```sql
calculated_reparations:
  - wage_theft_amount          (Component 1)
  - business_proceeds_portion  (Component 2)
  - damages_amount            (Component 3)
  - total_reparations         (Sum of 1+2+3)
  - total_with_interest       (With compound interest)
```

## Service Implementation

### ProceedsCalculator.js

**Purpose:** Calculate Component 2 (Business Proceeds Portion)

**Methods:**
- `calculateProceedsPortion()` - Calculate proceeds with various methodologies
- `calculateTotalReparations()` - Combine all three components
- `createResearchTask()` - Track needed research
- `generateResearchNeededReport()` - Guide research efforts

**Status:** PLACEHOLDER - Contains structure and methodology guidance. Each case requires specific historical research to determine accurate proceeds calculations.

## Integration with Existing Systems

### CompensationTracker.js

**UPDATED ROLE:** Evidence collection, not debt addition

- Still tracks compensation paid TO owners
- Now used to inform business value assessments
- Links to business_asset_records table
- Provides data for proceeds calculations

### PetitionTracker.js

**INTEGRATED WITH:** Wage theft and damages calculations

- Petitions prove wage theft occurred
- Awards quantify minimum owed
- Broken promises add to damages
- Links to calculated_reparations table

### Smart Contract (ReparationsEscrow.sol)

**Tracks both:**
- Modern blockchain payments
- Historical payments received (via historicalPaymentsReceived field)
- Net debt calculation accounts for both

## Next Steps

1. **For Each Owner:** Create business_asset_record entry
2. **Research:** Conduct historical research per business type guidance
3. **Calculate:** Use ProceedsCalculator with research findings
4. **Validate:** Peer review methodology and calculations
5. **Store:** Save to calculated_reparations table
6. **Blockchain:** Record final amounts for distribution

## Summary

**The Corrected Understanding:**

✅ **Wage Theft** - Unpaid labor value
✅ **Business Proceeds Portion** - Enslaved person's share of business value (informed by compensation data)
✅ **Damages** - Human rights violations + compound interest

❌ **NOT added directly:** Compensation TO owners (it's evidence, not a debt component)

**Key Insight:**
Compensation payments don't reduce OR increase the debt—they help us **calculate** what the debt is by revealing the business value that the enslaved person helped create.

---

**Files Updated:**
- `/migrations/012-business-proceeds-calculations.sql` - New schema
- `/src/services/reparations/ProceedsCalculator.js` - New service
- `/src/services/reparations/CompensationTracker.js` - Conceptual notes updated
- This document - Complete explanation

**Status:** ✅ System ready to hold and refine proceeds calculations with future research
