import React, { useState } from 'react';
import { formatUSD } from '../../api/format.js';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';

/**
 * ReparationsBreakdown — displays the multi-calculator output for a person.
 *
 * POLICY: Every figure here must come from a sourced methodology. The old
 * Calculator.js ($120/day, $15K dignity, 4% compound) used unsourced constants
 * and is NOT used here. This component expects a `breakdown` object shaped by
 * the backend's DAAGenerator (Craemer 2015 wealth-gap methodology) plus the
 * four additional calculators (WealthGap, ICHEIC, TieredPayment, and the
 * sector calculators: Insurance, Banking, Railroad).
 *
 * If the backend hasn't returned calculator-structured data yet (legacy
 * /api/contribute/person endpoint), we fall back to a display-only view that
 * clearly labels each figure with its source. We NEVER display a number
 * without a source in the UI.
 */
export function ReparationsBreakdown({ breakdown, enslavedCount, subject }) {
  const [activeMethod, setActiveMethod] = useState('wealth_gap');

  // Detect which methodologies are present.
  const methods = detectMethods(breakdown);

  if (methods.length === 0) {
    return (
      <div className="state">
        No sourced reparations calculation available for this record yet.
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <div className="box">
        <div className="box-label">Methodology</div>
        <div className="row-wrap" style={{ marginTop: 4 }}>
          {methods.map(m => (
            <button
              key={m.key}
              type="button"
              onClick={() => setActiveMethod(m.key)}
              style={{
                borderColor: activeMethod === m.key ? 'var(--fg)' : 'var(--border)',
                color: activeMethod === m.key ? 'var(--fg)' : 'var(--dim)',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <MethodDetail
        methodKey={activeMethod}
        breakdown={breakdown}
        enslavedCount={enslavedCount}
        subject={subject}
      />

      <div className="box" style={{ fontSize: 11, color: 'var(--dim)' }}>
        <strong>Disclaimer:</strong> These figures are illustrative of the
        quantified debt under each published methodology. They are not legal
        judgments. Every constant used is cited. The spread between methods
        reflects legitimate academic disagreement on the correct accounting
        approach — not uncertainty about the debt itself.
      </div>
    </div>
  );
}

function detectMethods(breakdown) {
  if (!breakdown) return [];
  const methods = [];

  // New Line Items method
  if (breakdown.line_items_by_era) {
    methods.push({ key: 'line_items', label: 'Line Items' });
  }

  // Check for wealth gap calculator output
  if (breakdown.wealth_gap || breakdown.wealthGap || breakdown.craemer || breakdown.wage_theft) {
    methods.push({ key: 'wealth_gap', label: 'Wealth gap (Craemer 2015 / Darity & Mullen)' });
  }
  // ICHEIC adaptation
  if (breakdown.icheic) {
    methods.push({ key: 'icheic', label: 'ICHEIC (Holocaust-era assets adaptation)' });
  }
  // Tiered payment
  if (breakdown.tiered) {
    methods.push({ key: 'tiered', label: 'Tiered payment (progressive)' });
  }
  // Sector-specific
  if (breakdown.insurance) methods.push({ key: 'insurance', label: 'Insurance (Farmer-Paellmann)' });
  if (breakdown.banking) methods.push({ key: 'banking', label: 'Banking (Farmer-Paellmann)' });
  if (breakdown.railroad) methods.push({ key: 'railroad', label: 'Railroad (Kornweibel)' });

  // If none of the structured fields are present AND total > 0, fall back
  // to generic breakdown display clearly labelled as "uncited calculator".
  // If total === 0 we skip this — returning [] triggers the "not available"
  // state, which is more honest than showing a page of $0.00 figures.
  if (methods.length === 0 && breakdown.total > 0) {
    methods.push({ key: 'legacy', label: 'Legacy (uncited — shown for audit only)' });
  }

  return methods;
}

function MethodDetail({ methodKey, breakdown, enslavedCount, subject }) {
  if (!breakdown) return null;

  switch (methodKey) {
    case 'line_items':
      return <LineItemsView breakdown={breakdown} />;
    case 'wealth_gap':
      return <WealthGapView breakdown={breakdown} enslavedCount={enslavedCount} />;
    case 'icheic':
      return <ICHEICView breakdown={breakdown} />;
    case 'tiered':
      return <TieredView breakdown={breakdown} />;
    case 'insurance':
      return <SectorView sector="insurance" breakdown={breakdown.insurance} />;
    case 'banking':
      return <SectorView sector="banking" breakdown={breakdown.banking} />;
    case 'railroad':
      return <SectorView sector="railroad" breakdown={breakdown.railroad} />;
    case 'legacy':
      return <LegacyView breakdown={breakdown} />;
    default:
      return <div className="state">Unknown methodology.</div>;
  }
}

function LineItemsView({ breakdown }) {
    const { line_items_by_era, global_indicator_context, domestic_total_usd, international_total_usd } = breakdown;

    // Global indicator targets come from the backend (global_indicator_targets
    // table via GET /api/daa/global-indicators) — never hardcoded, so the
    // published estimates stay in one sourced place.
    const { data: indicatorData, loading: indicatorsLoading, error: indicatorsError } =
        useApi(signal => api.getGlobalIndicators(signal), []);
    const globalIndicatorTargetsData = indicatorData?.indicators || [];

    return (
        <div className="stack-lg">
            {/* SECTION 1 — International Law Context */}
            <div className="box">
                <div className="box-label">International Law Context</div>
                <p>On March 25, 2026, 123 UN member states declared the transatlantic slave trade "the gravest crime against humanity" (Resolution A/80/L.48, adopted 123–3 with 52 abstentions). The United States voted against.</p>
                <table className="table">
                    <thead>
                        <tr>
                            <th>Source</th>
                            <th>Scope</th>
                            <th>Methodology</th>
                            <th>Estimate</th>
                            <th>Reference Year</th>
                        </tr>
                    </thead>
                    <tbody>
                        {indicatorsLoading && (
                            <tr><td colSpan={5} className="dim">Loading published estimates…</td></tr>
                        )}
                        {indicatorsError && !indicatorsLoading && (
                            <tr><td colSpan={5} className="err">Could not load indicator targets.</td></tr>
                        )}
                        {!indicatorsLoading && !indicatorsError && globalIndicatorTargetsData.length === 0 && (
                            <tr><td colSpan={5} className="dim">No indicator targets available.</td></tr>
                        )}
                        {globalIndicatorTargetsData.map((item) => (
                            <tr key={item.id}>
                                <td>{item.source_author}</td>
                                <td>{item.scope}</td>
                                <td>{item.methodology}</td>
                                <td>
                                    {item.total_usd_high && item.total_usd_high !== item.total_usd_low
                                        ? `${formatUSD(item.total_usd_low)} - ${formatUSD(item.total_usd_high)}`
                                        : formatUSD(item.total_usd_low)}
                                </td>
                                <td>{item.reference_year}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* SECTION 2 — This Person's Documented Line Items */}
            <div className="box">
                <div className="box-label">This Person's Documented Line Items</div>
                {Object.keys(line_items_by_era).map(era => (
                    <div key={era} className="stack-sm">
                        <h3>{era.replace(/_/g, ' ').toUpperCase()}</h3>
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Harm Category</th>
                                    <th>Evidence Tier</th>
                                    <th>Perpetrator</th>
                                    <th>Compounded Amount</th>
                                    <th>Legal Theory</th>
                                    <th>Citation</th>
                                </tr>
                            </thead>
                            <tbody>
                                {line_items_by_era[era].map((item, index) => (
                                    <tr key={index}>
                                        <td>{item.harm_display}</td>
                                        <td>{item.evidence_tier}</td>
                                        <td>{item.perpetrator_display}</td>
                                        <td>{formatUSD(item.compounded_amount_usd)}</td>
                                        <td>{item.legal_theory_display} ({item.legal_theory_jurisdiction})</td>
                                        <td>{item.citation}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className="text-right">
                            <strong>Subtotal ({era.replace(/_/g, ' ').toUpperCase()}):</strong> {formatUSD(line_items_by_era[era].reduce((sum, item) => sum + parseFloat(item.compounded_amount_usd || 0), 0))}
                        </div>
                    </div>
                ))}
                <div className="text-right" style={{ marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '0.5rem' }}>
                    <strong>Grand Total:</strong> {formatUSD(breakdown.total_usd)}
                </div>
                <div className="text-right">
                    <strong>Domestic Subtotal:</strong> {formatUSD(domestic_total_usd)}
                </div>
                <div className="text-right">
                    <strong>International Subtotal:</strong> {formatUSD(international_total_usd)}
                </div>
            </div>

            {/* SECTION 3 — Context and Disclaimer */}
            <div className="box" style={{ fontSize: 11, color: 'var(--dim)' }}>
                <strong>Context and Disclaimer:</strong>
                <p>These figures represent Tier 1 (directly documented) evidence. Additional community-level (Tier 2) and population-level (Tier 3) claims may apply.</p>
                <p>This calculation is an estimate grounded in published academic methodology. It does not constitute legal advice or a legally binding claim.</p>
            </div>
        </div>
    );
}

function WealthGapView({ breakdown, enslavedCount }) {
  const wg = breakdown.wealth_gap || breakdown.wealthGap || breakdown;
  const total = wg.total || breakdown.total;
  const wageTheft = wg.wage_theft ?? breakdown.wage_theft ?? wg.wageTheft;
  const interest = wg.interest ?? breakdown.interest;
  const damages = wg.damages ?? breakdown.damages;

  return (
    <div className="stack-lg">
      <Cite>
        Source: Craemer, Thomas. 2015. "Estimating slavery reparations:
        Present value comparisons of historical multigenerational reparations
        policies." <em>Social Science Quarterly</em> 96(2):639–655. Methodology
        adapted by Darity &amp; Mullen (2020) <em>From Here to Equality</em>.
      </Cite>
      <div className="grid-3">
        <Line label="Uncompensated labor" value={wageTheft} />
        <Line label="Compound interest (historical Treasury rates)" value={interest} />
        <Line label="Damages (non-economic harm)" value={damages} />
      </div>
      <Total value={total} />
      <div className="dim" style={{ fontSize: 12 }}>
        Per enslaved person documented: {enslavedCount > 0 ? formatUSD((total || 0) / enslavedCount) : '—'}
      </div>
    </div>
  );
}

function ICHEICView({ breakdown }) {
  const ic = breakdown.icheic || {};
  return (
    <div className="stack-lg">
      <Cite>
        Source: International Commission on Holocaust Era Insurance Claims
        (ICHEIC) settlement model adapted for slave-era insurance policies.
        See research/issue-23-icheic-methodology-adaptation.md in this repo.
      </Cite>
      <div className="grid-3">
        <Line label="Documented asset value" value={ic.asset_value} />
        <Line label="Adjustment factor" value={ic.adjustment_factor} raw />
        <Line label="Modern equivalent" value={ic.modern_value} />
      </div>
      <Total value={ic.total} />
    </div>
  );
}

function TieredView({ breakdown }) {
  const t = breakdown.tiered || {};
  return (
    <div className="stack-lg">
      <Cite>
        Source: Progressive tiered payment model. Thresholds currently marked
        PLACEHOLDER in TieredPaymentCalculator — see GitHub issues #17, #18.
        Figures below should be treated as an upper bound pending finalization.
      </Cite>
      <div className="grid-3">
        <Line label="Tier 1 (base)" value={t.tier_1} />
        <Line label="Tier 2 (progressive)" value={t.tier_2} />
        <Line label="Tier 3 (top bracket)" value={t.tier_3} />
      </div>
      <Total value={t.total} />
    </div>
  );
}

function SectorView({ sector, breakdown }) {
  if (!breakdown) return <div className="state">No {sector} calculation available.</div>;
  const citeText = {
    insurance: 'Farmer-Paellmann v. FleetBoston Financial (N.D. Ill. 2004). California DOI Slavery Era Insurance Registry.',
    banking: 'Farmer-Paellmann v. FleetBoston. JP Morgan Chase/Heritage Bank disclosure (2024). Brown Brothers Harriman archival records.',
    railroad: 'Kornweibel, Theodore. 2010. Railroads in the African American Experience. Johns Hopkins UP.',
  }[sector];
  return (
    <div className="stack-lg">
      <Cite>{citeText}</Cite>
      <div className="grid-3">
        <Line label="Documented exposure" value={breakdown.exposure} />
        <Line label="Inflation adjustment" value={breakdown.inflation_factor} raw />
        <Line label="Modern liability" value={breakdown.modern_value} />
      </div>
      <Total value={breakdown.total} />
    </div>
  );
}

function LegacyView({ breakdown }) {
  return (
    <div className="stack-lg">
      <div className="box warn">
        <strong>Warning:</strong> This figure comes from the legacy
        Calculator.js using unsourced constants ($120/day wage base, $15K
        dignity value, 4% compound interest, 2% penalty). These constants are
        flagged in the April 4 methodology audit (GitHub issues #9, #12, #17,
        #18). The figure is shown here for internal audit only and should not
        be treated as a sourced calculation.
      </div>
      <div className="grid-3">
        <Line label="Wage theft" value={breakdown.wage_theft || breakdown.wageTheft} />
        <Line label="Damages" value={breakdown.damages} />
        <Line label="Compound interest" value={breakdown.interest || breakdown.compoundInterest} />
      </div>
      <Total value={breakdown.total} />
    </div>
  );
}

function Line({ label, value, raw = false }) {
  return (
    <div className="box">
      <div className="box-label">{label}</div>
      <div>{value == null ? '—' : raw ? String(value) : formatUSD(value)}</div>
    </div>
  );
}

function Total({ value }) {
  return (
    <div className="box" style={{ borderColor: 'var(--fg)' }}>
      <div className="box-label">Total owed (this methodology)</div>
      <div style={{ fontSize: 20 }}>{formatUSD(value)}</div>
    </div>
  );
}

function Cite({ children }) {
  return (
    <div className="box" style={{ fontSize: 11, color: 'var(--dim)', borderStyle: 'dashed' }}>
      <div className="box-label">Citation</div>
      <div>{children}</div>
    </div>
  );
}
