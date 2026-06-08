// scripts/seed-reparations-framework.mjs

import pg from 'pg';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
});

async function seedData() {
    console.log('Starting seed for reparations framework...');
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // HARM CATEGORIES
        console.log('Seeding HARM CATEGORIES...');
        await client.query(`
            INSERT INTO reparations_harm_categories (category_key, display_name, era, period_start, period_end, description, primary_citation, calculation_method_key)
            VALUES
            ('wage_theft', 'Enslaved Labor — Wage Theft', 'antebellum', 1619, 1865, NULL, 'Neal 1983; Darity, Mullen & Slaughter 2022 (JEP 36:2 pp.99–122)', 'wage_theft_craemer_2015'),
            ('slave_collateral_banking', 'Enslaved People as Loan Collateral (Northern Banks)', 'antebellum', 1820, 1865, NULL, 'Murphy 2023 (Banking on Slavery); JPMorgan Chase 2005 public disclosure', 'collateral_transaction_value'),
            ('slave_insurance', 'Slave Life Insurance Policies', 'antebellum', 1820, 1865, NULL, 'CA DOI Slavery Era Insurance Registry; Southern Mutual Insurance UGA records', 'policy_face_value_compound'),
            ('domestic_slave_trade', 'Domestic Slave Trade Finance and Profit', 'antebellum', 1790, 1865, NULL, 'Montero 2024 (The Stolen Wealth of Slavery); ACWM historians', 'trade_volume_compound'),
            ('middle_passage_extraction', 'Middle Passage — Transatlantic Kidnapping and Transport', 'antebellum', 1619, 1808, 'Connects individual platform records to the international law framework. Each documented enslaved person is one count in the 802M person-years Brattle quantification underlying the $100–131T global reparations figure.', 'Brattle Group 2023 (ASIL/UWI); Trans-Atlantic Slave Trade Database (Eltis & Richardson)', 'brattle_802m_person_years'),
            ('land_promise_betrayal', 'Betrayal of 40-Acres Land Redistribution', 'reconstruction', 1865, 1865, NULL, 'Special Field Orders No. 15 (Jan. 16, 1865); Darity & Mullen 2020', 'forty_acres_present_value'),
            ('freedmans_bank_collapse', 'Freedman''s Savings Bank Collapse — Depositor Loss', 'reconstruction', 1865, 1874, 'Platform holds 416,000+ depositor records which are Tier 1 evidence for this harm category. Every record is a documented claim.', 'Hill Edwards 2024 (Savings and Trust); Britannica; National Archives Prologue 1997; Chicago Booth (Hornbeck & Keniston)', 'freedmans_bank_direct_loss'),
            ('reconstruction_massacre', 'Reconstruction-Era Massacres and Political Terror', 'reconstruction', 1865, 1877, NULL, 'Darity, Mullen & Slaughter 2022; EJI; Zinn Education Project', 'massacre_property_loss_compound'),
            ('convict_leasing', 'Convict Leasing — State-Sanctioned Labor Extraction', 'jim_crow', 1865, 1941, NULL, 'Blackmon 2008 (Slavery by Another Name); EJI; PBS', 'convict_wage_theft_compound'),
            ('sharecropping_debt_peonage', 'Sharecropping and Agricultural Debt Peonage', 'jim_crow', 1865, 1960, NULL, 'Darity & Mullen 2020; Rutgers Economics of Reconstruction; Britannica', 'sharecropping_extraction_estimate'),
            ('black_land_dispossession', 'Black Land Dispossession (~12–14M acres)', 'jim_crow', 1910, 2002, NULL, 'Douglas 2017 (The Nation); USDA 2002 rural land report; Pigford v. Glickman 1999', 'land_acreage_current_value'),
            ('red_summer_massacre', '1919 Red Summer and Later Massacres (Tulsa 1921, Rosewood 1923)', 'jim_crow', 1919, 1923, NULL, 'Brookings 2021; NBER WP28985; Harvard Gazette 2020; Cook 2014', 'massacre_property_loss_compound'),
            ('fha_redlining', 'FHA/HOLC Redlining — Exclusion from Federal Homeownership', 'jim_crow', 1934, 1968, NULL, 'Rothstein 2017 (The Color of Law); Massachusetts Budget 2021; Darity et al. 2022; Shelterforce 2019', 'fha_counterfactual_homeownership'),
            ('gi_bill_exclusion', 'GI Bill — Discriminatory Exclusion of Black Veterans', 'jim_crow', 1944, 1956, NULL, 'Darity, Mullen & Slaughter 2022 (JEP 36:2 p.113); Levinson 2020', 'gi_bill_counterfactual'),
            ('employment_discrimination', 'Employment Discrimination and New Deal Exclusions', 'jim_crow', 1865, 1964, NULL, 'Darity et al. 2022; EconFIP racial inequality brief', 'income_penalty_compound'),
            ('urban_renewal_displacement', 'Urban Renewal / "Negro Removal" Displacement', 'jim_crow', 1949, 1973, NULL, 'Baldwin; HUD federal records; D&M', 'displacement_property_loss'),
            ('mass_incarceration_labor', 'Mass Incarceration as Neo–Convict Leasing', 'modern', 1970, NULL, NULL, 'EPI 2021 (Rooted in Racism); 13th Amendment text; prison wage data', 'prison_wage_theft_ongoing'),
            ('predatory_lending', 'Predatory Lending / Contract Selling', 'modern', 1950, NULL, NULL, 'Satter (Chicago contract selling); Federal Reserve subprime studies', 'predatory_extraction_estimate'),
            ('usda_discrimination', 'USDA Systematic Discrimination Against Black Farmers', 'modern', 1981, 1997, NULL, 'Pigford v. Glickman 1999; $1.25B Pigford II settlement 2010 (partial)', 'documented_denial_losses')
            ON CONFLICT (category_key) DO NOTHING;
        `);

        // PERPETRATOR ENTITIES
        console.log('Seeding PERPETRATOR ENTITIES...');
        await client.query(`
            INSERT INTO harm_perpetrator_entities (entity_key, display_name, entity_type, state_code, successor_of, documented_involvement, primary_citation, corporate_entity_id)
            VALUES
            ('us_federal_government', 'United States Federal Government', 'federal_government', NULL, NULL, 'Land redistribution betrayal (1865); Freedman''s Bank charter and regulatory failure (1865–1874); FHA/HOLC redlining policy (1934–1968); GI Bill discriminatory administration (1944–1956); New Deal exclusions; USDA systematic discrimination; urban renewal displacement; Black Codes enforcement complicity', NULL, NULL),
            ('jpmorgan_chase', 'JPMorgan Chase & Co. (incl. predecessor banks)', 'corporation', NULL, NULL, '~13,000 enslaved accepted as loan collateral; ~1,250 owned outright after borrower defaults', 'JPMorgan Chase 2005 public disclosure', (SELECT entity_id FROM corporate_entities WHERE modern_name = 'JPMorgan Chase & Co.')),
            ('brown_brothers_harriman', 'Brown Brothers Harriman & Co.', 'corporation', NULL, NULL, 'Credit lines to Southern planters secured by enslaved people; direct ownership of 4,614-acre Louisiana plantation with 346 enslaved after Panic of 1837 defaults', 'Montero 2024 (The Stolen Wealth of Slavery)', (SELECT entity_id FROM corporate_entities WHERE modern_name = 'Brown Brothers Harriman & Company')),
            ('cvs_aetna_predecessor', 'Aetna Life Insurance (slavery-era predecessor)', 'corporation', NULL, NULL, 'Wrote slave life insurance policies on enslaved people as property', 'CA DOI Slavery Era Insurance Registry', (SELECT entity_id FROM corporate_entities WHERE modern_name = 'CVS Health (Aetna successor)')),
            ('new_york_life', 'New York Life Insurance', 'corporation', NULL, NULL, 'Insured enslaved people as property', NULL, (SELECT entity_id FROM corporate_entities WHERE modern_name = 'New York Life Insurance Company')),
            ('csx_corporation', 'CSX Corporation (incl. 12 predecessor railroad lines)', 'corporation', NULL, NULL, 'Enslaved labor in railroad construction across predecessor lines', NULL, (SELECT entity_id FROM corporate_entities WHERE modern_name = 'CSX Corporation')),
            ('usda_agency', 'United States Department of Agriculture', 'federal_government', NULL, NULL, 'Systematic denial of farm loans and programs to Black farmers 1981–1997; documented in Pigford v. Glickman litigation', NULL, NULL)
            ON CONFLICT (entity_key) DO NOTHING;
        `);

        const states = ['AL', 'AR', 'FL', 'GA', 'KY', 'LA', 'MD', 'MS', 'NC', 'SC', 'TN', 'TX', 'VA'];
        for (const stateCode of states) {
            const entityKey = `state_government_${stateCode.toLowerCase()}`;
            const displayName = `${stateCode} State Government`;
            const involvement = 'Convict leasing system operation; Black Codes enactment; sharecropping system enforcement; massacre complicity; Black land dispossession facilitation';
            await client.query(`
                INSERT INTO harm_perpetrator_entities (entity_key, display_name, entity_type, state_code, documented_involvement)
                VALUES ($1, $2, 'state_government', $3, $4)
                ON CONFLICT (entity_key) DO NOTHING;
            `, [entityKey, displayName, stateCode, involvement]);
        }

        // GLOBAL INDICATOR TARGETS
        console.log('Seeding GLOBAL INDICATOR TARGETS...');
        await client.query(`
            INSERT INTO global_indicator_targets (source_author, source_year, source_title, scope, methodology, total_usd_low, total_usd_high, per_capita_usd, reference_year, interest_rate, notes, primary_citation)
            VALUES
            ('Darity, Mullen & Slaughter', 2022, 'The Cumulative Costs of Racism and the Bill for Black Reparations', 'us_ados', 'racial_wealth_gap', 14000000000000, 14000000000000, 350000, 2020, NULL, 'Amount required to close the current U.S. racial wealth gap entirely. Addressed to U.S. federal government. Captures post-1865 harms through the wealth gap measure rather than as separate line items.', 'Darity W, Mullen AK, Slaughter M. JEP 36(2):99–122. 2022.'),
            ('Darity, Mullen & Slaughter', 2022, NULL, 'us_ados', 'itemization', 5700000000000, 11400000000000, NULL, 2019, 0.05, 'Neal 1983 wage-theft base compounded at 4–6% interest through 2019. See Table 1 in D&M 2022 JEP. Does not include post-1865 atrocity line items — those are itemized separately in the same paper.', NULL),
            ('Craemer, Thomas', 2015, 'Estimating Slavery Reparations: Present Value Comparisons of Historical Multigenerational Reparations Policies', 'us_ados', 'cost_to_enslaved', 14500000000000, 20000000000000, NULL, 2021, NULL, 'Calculates cost to the enslaved (all 24 hours of each day lost to bondage, not merely the 10–12 labor hours gained by owners). Does not include colonial slavery or post-1865 discriminatory harms. The compound interest formula currently in DAAOrchestrator.js derives from this paper.', 'Craemer T. Social Science Quarterly 96(2):639–655. 2015.'),
            ('Brattle Group (commissioned by ASIL)', 2023, 'Quantification of Reparations for Transatlantic Chattel Slavery', 'us_as_perpetrator', 'international_law_violations', 36000000000000, 36000000000000, 450000, 2023, NULL, 'U.S. obligation within global $107.8T aggregate. U.S. slavery period (1776–1865): ~$26T. U.S. post-enslavement wealth disparity: ~$10.2T. Legal basis: violations of international law. Scope includes Caribbean and Latin American diaspora — NOT limited to U.S. ADOS. DISTINCT from D&M domestic framework. Five heads of damages: loss of life and uncompensated labour; loss of liberty; personal injury; mental pain and anguish; gender-based violence. Health/housing/education harms explicitly unquantified — figure is a conservative floor not a ceiling. Presented by ICJ Judge Patrick Robinson at UWI June 8, 2023.', 'Brattle Group. ASIL / University of the West Indies. June 8, 2023.'),
            ('Brattle Group (commissioned by ASIL)', 2023, NULL, 'global_all_nations', 'international_law_violations', 100000000000000, 131000000000000, NULL, 2023, NULL, 'Full transatlantic obligation across 10 enslaving nations toward 27 countries in Americas and Caribbean. 19 million people, 802 million person-years. Slavery period: $77–108T. Post-enslavement: $23T. The U.S. share is Row 4 above.', NULL)
            ON CONFLICT (source_author, source_year, scope, methodology) DO NOTHING;
        `);

        // LEGAL THEORY REGISTRY
        console.log('Seeding LEGAL THEORY REGISTRY...');
        await client.query(`
            INSERT INTO legal_theory_registry (theory_key, display_name, jurisdiction, legal_basis, key_instrument)
            VALUES
            ('domestic_wage_theft', 'Domestic Tort: Wage Theft and Unjust Enrichment', 'domestic_us', 'Unjust enrichment; unpaid labour; constructive trust', 'Darity, Mullen & Slaughter 2022 (JEP); Craemer 2015'),
            ('domestic_breach_government_duty', 'Government Breach of Duty / Equal Protection', 'domestic_us', 'Equal protection (14th Amendment); fiduciary duty; government negligence; promissory estoppel', 'Rothstein 2017 (The Color of Law); Pigford v. Glickman'),
            ('domestic_successor_liability', 'Corporate Successor Liability', 'domestic_us', 'Successor liability; badges and incidents of slavery; constructive trust', 'Farmer-Paellmann; JPMorgan 2005 disclosure'),
            ('international_jus_cogens', 'International Law: Jus Cogens / Customary Prohibition', 'international', 'Customary international law prohibition of transatlantic chattel slavery; jus cogens / erga omnes obligations; 1815 Congress of Vienna Declaration; 1890 Brussels Conference Act. ICJ Judge Patrick Robinson (ASIL 2021): substance of prohibition predates the jus cogens doctrinal label.', 'Brattle Group 2023 (ASIL); ASIL Reparations Under International Law Proceedings 2021 and 2023'),
            ('international_crime_against_humanity', 'International Law: Crime Against Humanity', 'international', 'Rome Statute Art. 7; Nuremberg Principles; UDHR Art. 4; UNGA Resolution A/80/L.48 (March 25, 2026); ILC Articles on State Responsibility Arts. 35–37 (restitution, compensation, satisfaction)', 'UN General Assembly Resolution A/80/L.48 (2026); ICC Rome Statute (pending amendment to enumerate slave trade as war crime and crime against humanity)')
            ON CONFLICT (theory_key) DO NOTHING;
        `);

        // INTERNATIONAL LEGAL INSTRUMENTS
        console.log('Seeding INTERNATIONAL LEGAL INSTRUMENTS...');
        await client.query(`
            INSERT INTO international_legal_instruments (instrument_key, display_name, instrument_type, adopting_body, adoption_date, us_position, significance, url, vote_for, vote_against, vote_abstain)
            VALUES
            ('un_durban_2001', 'Durban Declaration and Programme of Action', 'un_resolution', 'UN World Conference Against Racism', '2001-09-08', 'voted_against', 'First multilateral acknowledgment that slave trade "should always have been" a crime against humanity (subjunctive mood). Baseline for all subsequent international reparations discourse.', NULL, NULL, NULL, NULL),
            ('asil_symposium_2021', 'ASIL First Symposium: Reparations Under International Law', 'symposium_proceedings', 'American Society of International Law / University of the West Indies', '2021-05-20', 'not_applicable', 'Established foundational legal premise: transatlantic chattel slavery was illegal under international law at the time it was perpetrated. Presided over by ICJ Judge Patrick Robinson. Commissioned the Brattle Group economic analysis.', NULL, NULL, NULL, NULL),
            ('brattle_report_2023', 'Brattle Group: Quantification of Reparations for TCS', 'academic_report', 'The Brattle Group (commissioned by ASIL)', '2023-06-08', 'not_applicable', 'First rigorous state-to-state reparations quantification under international law. $100–131T globally; ~$36T U.S. share. Five heads of damages. Presented by ICJ Judge Patrick Robinson at UWI. Described as most comprehensive state-to-state analysis yet produced.', 'https://www.brattle.com/wp-content/uploads/2023/07/Report-on-Reparations-for-Transatlantic-Chattel-Slavery-in-the-Americas-and-the-Caribbean.pdf', NULL, NULL, NULL),
            ('un_resolution_a80l48_2026', 'UNGA A/80/L.48 — Gravest Crime Against Humanity', 'un_resolution', 'United Nations General Assembly', '2026-03-25', 'voted_against', 'Declares transatlantic slave trade "the gravest crime against humanity by reason of the definitive break in world history, scale, duration, systemic nature, brutality and enduring consequences that continue to structure the lives of all people through racialized regimes of labour, property and capital." Affirms reparations claims as "a concrete step towards remedying historical wrongs." Invokes ILC Articles on State Responsibility Arts. 35–37. Decisive shift from Durban subjunctive to indicative. 54 African Union member states co-sponsored. US, Israel, Argentina voted against; EU, UK, Canada, Australia, Japan abstained. Not legally binding but carries major normative and political weight.', NULL, 123, 3, 52)
            ON CONFLICT (instrument_key) DO NOTHING;
        `);

        // CALCULATION METHOD REGISTRY
        console.log('Seeding CALCULATION METHOD REGISTRY...');
        await client.query(`
            INSERT INTO calculation_method_registry (method_key, display_name, description, formula_pseudocode, source_author, source_year, source_citation, base_data_source, compound_rate_default, notes)
            VALUES
            ('wage_theft_craemer_2015', 'Craemer 2015 — Cost-to-Enslaved Wage Calculation', NULL, 'For each year Y from 1619 to 1865:\n  enslaved_population(Y) × free_labor_daily_wage(Y) × 365\nSum across all years = base_amount (historical dollars)\ncompounded = base_amount × (1 + 0.05)^(reference_year - 1865)\nNote: uses all 24hr/day of life lost to bondage, not only\nthe 10–12 labor hours that benefited the enslaver.', 'Craemer, Thomas; Neal, Larry; Darity/Mullen/Slaughter', 2015, 'Craemer T. Social Science Quarterly 96(2):639–655. 2015.', NULL, 0.05, NULL),
            ('freedmans_bank_direct_loss', 'Freedman''s Bank — Direct Depositor Loss, Compounded', NULL, 'base_amount = depositor_balance × (1 - 0.25)\n[recovery_rate ~0.25: roughly half of depositors got about half back]\nIf individual balance unknown, use median estimate: $42\n[historical: $75M+ total / ~1.8M deposit-account-years]\ncompounded = base_amount × (1 + 0.05)^(2024 - 1874)\nmultiplier: approximately 1,386×', NULL, NULL, 'Hill Edwards 2024; Britannica; National Archives; Chicago Booth', NULL, 0.05, NULL),
            ('land_acreage_current_value', 'Black Land Dispossession — Acreage at Current Market Value', NULL, 'net_acres_lost (est. ~12M) × USDA_avg_farmland_value_per_acre (current year)\nUSDA avg 2023: ~$3,800/acre\nRough macro floor: 12M × $3,800 = $45.6B\nDoes not include foregone appreciation, income compound, or legal costs.', NULL, NULL, 'Douglas 2017 (The Nation); USDA 2002; Pigford', NULL, NULL, NULL),
            ('forty_acres_present_value', '40 Acres — Betrayed Promise at Present Value', NULL, 'base = 40 acres × $5/acre (1865 avg Southern farmland) × 4,000,000 freed persons\n       = $800M (1865 dollars)\ncompounded = $800M × (1.05)^(2024 - 1865)', NULL, NULL, 'Darity & Mullen 2020; D&M 2022 global indicator approach', NULL, 0.05, NULL),
            ('fha_counterfactual_homeownership', 'FHA/GI Bill — Counterfactual Homeownership Wealth Transfer', NULL, 'counterfactual_wealth = Black_eligible_households ×\n                              avg_FHA_mortgage_benefit ×\n                              avg_home_appreciation_1934_to_present\nactual_wealth = Black_eligible_households × actual_FHA_share (2%)\nloss = counterfactual_wealth - actual_wealth', NULL, NULL, 'Rothstein 2017; Massachusetts Budget 2021; D&M 2022', NULL, NULL, 'Of $120B federally subsidized housing 1934–1962, <2% to non-whites. D&M compute FHA and GI Bill exclusion as separate itemization lines.'),
            ('brattle_802m_person_years', 'Brattle Group — Per-Person-Year International Law Rate', NULL, 'Brattle total (slavery period): $77T–$108T / 802M person-years\n  = ~$96,000–$135,000 per person-year (low/high ends)\nFor a documented individual:\n  person_years = death_year_estimate - birth_year_estimate\n  harm_value   = person_years × 96000  [conservative low end]\nNo additional compounding — Brattle figure already in present value.', NULL, NULL, 'Brattle Group 2023 (ASIL/UWI). Presented June 8, 2023.', NULL, 0, 'Maps individual platform records to the international law framework. Each canonical_person with a documented lifespan contributes their person-years to the 802M total. Apply legal theories: international_jus_cogens + international_crime_against_humanity.')
            ON CONFLICT (method_key) DO NOTHING;
        `);

        await client.query('COMMIT');
        console.log('Reparations framework seed completed successfully.');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error seeding reparations framework:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

seedData().catch(console.error);