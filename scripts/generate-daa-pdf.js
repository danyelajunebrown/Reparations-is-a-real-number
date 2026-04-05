#!/usr/bin/env node
/**
 * Generate DAA as formatted PDF
 *
 * Produces a professional Debt Acknowledgment Agreement matching the reference
 * format (DAA_Danyela_June_Brown_Complete.pdf) using HTML→PDF via Puppeteer.
 *
 * Usage:
 *   node scripts/generate-daa-pdf.js --session-id <UUID> --name "<Name>" --income <N>
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const puppeteer = require('puppeteer');
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

const sql = neon(process.env.DATABASE_URL);

function parseArgs() {
    const args = process.argv.slice(2);
    const params = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            params[args[i].substring(2)] = args[i + 1];
            i++;
        }
    }
    return params;
}

function formatCurrency(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + ' billion';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + ' million';
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCurrencyExact(n) {
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
    const params = parseArgs();
    if (!params['session-id'] || !params.name || !params.income) {
        console.error('Usage: node scripts/generate-daa-pdf.js --session-id <UUID> --name "<Name>" --income <N>');
        process.exit(1);
    }

    const sessionId = params['session-id'];
    const name = params.name;
    const income = parseInt(params.income);
    const annualPayment = Math.round(income * 0.02 * 100) / 100;
    const monthlyPayment = (annualPayment / 12).toFixed(2);

    // Get session
    const session = (await sql`SELECT * FROM ancestor_climb_sessions WHERE id = ${sessionId}`)[0];
    if (!session) { console.error('Session not found'); process.exit(1); }

    // Get matches (only verified ones)
    const allMatches = await sql`
        SELECT * FROM ancestor_climb_matches
        WHERE session_id = ${sessionId}
        ORDER BY generation_distance`;

    const verifiedMatches = allMatches.filter(m =>
        m.classification !== 'temporal_impossible' && m.classification !== 'common_name_suspect'
    );

    // Slaveholder connection documentation
    // NOTE: Debt calculation is NOT performed here. Individual debt figures require
    // documented enslaved persons with known dates. When enslaved persons are not yet
    // individually linked, we document the slaveholder connection and note that the
    // financial calculation is pending further research.
    // See GitHub Issue #2: canonical formula must be established before any debt figures
    // are generated.
    let totalDebt = null; // null = not yet calculable
    const slaveholderDebts = [];
    for (const m of verifiedMatches) {
        slaveholderDebts.push({
            name: m.slaveholder_name,
            generation: m.generation_distance,
            lineage: Array.isArray(m.lineage_path) ? m.lineage_path : [],
            matchType: m.match_type,
            confidence: Math.round((m.confidence_adjusted || m.match_confidence || 0) * 100),
            debt: null, // Pending: no fabricated calculation
            debtPending: true,
            yearsToPresent: null
        });
    }

    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const agreementNo = `DAA-2026-${name.split(' ').pop().substring(0, 3).toUpperCase()}-${String(allMatches.length).padStart(3, '0')}`;
    const headerText = `Debt Acknowledgment Agreement — ${name.toUpperCase()}`;

    // Build recitals from lineage data
    const recitals = [];
    if (verifiedMatches.length > 0) {
        for (const sh of slaveholderDebts) {
            const lineageStr = sh.lineage.join(' → ');
            recitals.push(`The ancestor climbing system identified <b>${sh.name}</b> as a documented participant in the Trans-Atlantic slave trade (SlaveVoyages database) at Generation ${sh.generation} in the Obligor's direct ancestral line. Lineage path: ${lineageStr}. Match confidence: ${sh.confidence}%.`);
        }
    }

    recitals.push(
        'Recent economic research has conclusively demonstrated that descendants of slaveholders recovered their wealth within one generation following the Civil War through strategic marriages and social networks, and that this wealth remains traceable through documented family networks. <i>(Ager, Boustan &amp; Eriksson, "The Intergenerational Effects of a Large Wealth Shock," American Economic Review 2021)</i>',
        'Historical research has documented that former slave owners made up more than half of all state legislators in Southern states until the late 1890s, thereby capturing the governmental institutions that would otherwise have been responsible for providing restitution. <i>(Bellani, Hager &amp; Maurer, "The Long Shadow of Slavery," Journal of Economic History 2022)</i>',
        'Under the doctrine of unjust enrichment, as articulated in the Restatement (Third) of Restitution and Unjust Enrichment, a person who is unjustly enriched at the expense of another is subject to liability in restitution. <i>(Dagan, "Restitution and Slavery," 84 B.U. L. Rev. 1139 (2004))</i>',
        'Historical precedent for individual reparations claims exists in the successful petition of Belinda Sutton to the Massachusetts General Court on February 14, 1783, wherein an enslaved woman obtained an annual pension from the confiscated estate of her former enslaver, Isaac Royall.',
        'The Seventh Circuit has held that consumer fraud claims arising from corporate misrepresentation of involvement in slavery may survive dismissal. <i>(In Re African-American Slave Descendants Litigation, 471 F.3d 754 (7th Cir. 2006))</i>'
    );

    // Schedule of enslaved persons
    // NOTE: When no individually documented enslaved persons are linked,
    // we document the slaveholder connection without fabricating persons.
    const enslavedSchedule = slaveholderDebts.map((sh, i) => ({
        num: i + 1,
        name: `[Enslaved persons held by ${sh.name} — not yet individually documented]`,
        family: 'Pending research',
        jbYrs: 'Unknown',
        ambYrs: 'Unknown'
    }));

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @page { margin: 1in 1in 1.2in 1in; }
  body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.6; color: #000; }
  .header { font-size: 9pt; color: #333; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-bottom: 20px; }
  .page-break { page-break-before: always; }
  h1 { font-size: 16pt; text-align: center; margin-top: 0; }
  h2 { font-size: 14pt; margin-top: 30px; }
  h3 { font-size: 12pt; margin-top: 20px; }
  .center { text-align: center; }
  .title-page { text-align: center; padding-top: 100px; }
  .title-page h1 { font-size: 18pt; letter-spacing: 2px; }
  .title-page .line { border-top: 2px solid #000; width: 60%; margin: 20px auto; }
  .title-page .subtitle { font-size: 13pt; font-style: italic; }
  .title-page .matter { margin-top: 40px; }
  .title-page .name { font-size: 16pt; font-weight: bold; letter-spacing: 1px; }
  .recital { margin-left: 40px; text-indent: -20px; margin-bottom: 10px; }
  .recital-label { font-weight: bold; margin-right: 8px; }
  table { border-collapse: collapse; width: 100%; margin: 15px 0; }
  th, td { border: 1px solid #000; padding: 6px 10px; text-align: left; font-size: 11pt; }
  th { background: #f0f0f0; font-weight: bold; }
  td.right, th.right { text-align: right; }
  .total-row td { font-weight: bold; border-top: 2px solid #000; }
  .big-total { font-size: 18pt; font-weight: bold; text-align: center; margin: 20px 0; }
  .sig-line { border-bottom: 1px solid #000; width: 300px; display: inline-block; margin-top: 30px; }
  .sig-label { margin-top: 5px; }
  ol.recitals { list-style-type: upper-alpha; margin-left: 20px; }
  ol.recitals li { margin-bottom: 12px; }
  ol.sub { list-style-type: lower-alpha; margin-left: 20px; }
  ol.sub li { margin-bottom: 6px; }
  .lineage-chain { font-size: 10pt; color: #333; margin: 5px 0 10px 20px; font-style: italic; }
</style>
</head>
<body>

<!-- TITLE PAGE -->
<div class="title-page">
  <p style="font-size: 13pt; letter-spacing: 3px;">REPARATIONS ∈ ℝ</p>
  <div class="line"></div>
  <h1>DEBT ACKNOWLEDGMENT AGREEMENT</h1>
  <p class="subtitle">With Primary Source Documentation</p>
  <div class="line"></div>
  <div class="matter">
    <p>In the Matter of:</p>
    <p class="name">${name.toUpperCase()}</p>
    <p><i>Obligor</i></p>
    <p style="margin-top: 30px;">Document No. ${agreementNo}<br>${today}</p>
  </div>
</div>

<!-- LEGAL FRAMEWORK -->
<div class="page-break"></div>
<div class="header">${headerText}</div>
<h2>PART I: LEGAL FRAMEWORK</h2>
<div class="note" style="border: 2px solid #333; padding: 12px; margin-bottom: 20px; font-size: 9pt;">
<b>NOTICE:</b> This document is produced by the Reparations ∈ ℝ research project. It is not a government document, court order, or attorney-reviewed legal instrument. The genealogical findings herein are based on automated research verified against primary sources. The financial methodology is under active development. This document represents a voluntary acknowledgment of inherited debt, not a court-imposed obligation. Participants are encouraged to seek independent legal counsel before taking action based on this document.
</div>
<p>This Debt Acknowledgment Agreement ("Agreement" or "DAA") is entered into as of ${today}, by the undersigned Obligor, acting voluntarily and with full understanding of the moral significance hereof.</p>

<h3>PARTIES</h3>
<p><b>OBLIGOR:</b> ${name}, a natural person and ${verifiedMatches.length > 0 ? 'documented descendant of persons identified in historical slaveholder databases' : 'participant in genealogical research'}, acknowledging inherited debt arising from the forced labor of enslaved persons.</p>
<p><b>BENEFICIARY CLASS:</b> The documented descendants of enslaved persons held by the identified slaveholders, and their heirs and assigns, collectively and severally.</p>

<h3>RECITALS</h3>
<p><b>WHEREAS:</b></p>
<ol class="recitals">
${recitals.map(r => `  <li>${r}</li>`).join('\n')}
</ol>

<p><b>NOW, THEREFORE,</b> in consideration of the moral obligation arising from the foregoing facts, and with the intent to voluntarily acknowledge an inherited debt, the Obligor states as follows:</p>

<!-- ARTICLE I -->
<div class="page-break"></div>
<div class="header">${headerText}</div>
<h2>ARTICLE I: ACKNOWLEDGMENT OF DEBT</h2>

<h3>Section 1.1 — Principal Acknowledgment</h3>
<p>Obligor hereby acknowledges and affirms that Obligor has inherited, through the mechanisms of intergenerational wealth transfer, social capital, and network advantages, a debt obligation arising from the unpaid labor of enslaved persons ${verifiedMatches.length > 0 ? 'held by ' + slaveholderDebts.map(s => s.name).join(' and ') : 'in the broader system of American chattel slavery'}.</p>

<h3>Section 1.2 — Calculation of Debt</h3>
<p>The debt calculation methodology is under active development. The current approach, based on Craemer (2015), uses:</p>
<ol class="sub">
  <li><b>Base Wage Theft:</b> Historical free-labor daily wage × working days × years enslaved (Craemer, Social Science Quarterly 96.2, 2015, Table 1, p. 644);</li>
  <li><b>Compound Interest:</b> 3% annual rate from year of enslavement to present (Craemer, p. 645 — conservative floor rate);</li>
  <li><b>No additional multipliers:</b> Compound interest already accounts for time value of money. Additional inflation or wealth multipliers would double-count.</li>
</ol>
<p><i>Note: This methodology produces a conservative floor estimate. The Brattle Group (2023) comprehensive forensic economics analysis estimates $100-131 trillion in total reparations across 19 million people. Darity & Mullen (2020) propose a wealth-gap closure model at $7.95 trillion. This DAA's calculation methodology will be updated as research matures.</i></p>

${verifiedMatches.length > 0 ? `
<p>The following documented slaveholders were identified in Obligor's direct ancestral line:</p>
<table>
  <tr><th>Slaveholder</th><th>Generation</th><th>Match Source</th><th>Confidence</th></tr>
  ${slaveholderDebts.map(s => `<tr><td>${s.name}</td><td>Gen ${s.generation}</td><td>${s.matchType === 'slavevoyages_enslaver' ? 'SlaveVoyages' : 'Enslaver DB'}</td><td>${s.confidence}%</td></tr>`).join('\n  ')}
</table>
<div class="note"><b>Note:</b> Financial debt calculations are pending. Individually documented enslaved persons must be linked to each slaveholder before debt can be computed. The calculation methodology is under active research and development. This DAA will be updated as the methodology matures and additional primary sources are processed.</div>
` : `<p>No documented slaveholders with linked enslaved individuals were identified in the current database. The debt calculation will be updated as the enslaver database expands.</p>`}

<h3>Section 1.3 — Per Stirpes Division</h3>
<p>Obligor acknowledges that this debt represents Obligor's proportionate share as one descendant among many. The debt shall be divided per stirpes among all documented descendants of the slaveholders in Obligor's lineage who execute similar acknowledgments.</p>

<!-- ARTICLE II -->
<div class="page-break"></div>
<div class="header">${headerText}</div>
<h2>ARTICLE II: PAYMENT TERMS</h2>

<h3>Section 2.1 — Payment Obligation</h3>
<p>Obligor agrees to pay <b>Two Percent (2%) of Obligor's gross annual income</b>, payable in equal monthly installments, toward satisfaction of the debt acknowledged herein.</p>

<h3>Section 2.2 — Current Payment Calculation</h3>
<p>Based on Obligor's current gross annual income of <b>${formatCurrencyExact(income)}</b>, the initial annual payment shall be <b>${formatCurrencyExact(annualPayment)}</b> (approximately <b>${formatCurrencyExact(monthlyPayment)} per month</b>).</p>

<h3>Section 2.3 — Duration</h3>
<p>Payment obligations shall continue until the <b>earlier</b> of:</p>
<ol class="sub">
  <li>The enactment of federal reparations legislation (including but not limited to HR 40 or equivalent);</li>
  <li>Thirty (30) years from the date of execution; or</li>
  <li>The death of Obligor.</li>
</ol>

<h2>ARTICLE III: PAYMENT MECHANISM</h2>

<h3>Section 3.1 — Blockchain Escrow</h3>
<p>All payments are recorded on the <b>ReparationsEscrow</b> smart contract deployed on the Base blockchain (Ethereum Layer 2), at contract address <code>0x914846ceA07e57d848d9d60C8238865D83d9ab1E</code>. This contract provides:</p>
<ol class="sub">
  <li>Transparent and auditable transaction history on a public blockchain;</li>
  <li>USDC stablecoin deposits (pegged to US Dollar, issued by Circle);</li>
  <li>Programmatic disbursement to verified descendants;</li>
  <li>Revisable debt amounts as methodology matures (all revisions recorded on-chain).</li>
</ol>
<p>Contract verification: <a href="https://basescan.org/address/0x914846ceA07e57d848d9d60C8238865D83d9ab1E">https://basescan.org/address/0x914846ceA07e57d848d9d60C8238865D83d9ab1E</a></p>

<h3>Section 3.2 — Disbursement Conditions</h3>
<p>Funds collected shall be held and disbursed upon establishment of verified disbursement mechanisms, which may include:</p>
<ol class="sub">
  <li>Establishment of a federal reparations program;</li>
  <li>Verification of lineal descendants of the enslaved persons;</li>
  <li>Establishment of a qualified community reparations fund; or</li>
  <li>Mutual agreement of Obligor and verified beneficiary representatives.</li>
</ol>

<!-- ARTICLE IV -->
<div class="page-break"></div>
<div class="header">${headerText}</div>
<h2>ARTICLE IV: ACKNOWLEDGMENTS</h2>

<h3>Section 4.1 — Voluntary Acknowledgments</h3>
<p>Obligor voluntarily acknowledges the following:</p>
<ol class="sub">
  <li><b>Genealogical Connection:</b> Obligor affirms direct connection to documented slaveholders through verified genealogical research;</li>
  <li><b>Wealth Transmission:</b> Obligor acknowledges that intergenerational wealth, social capital, and network advantages have been transmitted through the documented lineage;</li>
  <li><b>Inherited Debt:</b> Obligor acknowledges that the unpaid debts arising from enslaved labor have been inherited, not created, by this generation.</li>
</ol>

<h3>Section 4.2 — Class Formation</h3>
<p>Obligor joins the class of documented descendants of slaveholders who have voluntarily acknowledged their inherited debt obligation, for purposes of aggregating acknowledgments and advocating for legislative action.</p>

<h3>Section 4.3 — Corporate Consumer Fraud Reservation</h3>
<p>Obligor reserves the right to participate in future consumer fraud claims against corporations that profited from the labor of the enslaved persons named herein, pursuant to <i>In Re African-American Slave Descendants Litigation</i>, 471 F.3d 754 (7th Cir. 2006).</p>

<h2>ARTICLE V: ANNUAL RE-PETITION</h2>

<h3>Section 5.1 — Government Petition</h3>
<p>This acknowledgment shall be automatically re-submitted annually to:</p>
<ol class="sub">
  <li>The United States Congress (care of the sponsor of HR 40 or equivalent);</li>
  <li>The Governor and General Assembly of the State of New York;</li>
  <li>Local government representatives as applicable.</li>
</ol>

<h3>Section 5.2 — Belinda's Precedent</h3>
<p>This re-petition mechanism follows Belinda Sutton, who petitioned the Massachusetts General Court five times over ten years (1783-1793) before securing a lifetime pension from her enslaver's confiscated estate.</p>

<!-- EXHIBIT A: LINEAGE -->
<div class="page-break"></div>
<div class="header">${headerText}</div>
<h2>EXHIBIT A</h2>
<h3>ANCESTRAL LINEAGE DOCUMENTATION</h3>
<p><i>Genealogical research conducted via the Reparations ∈ ℝ Ancestor Climbing System</i></p>
<p><b>Climb Session:</b> ${sessionId}</p>
<p><b>Ancestors Visited:</b> ${session.ancestors_visited}</p>
<p><b>Total Matches Found:</b> ${allMatches.length} (${verifiedMatches.length} verified, ${allMatches.length - verifiedMatches.length} filtered)</p>
<p><b>Methodology:</b> BFS traversal of FamilySearch historical records, WikiTree API, and participant-provided family tree data. Each discovered ancestor was cross-referenced against the Trans-Atlantic Slave Trade Database (SlaveVoyages.org) and the project's canonical enslaver database (${(await sql`SELECT count(*) as cnt FROM canonical_persons WHERE person_type = 'enslaver'`)[0].cnt.toLocaleString()} documented enslavers).</p>

${slaveholderDebts.map((sh, i) => `
<h3>Match ${i + 1}: ${sh.name}</h3>
<p><b>Match Type:</b> ${sh.matchType === 'slavevoyages_enslaver' ? 'Trans-Atlantic Slave Trade Database (SlaveVoyages.org)' : 'Historical enslaver records'}</p>
<p><b>Confidence:</b> ${sh.confidence}%</p>
<p><b>Generation Distance:</b> ${sh.generation}</p>
<p><b>Complete Lineage Path:</b></p>
<div class="lineage-chain">${sh.lineage.join(' → ')}</div>
`).join('\n')}

${allMatches.filter(m => m.classification === 'temporal_impossible' || m.classification === 'common_name_suspect').length > 0 ? `
<h3>Filtered Matches (Not Included in Debt Calculation)</h3>
<table>
  <tr><th>Ancestor</th><th>Gen</th><th>Classification</th><th>Reason</th></tr>
  ${allMatches.filter(m => m.classification === 'temporal_impossible' || m.classification === 'common_name_suspect').map(m =>
    `<tr><td>${m.slaveholder_name}</td><td>${m.generation_distance}</td><td>${m.classification}</td><td>${(m.classification_reason || '').substring(0, 80)}</td></tr>`
  ).join('\n  ')}
</table>
` : ''}

<!-- EXHIBIT B: CALCULATION -->
<div class="page-break"></div>
<div class="header">${headerText}</div>
<h2>EXHIBIT B</h2>
<h3>CALCULATION METHODOLOGY</h3>
<p>The debt calculation follows the framework established by Darity &amp; Mullen (2020) and refined by Ager, Boustan &amp; Eriksson (2021):</p>
<table>
  <tr><th>Component</th><th>Value</th><th>Basis</th></tr>
  <tr><td>Daily wage equivalent</td><td>$120.00</td><td>Wage theft + dignity damages + profit share</td></tr>
  <tr><td>Working days per year</td><td>300</td><td>Historical average for enslaved labor</td></tr>
  <tr><td>Base annual wage theft</td><td>$36,000</td><td>$120 × 300 days</td></tr>
  <tr><td>Default years enslaved</td><td>30</td><td>Average lifespan in bondage</td></tr>
  <tr><td>Compound interest rate</td><td>4%</td><td>Conservative annual rate since enslavement</td></tr>
  <tr><td>Delayed justice penalty</td><td>3.2×</td><td>2% per year × 160 years since 1865</td></tr>
</table>

<p><b>Formula:</b> Base Wage Theft × (1.04)<sup>years</sup> × 3.2</p>

<!-- EXHIBIT C: ENSLAVED PERSONS -->
${verifiedMatches.length > 0 ? `
<div class="page-break"></div>
<div class="header">${headerText}</div>
<h2>EXHIBIT C</h2>
<h3>SCHEDULE OF ENSLAVED PERSONS</h3>
<p><i>Specific enslaved individuals have not yet been individually linked to these slaveholders in the project database. The entries below document the slaveholder connections identified through automated genealogical research. As primary source research continues, individual enslaved persons will be identified, linked, and their documented dates used to calculate specific debt figures.</i></p>
<table>
  <tr><th>#</th><th>Slaveholder</th><th>Source Database</th><th>Enslaved Persons</th></tr>
  ${slaveholderDebts.map((s, i) => `<tr><td>${i+1}</td><td>${s.name}</td><td>${s.matchType === 'slavevoyages_enslaver' ? 'SlaveVoyages' : 'Enslaver DB'}</td><td>Pending individual documentation</td></tr>`).join('\n  ')}
</table>
` : ''}

<!-- EXHIBIT E: SUMMARY -->
<div class="page-break"></div>
<div class="header">${headerText}</div>
<h2>EXHIBIT E</h2>
<h3>STATUS OF DEBT CALCULATIONS</h3>
<table>
  <tr><th>Slaveholder</th><th>Generation</th><th>Match Confidence</th><th>Debt Status</th></tr>
  ${slaveholderDebts.map(s => `<tr><td>${s.name}</td><td>Gen ${s.generation}</td><td>${s.confidence}%</td><td><i>Pending — enslaved persons not yet individually documented</i></td></tr>`).join('\n  ')}
</table>

<div style="margin-top: 30px; border-top: 2px solid #000; padding-top: 10px;">
<p class="big-total">DOCUMENTED SLAVEHOLDER CONNECTIONS: ${verifiedMatches.length}</p>
<p style="text-align: center; font-size: 14pt;"><i>Financial debt calculations pending further research</i></p>
</div>

<p style="margin-top: 20px;"><i>Note: This DAA documents verified genealogical connections to slaveholders. Specific debt figures will be calculated when individually documented enslaved persons are linked to each slaveholder with verified dates of enslavement. The calculation methodology is under active development in consultation with published economic research. This document will be updated as research matures.</i></p>

<!-- EXECUTION -->
<div class="page-break"></div>
<div class="header">${headerText}</div>
<h2>EXECUTION</h2>
<p>IN WITNESS WHEREOF, the undersigned Obligor acknowledges the foregoing debt calculations based on genealogical research conducted by the Reparations ∈ ℝ system and executes this Agreement.</p>

<p style="margin-top: 40px;"><b>OBLIGOR:</b></p>
<p><span class="sig-line">&nbsp;</span></p>
<p class="sig-label"><b>${name.toUpperCase()}</b></p>
<p>Date: <span class="sig-line" style="width: 200px;">&nbsp;</span></p>

<p style="margin-top: 40px;"><b>WITNESS:</b></p>
<p><span class="sig-line">&nbsp;</span></p>
<p>Print Name: <span class="sig-line" style="width: 200px;">&nbsp;</span></p>
<p>Date: <span class="sig-line" style="width: 200px;">&nbsp;</span></p>

<p style="margin-top: 40px; text-align: center;">— END OF AGREEMENT —</p>
<p style="text-align: center;"><i>Document No. ${agreementNo} | Reparations ∈ ℝ</i></p>

</body>
</html>`;

    // Generate PDF
    const outputDir = path.join(__dirname, '../generated-daas');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const pdfPath = path.join(outputDir, `DAA-${agreementNo}-${name.replace(/\s+/g, '_')}.pdf`);

    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
        path: pdfPath,
        format: 'Letter',
        margin: { top: '0.75in', bottom: '1in', left: '1in', right: '1in' },
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate: '<div style="font-size: 9px; text-align: center; width: 100%; color: #666;">Page <span class="pageNumber"></span></div>'
    });
    await browser.close();

    console.log(`\n✅ DAA generated: ${pdfPath}`);
    console.log(`   Name: ${name}`);
    console.log(`   Matches: ${verifiedMatches.length} verified (${allMatches.length - verifiedMatches.length} filtered)`);
    console.log(`   Total debt: ${totalDebt !== null ? formatCurrency(totalDebt) : 'Pending — enslaved persons not yet individually documented'}`);
    console.log(`   Annual payment: ${annualPayment ? formatCurrencyExact(annualPayment) : 'Pending debt calculation'}`);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
