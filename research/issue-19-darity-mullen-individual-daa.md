# Issue #19: Operationalize Darity & Mullen's Wealth-Gap Model for Individual DAAs

## Current Academic State of the Art

### The Darity-Mullen Model
William A. Darity Jr. and A. Kirsten Mullen's *From Here to Equality* (2nd ed., 2022) anchors the wealth-gap approach:

- **Core metric:** Mean Black-white household wealth gap from the Federal Reserve's Survey of Consumer Finances (SCF). The 2016 SCF showed a gap of ~$795,000 per household.
- **Population basis:** ~10 million Black households in the US.
- **Total bill:** $795K x 10M = $7.95 trillion. The second edition revised this upward to $10-14 trillion using updated SCF data and accounting for additional harms beyond the wealth gap alone.
- **Per-person figure:** With an average Black household size of 3.31 persons, the per-capita shortfall is ~$240,000 per individual (Darity's own calculation).
- **Eligibility criteria:** (1) At least one ancestor enslaved in the US, AND (2) self-identified as Black on a legal document within the past 10 years.

### The Craemer Alternative
Thomas Craemer's wage-theft approach (Social Science Quarterly, 2015) produces:
- $18.6 trillion at 3% compound interest on unpaid wages
- ~$454,000 per descendant
- This is already implemented in your `DAAGenerator.js`

### The Roosevelt Institute Financing Mechanism (December 2024)
Darity and collaborators at Roosevelt Institute proposed a "Reparations Tax paid in stock" that could raise $1 trillion+ within a year by requiring corporations to remit shares proportional to outstanding stock classes. This has a progressive incidence since the top 20% of wealthiest households own 87% of corporate equities.

### 2022 SCF Updated Numbers
The most recent SCF (2022) shows:
- Median Black household wealth: $44,890
- Median white household wealth: $285,000
- **Median gap: ~$240,000 per household**
- **Mean gap: significantly higher** (means are more sensitive to extreme values at the top)
- The gap WIDENED by ~$50,000 between 2019-2022 despite Black wealth growing 61% in percentage terms

### The Brattle Group (2023)
The Brattle Group quantified total transatlantic slavery reparations at $100-131 trillion across 19.9 million enslaved persons over 4 centuries (801.6 million person-years). This is the MACRO CEILING for your platform.

## The Core Question: Acknowledger's Share vs. Individual Wealth Advantage

There are two fundamentally different approaches to computing what one acknowledger "owes":

### Approach A: Share of the Total Gap (Population-Level Allocation)
- Total gap: ~$7.95-14T
- Divide by the acknowledger pool (e.g., number of white American households, ~83M)
- Each household's "share": ~$96K-$169K
- **Problem:** This treats all white households as equally responsible regardless of slaveholding ancestry
- **Problem:** This is conceptually identical to a federal tax -- Darity himself argues this is the ONLY ethical mechanism (government taxation, not individual payments)

### Approach B: Individual Wealth Advantage (Genealogy-Based Calculation)
- Use the Ager/Boustan/Eriksson finding that slaveholder descendants recovered fully within 2 generations via social capital
- Calculate the acknowledger's SPECIFIC inherited advantage based on:
  - Number of enslaved persons held by ancestors (from your `ancestor_climb_matches`)
  - Duration of enslavement
  - Scale of slaveholding operation
  - Proportion of the acknowledger's lineage connected to slaveholding
- **Problem:** The Ager paper proves wealth transmitted through social capital (marriage networks, education access), NOT direct financial inheritance. You can't trace a dollar amount forward.
- **This is what your platform is actually positioned to do** given the ancestor climber.

### Approach C: Hybrid (Recommended for Your Platform)
1. Calculate the Craemer floor (wage-theft compound interest) for each documented enslaved person connected to the acknowledger's ancestors -- **you already do this in DAAGenerator.js**
2. Present the Darity-Mullen wealth gap as the MACRO CONTEXT: "The total debt is $X trillion. Your family's documented share, based on N enslaved persons across G generations, is $Y."
3. The voluntary payment percentage (currently 2%) is applied to the acknowledger's income, NOT to the total debt figure. The debt figure is the MORAL ACCOUNTING; the payment is what the acknowledger can actually contribute.

## What Specific Data/Methodology Would Be Needed

### To implement Approach C in code:

1. **SCF Integration:** Pull the latest SCF summary statistics from the Federal Reserve (published every 3 years; 2025 SCF will be collected this year, published ~2027). Store these as configuration constants, not hardcoded.

2. **Family-Specific Debt Calculation (already partially built):**
   - `ancestor_climb_matches` gives you: slaveholder ancestors, generation distance, enslaved person counts
   - `DAAGenerator.js` already computes Craemer-based debt per enslaved person
   - MISSING: aggregation across ALL matched slaveholders in a lineage to produce a family-level total

3. **Acknowledger Wealth Context (NEW):**
   - Self-reported income (for payment calculation)
   - Optionally: self-reported net worth (to contextualize against the wealth gap)
   - Ratio: acknowledger_net_worth / mean_white_household_wealth = their "position" in the gap

4. **Proportionality Factor (NEW):**
   - What fraction of the acknowledger's ancestry is connected to slaveholding?
   - If 1 of 8 great-grandparents was a slaveholder, the "proportion" is 1/8
   - This maps to `generation_distance` in your climb data
   - Formula: `proportion = 1 / (2 ^ generation_distance)` for each slaveholding ancestor, summed

### Code Sketch:
```javascript
// In DAAGenerator.js or a new WealthGapCalculator.js
class WealthGapCalculator {
    constructor() {
        // SCF 2022 data (update when 2025 SCF publishes)
        this.SCF_YEAR = 2022;
        this.MEAN_WHITE_HOUSEHOLD_WEALTH = 1_120_700; // 2022 SCF mean
        this.MEAN_BLACK_HOUSEHOLD_WEALTH = 340_160;   // 2022 SCF mean
        this.MEAN_WEALTH_GAP = this.MEAN_WHITE_HOUSEHOLD_WEALTH - this.MEAN_BLACK_HOUSEHOLD_WEALTH;
        this.MEDIAN_WHITE_HOUSEHOLD_WEALTH = 285_000;
        this.MEDIAN_BLACK_HOUSEHOLD_WEALTH = 44_890;
        this.MEDIAN_WEALTH_GAP = this.MEDIAN_WHITE_HOUSEHOLD_WEALTH - this.MEDIAN_BLACK_HOUSEHOLD_WEALTH;
        this.BLACK_HOUSEHOLDS = 10_000_000; // Census estimate
        this.TOTAL_GAP_MEAN = this.MEAN_WEALTH_GAP * this.BLACK_HOUSEHOLDS;
    }

    /**
     * Calculate the acknowledger's proportional connection to slaveholding
     * @param {Array} matches - ancestor_climb_matches rows
     * @returns {number} Sum of ancestral proportions (0.0 to 1.0+)
     */
    calculateAncestralProportion(matches) {
        let totalProportion = 0;
        for (const match of matches) {
            // Each ancestor at generation G contributes 1/2^G of your genome
            totalProportion += 1 / Math.pow(2, match.generation_distance);
        }
        return Math.min(totalProportion, 1.0); // Cap at 100%
    }

    /**
     * Calculate the family-specific share of the total gap
     * @param {Array} matches - ancestor_climb_matches rows
     * @param {number} totalEnslavedByFamily - total enslaved persons across all matched ancestors
     * @returns {Object} Wealth gap context
     */
    calculateFamilyShare(matches, totalEnslavedByFamily) {
        const proportion = this.calculateAncestralProportion(matches);
        return {
            scfYear: this.SCF_YEAR,
            meanWealthGap: this.MEAN_WEALTH_GAP,
            medianWealthGap: this.MEDIAN_WEALTH_GAP,
            totalNationalGap: this.TOTAL_GAP_MEAN,
            ancestralProportion: proportion,
            // This is NOT the debt -- it's the CONTEXT
            proportionalGapShare: Math.round(this.MEAN_WEALTH_GAP * proportion),
            enslavedPersonsDocumented: totalEnslavedByFamily,
            methodology: 'Darity-Mullen wealth gap (SCF ' + this.SCF_YEAR + ') weighted by ancestral proportion',
            citation: 'Darity & Mullen, From Here to Equality (2nd ed., 2022); Federal Reserve SCF ' + this.SCF_YEAR
        };
    }
}
```

## What's Been Tried Before / What Worked/Failed

### Worked:
- **Darity-Mullen's macro framing** is now the consensus academic benchmark. Cited by California Task Force, Evanston IL program, and the Brattle Group.
- **Craemer's micro approach** (wage-theft) is mathematically cleaner for individual calculations and is what your DAAGenerator already implements.
- **Georgetown GU272:** A concrete case of institutional debt acknowledgment. Students voted for a $27.20/semester fee. The institution and Jesuits committed $27M toward a $100M+ fund for descendants.

### Failed/Problematic:
- **Evanston IL program:** $25,000 housing grants per eligible resident. Criticized as too small, too narrow (housing only), and not based on any wealth-gap methodology.
- **California Task Force (2023):** Recommended $1.2M per eligible person but provided no funding mechanism. Legislature has not acted.
- **No one has successfully operationalized the wealth-gap model at the INDIVIDUAL acknowledger level.** This is genuinely novel territory for your project.

## Concrete Next Steps for This Project

1. **Create `src/services/reparations/WealthGapCalculator.js`** implementing the code sketch above. Wire it into `DAAOrchestrator.js` so every DAA includes both the Craemer debt figure AND the Darity-Mullen wealth-gap context.

2. **Update the DAA document** (DAADocumentGenerator.js) to include a "National Context" section showing: "The total Black-white wealth gap is $X trillion. Your family's documented connection accounts for Y% of your ancestry, spanning N enslaved persons."

3. **Store SCF data as a versioned configuration** (not hardcoded) so it can be updated when the 2025 SCF publishes (~2027).

4. **DO NOT attempt to compute a single "you owe $X" number from the wealth gap model.** Instead, present it as context alongside the Craemer wage-theft calculation. The payment percentage (currently 2% of income) is the actionable number.

5. **Research the Roosevelt Institute stock-tax proposal** for potential integration as a "what if corporations did this?" visualization.

## Key Citations

- Darity, W.A. Jr. & Mullen, A.K. (2022). *From Here to Equality, Second Edition*. UNC Press.
- Craemer, T. (2015). "Estimating Slavery Reparations." *Social Science Quarterly* 96(2): 639-655.
- Federal Reserve Board. (2023). "Greater Wealth, Greater Uncertainty: Changes in Racial Inequality in the Survey of Consumer Finances." FEDS Notes.
- Bazelon et al. (2023). "Quantification of Reparations for Transatlantic Chattel Slavery." Brattle Group.
- Roosevelt Institute. (2024). "Financing Reparative Policies: How a Tax Paid in Stock Could Raise a Trillion Dollars Within a Year."
- Ager, P., Boustan, L.P. & Eriksson, K. (2021). "The Intergenerational Effects of a Large Wealth Shock." *AER* 111(11): 3767-3794.
