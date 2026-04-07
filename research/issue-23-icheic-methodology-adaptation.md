# Issue #23: Adapt ICHEIC Methodology for Trans-Atlantic Slavery

## Current Academic State of the Art

### What ICHEIC Actually Did

The International Commission on Holocaust Era Insurance Claims (ICHEIC, 1998-2007) was chaired by former Secretary of State Lawrence Eagleburger. It processed ~90,000 claims and paid ~$306 million.

**The ICHEIC Valuation Methodology:**
1. **Identify the historical asset:** Insurance policy with face value in local currency (Reichsmarks, French francs, guilders, etc.)
2. **Convert to historical USD:** Use end-of-year exchange rates for the policy year (typically 1936-1938)
3. **Apply country-specific multiplier:** Each country had a unique multiplier to bring historical values to present-day (approximately December 2006) values
4. **The multiplier accounted for:**
   - Post-1945 currency deflation (especially severe for German Reichsmark)
   - Government bond returns in the relevant country over the period
   - CPI changes
5. **The Pomeroy-Ferras Report** (commissioned by ICHEIC) provided the actuarial basis: Glenn Pomeroy (NAIC president) and Philippe Ferras (AXA EVP) researched historical policy values

**Critical detail:** The ICHEIC multipliers were "apparently arrived at through negotiation between the parties involved" -- they were not purely mathematical. They represented a COMPROMISE between insurers and claimants.

### The British Abolition Compensation (Closest Precedent)

The 1833 Slavery Abolition Act compensation is the single most relevant precedent for your project:

**The facts:**
- Parliament authorized ~$20 million (40% of Treasury's annual income, ~5% of British GDP)
- Paid TO SLAVE OWNERS as compensation for loss of "property"
- Financed by government loan
- Some payments converted into 3.5% government annuities
- **The loan was not fully paid off until 2015** -- 182 years of taxpayer payments
- British taxpayers (INCLUDING descendants of enslaved persons in the UK) were paying slaveholder compensation until 6 years before the March 2026 UN resolution

**Present value:**
- CPI method: ~$17 billion (~$20B USD)
- Relative income method: ~$100 billion+
- Economy-share method: even higher
- Your `CompensationTracker.js` already has this data (line 64-71): `modernValue: 17000000000`

**Why this is the cornerstone argument:** If the UK could enforce a 182-year intergenerational debt transfer TO slaveholders, the same mechanism can be applied TO descendants of enslaved persons. Your `LegalPrecedentService.js` already frames this correctly.

### The Brattle Group Methodology (2023)

The Brattle Group's report for ASIL/UWI is the most comprehensive modern attempt to quantify transatlantic slavery reparations using ICHEIC-adjacent methodology:

**Per-category damages (2020 US$, 2.5% interest rate):**
| Category | Amount |
|----------|--------|
| Forgone Earnings | $54,930B |
| Loss of Liberty | $10,986B |
| Personal Injury | $6,042B |
| Gender-Based Violence | $11,793B |
| Mental Pain and Anguish | $24,047B |
| **TOTAL** | **$107,799B** |

**Methodology:**
- Population: 19,902,008 enslaved persons total
- Person-years: 801,580,220
- Used 2.5% interest rate (MORE conservative than Craemer's 3%)
- US-specific total: $30,134B (Table 16)
- Separated harms during slavery ($77-108T) from continuing post-slavery harm ($23T)

**How they adapted ICHEIC principles:**
1. Identified the "asset" (stolen labor, stolen liberty, physical/sexual harm)
2. Valued at historical rates (period wages, comparative freedom valuations)
3. Compounded to present value using government bond returns
4. Applied per-country multipliers for different colonial powers

## The Adaptation Challenge: Slavery vs. Insurance Claims

| Dimension | ICHEIC (Insurance) | Slavery Adaptation |
|-----------|-------------------|-------------------|
| **Asset type** | Insurance policy with known face value | Stolen labor, stolen liberty, stolen life |
| **Documentation** | Policy records in insurer archives | Slave schedules, probate records, ship manifests |
| **Valuation basis** | Face value in local currency | Hourly wage equivalent (Craemer) or market value of enslaved person |
| **Time horizon** | ~70 years (1930s to 2000s) | ~160-400 years (1619 to present) |
| **Currency** | European currencies with known exchange rates | Mixed currencies (USD, GBP, Spanish dollars, etc.) |
| **Interest rate** | Country-specific govt bond returns | Contested (Craemer: 3%, Brattle: 2.5%, historical returns: 4-7%) |
| **Claimant identification** | Specific policy holders/heirs | Descendants of enslaved persons (broader class) |
| **Perpetrator identification** | Specific insurance companies | Individual slaveholders, corporations, governments |
| **Geographic scope** | Europe (primarily Germany, Austria, Eastern Europe) | Americas, Caribbean, Europe, Africa |

## Proposed Methodology: ICHEIC-Adapted for Slavery

### Step 1: Identify the Historical "Policy" (the enslaved person-year)

The analog to an insurance policy is a **person-year of enslavement**. Each year an individual was enslaved represents a stolen "asset" with quantifiable value.

From your existing data:
- `unconfirmed_persons` table: ~1.68M records from slave schedules
- Each record includes: approximate age, location, slaveholder
- Duration calculation: (emancipation_year OR death_year) - birth_year - (years before enslavement began, typically age 5)

### Step 2: Value at Historical Rates

**Option A: Wage-theft basis (Craemer method -- your current approach)**
- Historical free-labor hourly wage x 12 hours/day x 300 working days
- Your `DAAGenerator.js` uses $0.80/day as the midpoint of 1840-1860 range
- Produces: ~$240/year per enslaved person (in period dollars)

**Option B: Market-value basis (closest to ICHEIC "face value")**
- Average sale price of enslaved person by year and state
- Data available from: SlaveVoyages.org, Fogel & Engerman (1974), Baptist (2014)
- Approximate values: $300-500 (1800), $800-1,200 (1840), $1,000-1,800 (1860)
- This represents the slaveholder's RECOGNIZED value of the person, analogous to policy face value

**Option C: Brattle multi-category approach**
- Forgone earnings + loss of liberty + personal injury + gender-based violence + mental anguish
- Most comprehensive but requires assumptions about prevalence of each harm type

### Step 3: Convert to Common Currency (Historical USD)

For US slavery, most values are already in USD. For international adaptation:

| Colonial Power | Historical Currency | Conversion Method |
|---------------|-------------------|-------------------|
| United States | USD | Direct (no conversion needed) |
| United Kingdom | GBP | Bank of England historical exchange rates |
| France | Livres tournois / Francs | Historical exchange rate series (Allen & Unger) |
| Netherlands | Guilders | De Nederlandsche Bank historical data |
| Portugal | Reis / Milreis | Historical records (more sparse) |
| Spain | Pesos/Reales | Archivo General de Indias records |
| Brazil | Reis (Portuguese) | Frank Tannenbaum / Stuart Schwartz data |

### Step 4: Apply Interest/Compounding (Country-Specific)

**The ICHEIC approach:** Use government bond returns for each country over the relevant period.

**Proposed country-specific rates:**

| Country | Period | Proposed Rate | Basis |
|---------|--------|--------------|-------|
| United States | 1619-2026 | 3.0% | Craemer (2015), conservative floor below historical Treasury returns |
| United Kingdom | 1660-2026 | 3.5% | The ACTUAL rate on the 1833 abolition loan (consols) |
| France | 1685-2026 | 2.5% | French rentes (government bonds) historical average |
| Netherlands | 1596-2026 | 3.0% | Dutch government bond historical average |
| Portugal | 1500-2026 | 2.0% | Lower due to more volatile sovereign debt history |
| Spain | 1500-2026 | 2.0% | Similar to Portugal |
| Brazil | 1532-2026 | 4.0% | Higher due to more volatile currency/inflation history |

**The compounding problem:** Over 400 years at even 2.5%, numbers become astronomical. This is mathematically correct but politically unworkable.
- $1 at 3% for 400 years = $130,161
- $1 at 3% for 200 years = $369
- This is why the Brattle Group arrives at $107 trillion

### Step 5: Apply Country-Specific Multipliers (New)

ICHEIC used negotiated multipliers. For slavery, propose CALCULATED multipliers:

```
Multiplier = (1 + country_interest_rate) ^ years_since_midpoint_of_slavery_period

US:  (1.03)^176 = ~182x   (midpoint: 1850)
UK:  (1.035)^183 = ~534x  (midpoint: 1743, ending at abolition 1833, then compounding to present)
FR:  (1.025)^196 = ~117x  (midpoint: 1730, Code Noir 1685, abolition 1848)
NL:  (1.03)^226 = ~782x   (midpoint: 1700, WIC charter 1621, abolition 1863)
PT:  (1.02)^276 = ~234x   (midpoint: 1650, earliest colonial slavery ~1500, abolition 1888 in Brazil)
```

## What's Been Tried Before

### Worked:
- **ICHEIC process itself:** Despite compromises, it processed 90,000 claims and paid $306M. The methodology was accepted by all parties (insurers, claimants, governments).
- **Brattle Group report (2023):** First rigorous application of ICHEIC-style methodology to slavery. Accepted as authoritative by ASIL and UWI.
- **UK abolition loan:** PROVES that intergenerational compounding debt for slavery is not hypothetical -- it was IMPLEMENTED (just in the wrong direction).

### Failed/Problematic:
- **ICHEIC negotiated multipliers:** Were compromises, not purely actuarial. Some claimants received far less than actuarially justified values.
- **Single interest rate for all countries:** Brattle used 2.5% uniformly, which over/undercounts for different national contexts.
- **No one has implemented per-country multipliers in code** for a slavery reparations calculator.

## Concrete Next Steps

1. **Extend `DAAGenerator.js` with a `JurisdictionMultiplier` class** that stores per-country interest rates and compounding periods. This allows your platform to generate DAAs for non-US slavery (Caribbean, Brazil, etc.) in the future.

2. **Add the Brattle Group damage categories** to the debt calculation as optional "enhanced" figures alongside the Craemer floor. Currently your DAA only computes wage theft. Adding loss-of-liberty and personal injury components would move toward the Brattle methodology.

3. **Store the UK 1833 abolition loan data** (already in `LegalPrecedentService.js`) as a COMPUTATIONAL precedent, not just a legal one. The 3.5% consol rate IS a government-sanctioned interest rate for slavery debt compounding.

4. **Build a "ICHEIC Comparison" section** in the DAA document showing: "If this debt were valued using the same methodology that compensated Holocaust insurance claimants, the present value would be $X."

5. **For Caribbean/international expansion:** Partner with CARICOM Reparations Commission for country-specific data. Their Ten-Point Plan provides the political framework; your platform could provide the computational infrastructure.

6. **Create a multiplier comparison table** in the DAA showing how the debt changes under different interest rate assumptions (2.5%, 3%, 3.5%, 5%). Transparency about methodology builds credibility.

## Key Citations

- ICHEIC. Valuation Guidelines (2003). Available at: https://icheic.ushmm.org/
- Pomeroy, G. & Ferras, P. Report on the Value of Insurance Policies Purchased by Holocaust Victims. ICHEIC.
- Bazelon et al. (2023). "Quantification of Reparations for Transatlantic Chattel Slavery." Brattle Group.
- Bazelon et al. (2023). "Report on Reparations for Transatlantic Chattel Slavery in the Americas and the Caribbean." Brattle Group.
- Craemer, T. (2015). "Estimating Slavery Reparations." *Social Science Quarterly* 96(2): 639-655.
- Craemer, T. (2018). "International Reparations for Slavery and the Slave Trade." *Journal of Black Studies* 49(7): 694-713.
- Slave Compensation Act 1837 (UK). National Archives records.
- Tax Justice Network (2020). "Britain's Slave Owner Compensation Loan, reparations and tax havenry."
- Full Fact (2018). "This is what we know about the government loan to pay slave owners compensation."
