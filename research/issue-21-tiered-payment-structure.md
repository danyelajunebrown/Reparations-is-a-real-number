# Issue #21: Tiered Payment Structure

## Current State in the Codebase

`DAAGenerator.js` line 79: `this.PAYMENT_PERCENTAGE = 0.02;` -- flat 2% of income, explicitly labeled as a placeholder. This is applied uniformly regardless of income level, slaveholder scale, or corporate connections.

## Current Academic State of the Art

### No One Has Designed This Before

There is no published academic framework for tiered INDIVIDUAL voluntary reparations payments. Existing frameworks are all at the government/institutional level:
- Darity & Mullen: Government taxation is the only ethical mechanism
- California Task Force: $1.2M lump sum per eligible descendant (no tiering on the payer side)
- Evanston IL: Flat $25,000 housing grants
- Georgetown: Flat $27.20/semester student fee

Your project is in genuinely uncharted territory here. The research below synthesizes from adjacent frameworks.

### Existing Restitution Frameworks and Tiering

**1. International Criminal Court (ICC) Trust Fund for Victims:**
- Awards vary by severity of harm suffered (physical injury vs. displacement vs. sexual violence)
- Payments are NOT means-tested on the perpetrator side
- Awards range from individual reparations to collective community programs

**2. ICHEIC (Holocaust Insurance Claims):**
- Payments based on face value of policy x country-specific multiplier
- No tiering by claimant's current wealth
- The multiplier approach (historical value x compounding factor) is more relevant to your debt CALCULATION, not the payment structure

**3. Japanese American Internment (Civil Liberties Act of 1988):**
- Flat $20,000 per surviving internee
- No tiering whatsoever
- Funded by federal appropriation

**4. German Holocaust Reparations (Luxembourg Agreement, 1952):**
- $65.2 billion total (adjusted)
- Tiered by TYPE OF HARM, not by perpetrator's means
- Individual payments + institutional fund + state-to-state transfers

**5. South African Truth and Reconciliation Commission:**
- Recommended R30,000/year for 6 years per victim
- Government actually paid R30,000 ONCE (total, not per year)
- Perpetrators who testified truthfully received amnesty -- no financial obligation

### Tax Bracket Structures as a Model

US federal income tax brackets (2025) provide the clearest tiering precedent:

| Bracket | Rate | Cumulative at top |
|---------|------|-------------------|
| $0 - $11,925 | 10% | $1,192 |
| $11,926 - $48,475 | 12% | $5,578 |
| $48,476 - $103,350 | 22% | $17,651 |
| $103,351 - $197,300 | 24% | $40,199 |
| $197,301 - $250,525 | 32% | $57,231 |
| $250,526 - $626,350 | 35% | $188,770 |
| $626,351+ | 37% | — |

Key design principles from tax brackets:
- **Marginal, not effective:** Each dollar is taxed at its bracket rate, not the highest rate
- **Progressive:** Higher earners pay more both in absolute and percentage terms
- **Indexed:** Brackets adjust for inflation annually
- **Widely understood:** Americans already think in bracket terms

### The Roosevelt Institute Stock Tax (December 2024)

This is the most innovative financing proposal:
- Corporations remit shares proportional to outstanding stock
- Progressive incidence: top 20% own 87% of equities
- One-time payment, not ongoing
- Could raise $1 trillion+ within a year
- Relevant for your CORPORATE tier, not individual acknowledgers

## Proposed Tiered Structure for DAA Payments

### Tier 1: Income-Based Progressive Rate

Replace the flat 2% with marginal brackets:

| Annual Income | Suggested Rate | Rationale |
|---------------|---------------|-----------|
| Under $30,000 | 0.5% | Poverty/near-poverty; symbolic participation |
| $30,001 - $75,000 | 1.0% | Median income range |
| $75,001 - $150,000 | 2.0% | Upper-middle income (current flat rate) |
| $150,001 - $300,000 | 3.0% | High income |
| $300,001 - $500,000 | 4.0% | Very high income |
| $500,001+ | 5.0% | Top earners |

These are MARGINAL rates (like tax brackets). Someone earning $200,000 pays:
- 0.5% on first $30K = $150
- 1.0% on next $45K = $450
- 2.0% on next $75K = $1,500
- 3.0% on next $50K = $1,500
- **Total: $3,600/year (effective rate: 1.8%)**

### Tier 2: Slaveholder Scale Multiplier

Based on the number of enslaved persons documented in the acknowledger's lineage:

| Enslaved Persons Documented | Multiplier | Rationale |
|-----------------------------|-----------|-----------|
| 1-5 | 1.0x | Small-scale slaveholding |
| 6-20 | 1.25x | Medium-scale |
| 21-100 | 1.5x | Plantation-scale |
| 101-500 | 2.0x | Major slaveholder |
| 500+ | 2.5x | Slaveholding dynasty (De Wolf, etc.) |

Applied to the income-based payment: $3,600 x 1.5 = $5,400/year for someone with 50 documented enslaved persons in their lineage.

### Tier 3: Corporate Connection Adjustment

If the acknowledger is a current employee, executive, or major shareholder of a Farmer-Paellmann defendant or other corporation with documented slavery ties:

| Connection Type | Additional Rate |
|----------------|----------------|
| Employee of identified corporation | +0.5% of income |
| Executive/officer of identified corporation | +2.0% of income |
| Major shareholder (>1% equity) | +1.0% of relevant holdings |

### Tier 4: Net Worth Consideration (Optional/Self-Reported)

For acknowledgers who voluntarily disclose net worth:

| Net Worth Range | Additional Rate on Net Worth |
|-----------------|------------------------------|
| Under $100,000 | 0% (income-only) |
| $100,001 - $500,000 | 0.1% annually |
| $500,001 - $2,000,000 | 0.25% annually |
| $2,000,001 - $10,000,000 | 0.5% annually |
| $10,000,001+ | 1.0% annually |

## The De Wolf Problem: Differential Inheritance

The user specifically flagged this: one sibling inherits the hedge fund, another gets nothing. Both are equally descended from slaveholders.

### The Problem
- Thomas Norman DeWolf wrote *Inheriting the Trade* about his family's reckoning
- The DeWolf family was the largest slave-trading dynasty in US history (12,000+ enslaved persons transported)
- James DeWolf was reportedly the 2nd richest person in the US at death (1837)
- Some modern DeWolf descendants are wealthy; others are not
- Both carry the same genealogical connection to slaveholding

### Design Principle: Ability to Pay, Not Inherited Guilt
- The DAA is a VOLUNTARY acknowledgment, not a legal judgment
- Payment should reflect ABILITY (current income/wealth), not INHERITANCE
- The genealogical connection determines the MORAL DEBT (documented in the DAA)
- The income/wealth tiers determine the PAYMENT AMOUNT
- Two siblings with the same ancestry but different incomes will have different payment amounts
- The DAA for both will document THE SAME historical debt -- the difference is in what they can contribute

### Implementation:
```javascript
// The debt is the same for both siblings
const historicalDebt = daaGenerator.calculateTotalDebt(slaveholders, enslavedPersons);
// = $X million (same for both)

// But the payment differs based on individual means
const siblingA_payment = tieredCalculator.calculateAnnualPayment({
    income: 500000,         // Hedge fund sibling
    netWorth: 10000000,     // Optional
    enslavedCount: 12000,   // De Wolf family
    corporateConnection: null
});
// = $25,000+ / year

const siblingB_payment = tieredCalculator.calculateAnnualPayment({
    income: 45000,          // Other sibling
    netWorth: null,         // Not disclosed
    enslavedCount: 12000,   // Same De Wolf family
    corporateConnection: null
});
// = $450 / year
```

Both DAAs document the same $X million historical debt. Both acknowledge the same ancestors. The payment schedule differs.

## What's Been Tried Before / What Worked/Failed

### Worked:
- **Tax brackets** as a progressive structure: universally understood, legally tested for centuries
- **Georgetown's flat fee ($27.20/semester):** Simple, achievable, symbolic. But NOT proportional to ability to pay.
- **ICHEIC's multiplier approach:** Effective for SCALING the debt calculation, less relevant for payment tiering

### Failed/Problematic:
- **Flat amounts** (Evanston $25K, Japanese American $20K): Don't account for severity or ability to pay
- **Percentage-of-income only:** Misses wealth (someone with $50K income but $5M in inherited property)
- **Self-reported data without verification:** Any system relying on voluntary income disclosure is gameable

### Unresolved:
- **How to handle acknowledgers with negative net worth:** Student debt, medical debt, etc. Should payment be zero? Or a nominal amount?
- **How to handle mixed ancestry:** If an acknowledger is BOTH descended from slaveholders AND from enslaved persons. This is common in the American South.
- **Payment duration:** Annual payments for how long? Lifetime? 30 years? Until the calculated debt is "paid off" (which at these rates would take centuries)?

## Concrete Next Steps

1. **Create `src/services/reparations/TieredPaymentCalculator.js`** implementing the bracket structure above. This replaces the flat `PAYMENT_PERCENTAGE = 0.02` constant.

2. **Add a `payment_tier_config` table** in the database storing the brackets so they can be adjusted without code changes. Include effective dates so historical DAAs preserve the rates that were in effect when generated.

3. **Update the DAA document** to show the full tier breakdown: "Your annual payment of $X is calculated as: [income bracket breakdown] x [slaveholder scale multiplier] + [corporate adjustment] + [net worth component]."

4. **Add income input to the kiosk flow** (kiosk.html / kiosk.js): Currently the kiosk collects name and FamilySearch ID. Add an income range selector (not exact amount -- use ranges like "$30-50K", "$50-75K" etc. for privacy).

5. **Design the mixed-ancestry case:** Create a clear policy for acknowledgers who are BOTH descended from slaveholders and enslaved persons. Suggestion: the DAA acknowledges both lineages, the debt calculation includes the slaveholder side, and the payment can be reduced or redirected to reflect the dual heritage.

6. **Set payment duration:** Recommend ANNUAL payments with NO fixed end date. The DAA specifies "until the total acknowledged debt of $X is satisfied or the acknowledger's circumstances change." This is consistent with the UK 1833 precedent (182-year repayment).

## Key Citations

- US Tax Code, IRC Section 1, Tax Rate Schedules (2025)
- International Criminal Court Trust Fund for Victims, Annual Reports
- Civil Liberties Act of 1988 (Pub.L. 100-383)
- Luxembourg Agreement (1952), Wiedergutmachung framework
- Roosevelt Institute (2024). "Financing Reparative Policies."
- DeWolf, T.N. (2008). *Inheriting the Trade.* Beacon Press.
- Darity & Mullen (2022). *From Here to Equality*, 2nd ed.
