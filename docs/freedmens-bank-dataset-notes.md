# Freedman's Bank Dataset Notes

This document compiles critical information regarding the Freedman's Bank dataset, derived from FamilySearch International transcriptions and internal analysis. It serves as an authoritative source for data quality flags, known gaps, branch-specific quirks, and methodological considerations for enrichment and analysis.

---

## 1. Record Counts & Disambiguation

- **Total entries in FamilySearch data table:** 480,597
  - This count includes both primary account holders and associated records (friends and family of account holders named within a depositor's entry).
- **Project's `unconfirmed_persons` (Freedman's Bank `extraction_method`):** 416,136
  - This count likely represents primary account holders. The discrepancy (480,597 vs. 416,136) indicates that our current `unconfirmed_persons` table does not fully capture all named individuals from the FamilySearch dataset. This affects the interpretation of enrichment coverage numbers, as a "fully enriched" primary depositor set would still leave associated individuals un-enriched.

---

## 2. FamilySearch Data Label Errors (Critical for Queries/Scripts)

The following errors have been identified in the FamilySearch data table, which can impact data retrieval and analysis:

- **Lexington, KY erroneously labeled as "Louisville, KY":** In the raw FamilySearch data table, records for Lexington, Kentucky, are incorrectly assigned to Louisville, Kentucky.
  - **Impact:** Any queries or scripts targeting "Lexington" by branch name may miss these records, and queries for "Louisville" may inadvertently include Lexington records. This requires careful handling when filtering or grouping by branch location.
- **Shreveport and New Orleans records erroneously assigned:** Records for Shreveport and New Orleans are incorrectly assigned in the FamilySearch data table.
  - **Note:** The FamilySearch website UI correctly displays these records. This suggests that web scraping (e.g., `scripts/scrape-freedmens-bank-indexed.js`) would likely capture the correct location, but any direct import from the raw CSV data table would mislabel them.

---

## 3. Valid Date Sequences (Per Branch/Roll)

The following table provides the exact first/last account numbers, dates, roll numbers, and block numbers for each contiguous sequence of records within the Freedman's Bank collection. This information is crucial for validating enrichment ranges, understanding data continuity, and targeting specific record blocks.

| City | Seq | Roll | Block | First Acct | Last Acct | First Date | Last Date |
|---|---|---|---|---|---|---|---|
| Atlanta | 1 | 6 | 1 | 1 | 4517 | 15 Jan 1870 | 02 Jul 1874 |
| Augusta | 1 | 7 | 1 | 2167 | 6701 | 23 Nov 1870 | 29 Jun 1874 |
| Baltimore | 1 | 13 | 1 | 1 | 4 | 03 May 1866 | 03 May 1866 |
| Baltimore | 2 | 13 | 2 | 220 | 1484 | 15 Nov 1866 | 29 Sep 1868 |
| Baltimore | 3 | 13 | 3 | 1573 | 6768 | 24 Nov 1868 | 23 Jun 1874 |
| Beaufort | 1 | 20 | 1 | 2732 | 4707 | 20 Jun 1868 | 29 Jan 1872 |
| Beaufort | 2 | 20 | 2 | 5063 | 5988 | 14 Jan 1873 | 01 Jul 1874 |
| Charleston | 1 | 21 | 1 | 1 | 319 | 19 Dec 1865 | 17 Oct 1866 |
| Charleston | 2 | 21 | 2 | 2151 | 3824 | 07 Sep 1868 | 02 Dec 1869 |
| Charleston | 3 | 22 | 1 | 3833 | 6626 | 04 Dec 1869 | 25 Feb 1871 |
| Charleston | 4 | 23 | 1 | 6627 | 11103 | 25 Feb 1871 | 02 Jul 1872 |
| Columbus | 1 | 14 | 1 | 21 | 927 | 18 Aug 1870 | 16 Jun 1874 |
| Huntsville | 1 | 1 | 1 | 1 | 1698 | 16 Dec 1865 | 2 Jul 1874 |
| Lexington | 1 | 11 | 1 | 217 | 1976 | 21 Nov 1870 | 11 Apr 1874 |
| Little Rock | 1 | 3 | 1 | 153 | 1359 | 27 Feb 1871 | 15 Jul 1874 |
| Louisville | 1 | 11 | 1 | 1 | 1928 | 15 Sep 1865 | 28 Jan 1868 |
| Louisville | 2 | 11 | 2 | 5122 | 7333 | 01 May 1872 | 26 Jun 1874 |
| Lynchburg | 1 | 26 | 1 | 153 | 215 | 08 Jul 1871 | 22 Aug 1871 |
| Memphis | 1 | 24 | 1 | 1 | 1995 | 28 Dec 1865 | 01 Jul 1874 |
| Mobile | 1 | 2 | 1 | 777 | 2323 | 18 Jun 1867 | 10 May 1869 |
| Nashville | 1 | 25 | 1 | 4174 | 6189 | 23 Dec 1871 | 15 Jun 1874 |
| Natchez | 1 | 14 | 1 | 1 | 707 | 29 Mar 1870 | 18 Jun 1874 |
| New Bern | 1 | 18 | 1 | 1327 | 4157 | 30 Oct 1869 | 25 Jul 1874 |
| New Orleans | 1 | 12 | 1 | 5 | 1018 | 18 Jun 1866 | 11 Mar 1869 |
| New Orleans | 2 | 12 | 2 | 4365 | 8570 | 17 Jan 1872 | 29 Jun 1874 |
| New York | 1 | 17 | 1 | 1422 | 6942 | 25 Oct 1870 | 29 Jun 1874 |
| Norfolk | 1 | 26 | 1 | 3950 | 5415 | 04 Dec 1871 | 26 Jun 1874 |
| Philadelphia | 1 | 19 | 1 | 1 | 3004 | 06 Jan 1870 | 26 Jun 1874 |
| Richmond | 1 | 26 | 1 | 232 | 1582 | 18 Jul 1867 | 20 Jun 1870 |
| Richmond | 2 | 27 | 1 | 1591 | 3948 | 21 Jun 1870 | 20 Nov 1871 |
| Richmond | 3 | 27 | 2 | 4005 | 7691 | 11 Dec 1871 | 29 Jun 1874 |
| Savannah | 1 | 8 | 1 | 1 | 1137 | 10 Jan 1866 | 05 Aug 1868 |
| Savannah | 2 | 8 | 2 | 1298 | 4947 | 16 Nov 1868 | 17 Dec 1870 |
| Savannah | 3 | 9 | 1 | 4948 | 9868 | 17 Dec 1870 | 22 Oct 1872 |
| Savannah | 4 | 10 | 1 | 9869 | 14558 | 22 Oct 1872 | 01 Sep 1874 |
| Shreveport | 1 | 12 | 1 | 149 | 1320 | 11 Feb 1871 | 29 Jun 1874 |
| St. Louis | 1 | 16 | 1 | 223 | 366 | 06 Apr 1869 | 08 Oct 1869 |
| Tallahassee | 1 | 5 | 1 | 1 | 887 | 25 Aug 1866 | 15 Jan 1872 |
| Vicksburg | 1 | 15 | 1 | 1157 | 8662 | 16 Jul 1868 | 29 Jun 1874 |
| Washington | 1 | 4 | 1 | 5 | 1553 | 28 Aug 1865 | 10 Apr 1868 |
| Washington | 2 | 4 | 2 | 3500 | 7197 | 25 Jan 1870 | 29 Apr 1871 |
| Washington | 3 | 4 | 3 | 7406 | 9316 | 23 May 1871 | 30 Dec 1871 |
| Washington | 4 | 5 | 1 | 3 | 456 | 28 May 1872 | 17 Jun 1874 |
| Washington | 5 | 5 | 2 | 14631 | 16303 | 31 Dec 1872 | 23 Aug 1873 |
| Washington | 6 | 5 | 3 | 20001 | 21397 | 25 Aug 1873 | 01 Jul 1874 |
| Wilmington | 1 | 18 | 1 | 1208 | 1343 | 03 Sep 1869 | 30 Oct 1869 |
| Wilmington | 2 | 18 | 2 | 5406 | 7266 | 12 Dec 1872 | 26 Aug 1873 |

---

## 4. Known Record Gaps

The following gaps in the physical records must be accounted for when analyzing contiguous blocks of data.

- **Charleston:** Minor record gap from account #3824 to 3833 (9 records) over 1 to 3 missing days (12/2/1869 to 12/4/1869), microfilm image_nbr 695 to 705.
- **Richmond:** Minor record gap from account #1582 to 1591 (9 records) over 1 to 2 missing days (6/20/1971 to 6/21/1971), microfilm image_nbr 457 to 468.
- **Richmond:** More significant gap of 21 to 23 days in record #3948 to 4005 (57 accounts) from 11/20/1871 to 12/11/1871, microfilm image_nbr 788 to 790.
- **Washington D.C.:** A more substantial gap of 24 days and 209 records exists from 29 Apr 1871 to 23 May 1871.
- **Washington D.C. (Apparent Gap):** The National Archive declares a gap in records for Washington D.C. in film roll 5 (digital_gs_number 4098148) from image_nbr 292 to 294. A renumbering takes place involving a change in new account numbers from 16303 to 20001, but this does not represent an actual gap in the records, which are contiguous.

---

## 5. Branch-Specific Quirks & Data Quality Flags

- **Raleigh:** Contains only a single page of very unreliable records and is largely unusable for analytical research. Enrichment on these records should be flagged or skipped.
- **Philadelphia:** Records represent only a small number of new accounts held exclusively by organizations, not individuals. These may be from a parallel ledger. Enrichment on these records is not meaningful for individual depositor research.
- **Charleston (Housekeeping Section):** A lengthy middle section between image #139 and image #189 is devoted to miscellaneous housekeeping (transfers to/from other branches/banks). It contains no valid dates and should be excluded from date-based analysis or enrichment.
- **Tallahassee (Discontinuous Numbering):** Accounts have a discontinuous numbering scheme. On July 18, 1871, Film Group 4098148 image nbr 669, accounts renumber from 1380 to 688 and then end the book in 887. This is a valid sequence but requires careful handling.
- **Memphis (False Discontinuity):** While Memphis declares three separate scan targets in Roll 24, they are actually fully contiguous and contain records 1996-1999, which were stated to be discontinuous by the archive sheet.

---

## 6. Odd Lot Record Sets

These record sets are loosely ordered or duplicates and require special consideration during processing.

- **Savannah (Roll 10):** 4098339_00619 through 4098339_00787 is a second target for film roll 10. This is a loosely ordered set of odd lot duplicate records, very sparse, and appear to all be duplicates of accounts recorded in other sequential logbooks.
- **Washington D.C. (Roll 5):** 4098148_00009 through 4098148_00067 is the first target for film roll 5. This is a loosely ordered set of odd lot records with very few gaps.

---

## 7. Washington D.C. Supplemental Account Book

- **Film Roll 5, digital_gs_number 4098147, image_nbr 12 to 231:** This appears to be an unusual supplemental account book to the Washington D.C. branch. Accounts here are valid, but the date span (12/31/1872 - 7/1/1874) does not represent a contiguous set of new accounts. The full set of dates should not be taken as a valid sequence unless they overlap with other existing records. Washington D.C. has a total of 6 valid sequences, not a single continuous block.

---

## 8. The Freedman's Bank CSV Dataset

- **Existence:** The documentation states: "The data was supplied in the form of a single, comprehensive data table in .csv format." This dataset was obtained via a research agreement with FamilySearch International.
- **Potential Impact:** If this CSV can be obtained, it would significantly streamline the enrichment process for indexed fields (name, date, occupation, birthplace, employer, kin data). The current DocAI web-scraping approach for these fields would become redundant, and the URL bug (1:1: vs 3:1: ARK) would only be relevant for extracting `last_master`/`last_mistress` from the handwritten ledger images.

---

## 9. Freedom Status & Data Integrity (CRITICAL)

The interpretation of "free" status from Freedman's Bank records requires careful historical and technical understanding.

- **Historical Context:** The Freedman's Bank (chartered 1865, closed 1874) was a **post-emancipation institution**. Every single depositor was legally free at the time they opened their account. The `last_master`/`last_mistress` field is a **historical record** indicating who the depositor was enslaved by *before* emancipation, not their current status.
  - `person_type = 'freedperson'` applies to ALL Freedman's Bank depositors.
  - The presence of a valid `last_master` or `last_mistress` value (after correct extraction) indicates the depositor was `formerly_enslaved`. This is a critical field for reparations calculations.
  - The absence of `last_master`/`last_mistress` (after correct extraction) indicates an "always-free Black" individual, or that the field was left blank in the original ledger.

- **Current Data Integrity Issue:**
  - **URL Bug:** The `scripts/enrich-freedmens-docai.js` script currently navigates to `1:1:` index pages (FamilySearch-structured data) instead of `3:1:` film image pages (handwritten ledger images).
  - **Consequence:** DocAI has never seen the actual handwritten `last_master`/`last_mistress` fields. As a result, `last_master` and `last_mistress` are currently `NULL` for 100% of the 7,745 "enriched" records.
  - **Implication:** We cannot currently differentiate between "this person was always free" and "this person's enslaver name is in the handwritten ledger we never photographed."
  - **`CRITICAL_FIELDS` Trap:** The `enrich-freedmens-docai.js` script queues records for human review if `last_master`, `last_mistress`, `old_title`, and `plantation` are all empty. Due to the URL bug, this queue is currently polluted with records that *should* have these fields, making it unreliable for identifying genuinely "always free" individuals.
  - **Conclusion:** Any downstream system (DAA calculator, person profiles, reparations breakdown) that uses `last_master IS NULL` as a proxy for "this person was always free" is currently operating on **broken data**. This classification is unreliable until the URL bug is fixed and all records are reprocessed against the `3:1:` film images.
