-- 129-massena-parcel-spine.sql — the FIRST real chain-of-title instrument: the Massena parcel.
--
-- Massena (Barrytown, Town of Red Hook, Dutchess County NY) is Bard College's own campus land. The
-- user-supplied Massena_Chain_of_Title_PACKET.pdf documents a continuous 22-link chain 1688→2024. Until
-- now that chain lived only as prose in finding-land-nonclaim-and-dutchess-audit-jul17.md §4; the parcel
-- tables (properties M112, land_transfer_events 038, modern_parcel_links 038) were built and empty. This
-- seeds the chain as data.
--
-- WHY IT MATTERS: (1) Beekman and Livingston — two links in this chain — are exactly the Dutchess enslaver
-- families the wills/census document. The land wealth and the enslaving wealth are the same wealth. (2) The
-- modern holder is Bard College (2024) — a candidate MODERN ENDPOINT for the Dutchess calibration (an
-- institutional successor with a documented line to a Dutchess enslaver family). (3) It carries a real
-- wealth-over-time series on ONE parcel across 336 years.
--
-- LAND NON-CLAIM (migration 125, wealth-tracing-framework §4): land value is a VALUATION instrument, never
-- a claimed asset. Therefore EVERY link here is written implicates_enslaver=FALSE so it does NOT feed the
-- descendant disgorgement ledger (DisgorgementCalculator sums consideration_usd only WHERE
-- implicates_enslaver=TRUE). The considerations are the wealth-over-time series — used to VALUE, never to
-- CLAIM. The Indigenous origin ("Link 0", 1686 Rhinebeck Indian deed) is already seeded in
-- indigenous_land_provenance (migration 125) and is restituted separately to the Stockbridge-Munsee, not
-- claimed here.
--
-- FIDELITY: the packet has 22 links; this seeds the 12 cleanly-attributable NAMED transitions from the
-- finding abstract (the De Witt intermediary and other un-dated links await full-packet reconciliation). The
-- full packet is NOT yet S3-archived (file-first rule 8) — so the parcel row is requires_human_review=TRUE
-- pending archival + reconciliation of the remaining links. No fabricated links: only what §4 documents.
-- Idempotent: guarded so re-running inserts nothing new.

DO $$
DECLARE
  v_prop uuid;
BEGIN
  -- ── parcel anchor ──
  SELECT property_id INTO v_prop FROM properties
    WHERE property_name = 'Massena' AND county = 'Dutchess' AND state = 'New York'
    LIMIT 1;

  IF v_prop IS NULL THEN
    INSERT INTO properties (
      property_name, alternate_names, property_type, legal_description, subdivision,
      liber_folio, county, state, location_description, modern_jurisdiction,
      source_archive, confidence, requires_human_review, notes
    ) VALUES (
      'Massena',
      ARRAY['Massena estate','Bard College campus (Barrytown)'],
      'estate',
      'Barrytown, Town of Red Hook, Dutchess County, New York — Bard College campus parcel',
      NULL,
      'Liber 99, p. 405-407',
      'Dutchess', 'New York',
      'Barrytown, Town of Red Hook, Dutchess County, NY',
      'Town of Red Hook, NY',
      'Massena_Chain_of_Title_PACKET.pdf (user-supplied; NOT yet S3-archived — file-first rule 8 follow-up)',
      0.85, TRUE,
      '22-link continuous chain of title 1688-2024; 12 named links seeded (migration 129). Full-packet reconciliation + S3 archival pending. Wealth-over-time series anchored here; Indigenous Link 0 in indigenous_land_provenance (migration 125), restituted separately to Stockbridge-Munsee.'
    )
    RETURNING property_id INTO v_prop;
  END IF;

  -- ── chain-of-title links (implicates_enslaver=FALSE: value, never claim) ──
  INSERT INTO land_transfer_events (
    property_id, transfer_year, transfer_type, instrument_type,
    grantor_name, grantee_name, consideration_usd, implicates_enslaver,
    source_archive, source_page, source_notes, confidence, verification_status,
    requires_human_review, review_reason
  )
  SELECT v_prop, t.yr, t.ttype, t.itype, t.grantor, t.grantee, t.usd, FALSE,
    'Massena_Chain_of_Title_PACKET.pdf', 'Liber 99, p. 405-407', t.note, 0.80, 'unverified',
    TRUE,
    'chain-of-title PROVENANCE; land value is a valuation instrument, never a claimed asset (land-non-claim, migration 125)'
  FROM (VALUES
    (1688, 'grant',       'patent', 'Crown / Province of New York',                'Schuyler (1688 Schuyler Patent)',                    NULL::numeric, 'Link 1; title origin recites purchase "of and from the Indyans, Naturall Owners & Possessors" — see indigenous_land_provenance / 1686 Rhinebeck Indian deed'),
    (1715, 'sale',        'deed',   'De Witt',                                     'Beekman',                                            NULL,          'Beekman = a Dutchess ENSLAVER family (same wealth as the wills/census)'),
    (1776, 'inheritance', 'will',   'Beekman',                                     'Margaret Beekman Livingston',                        NULL,          'Livingston = a Dutchess ENSLAVER family'),
    (1800, 'inheritance', 'deed',   'Margaret Beekman Livingston',                 'John R. Livingston',                                 NULL,          'John R. Livingston builds the Massena house 1796; conveyance 1785/1800'),
    (1853, 'sale',        'deed',   'John R. Livingston (estate)',                 'Henry Dwight Jr.',                                   50000,         'wealth-over-time series: $50,000 (1853)'),
    (1858, 'foreclosure', 'decree', 'Henry Dwight Jr.',                            'Stewart Brown',                                      20000,         'foreclosure sale $20,000 (1858) — value trough'),
    (1860, 'sale',        'deed',   'Stewart Brown',                               'Aspinwall',                                          NULL,          'Link'),
    (1911, 'sale',        'deed',   'Aspinwall',                                   'Kip',                                                NULL,          'Link'),
    (1928, 'sale',        'deed',   'Kip',                                         'St. Joseph''s (religious institution)',              NULL,          'Link'),
    (1974, 'sale',        'deed',   'St. Joseph''s',                               'Unification Church',                                 1150000,       'wealth-over-time series: $1,150,000 (1974)'),
    (1987, 'sale',        'deed',   'Unification Church',                          'Unification Theological Seminary (UTS)',             NULL,          'Link'),
    (2024, 'sale',        'deed',   'Unification Theological Seminary (UTS)',      'Bard College',                                       14000000,      'wealth-over-time series: ~$14,000,000 (2024); MODERN successor holder — candidate Dutchess modern endpoint')
  ) AS t(yr, ttype, itype, grantor, grantee, usd, note)
  WHERE NOT EXISTS (
    SELECT 1 FROM land_transfer_events lte
    WHERE lte.property_id = v_prop AND lte.transfer_year = t.yr AND lte.grantee_name = t.grantee
  );

  -- ── modern parcel link → Bard College campus ──
  IF NOT EXISTS (SELECT 1 FROM modern_parcel_links WHERE property_id = v_prop) THEN
    INSERT INTO modern_parcel_links (
      property_id, modern_address, modern_county, modern_state,
      cardinality, trace_method, source_notes, confidence
    ) VALUES (
      v_prop,
      'Bard College campus, Barrytown / Annandale-on-Hudson, NY',
      'Dutchess', 'New York',
      '1_to_1', 'continuous_chain_of_title',
      'Massena packet: 22-link continuous chain 1688-2024; modern holder Bard College (2024, ~$14M).',
      0.85
    );
  END IF;
END $$;
