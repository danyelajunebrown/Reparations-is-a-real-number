# Frontend Smoke Test Checklist

This is a **manual checklist** to be executed after running a full document ingestion.
After uploading and processing a will, navigate to each affected person profile and verify the following.

## Setup Instructions

1. Navigate to the web application (ensure you're on the live/production environment, not a local dev server with test data)
2. Use the search functionality to find each person listed below
3. For each person, verify all listed items in their profile

---

## Ann Maria Biscoe (canonical_persons id=141015)

After ingesting George W. Biscoe (1859) will, verify:

- [ ] Profile shows George W. Biscoe as **spouse** (relationship edge visible in relationships section)
- [ ] Profile shows enslaved persons **Mary** and **Caroline** in document section
- [ ] Profile shows **"Caroline's children"** as an anonymous group entry, **not missing**
- [ ] Profile shows trust instrument — **Emma Biscoe** listed as beneficial owner, **Ann Maria Biscoe** listed as trustee
- [ ] Profile does **NOT** show Ann Maria Biscoe as outright owner of Mary/Caroline (correctly shows trust relationship)

**What to look for:**
- In the "Relationships" section, there should be a spouse edge between Ann Maria Biscoe and George W. Biscoe
- In the "Documents" section, there should be a will entry for George W. Biscoe (1859)
- When viewing that will entry, it should list enslaved persons: Mary, Caroline, and "Caroline's children" (anonymous group)
- The trust instrument should be clearly structured with Ann Maria as trustee and Emma as beneficial owner

---

## Henry Weaver Profile

After ingesting Henry Weaver (1884) will, verify:

- [ ] Profile shows **$12,250.34** in **acknowledged debts section**, NOT in estate wealth
- [ ] Profile shows **Mary Ann Weaver** as spouse
- [ ] Profile shows **cross-will accounting link** to Mary Ann Weaver will
- [ ] **Angeline Drinkhouse** appears as legatee
- [ ] **Theodore Barnes** appears as legatee with relationship_candidate flag (surname collision detected)

**What to look for:**
- In the "Estate Valuation" or "Financials" section, there should be an acknowledged debts subsection
- The acknowledged debts should show exactly $12,250.34, attributed to "Mary Ann Weaver (self — funds held by husband)"
- There should be NO estate wealth valuation that includes this amount
- Cross-will accounting should be visible, showing a link or reference to Mary Ann Weaver (1883)
- Angeline Drinkhouse should be listed as a beneficiary/legatee
- Theodore Barnes should be listed as a beneficiary/legatee with some indication of relationship ambiguity (e.g., "relationship_candidate" flag or surname match note)

---

## Mary Ann Weaver Profile

After ingesting Mary Ann Weaver (1883) will, verify:

- [ ] **Drover's Rest** and **Harlem Farm** appear in **named_properties section** with **graveyard flag** set
- [ ] **Codicil bequest** to **Mary Ann E. Hall** appears tagged with **source_document: "codicil"**
- [ ] **Rev. Edward J. Drinkhouse** appears as executor with **relationship_candidate flag** (executor surname matches beneficiary surname)
- [ ] **$3,916.78** to **Angeline Drinkhouse** shows **bequest_fund_source breakdown**
- [ ] Total bequests reconcile to **$12,250.34** (cross-will accounting display)

**What to look for:**
- In the "Properties" or "Real Estate" section, both Drover's Rest and Harlem Farm should be listed
- Each property should have a graveyard_present flag set to true
- Drover's Rest should show sale_status as "installment_sale_pending"
- Harlem Farm should show sale_status as "unknown"
- In the "Bequests" or "Legacies" section, there should be a codicil subsection
- The codicil bequest to Mary Ann E. Hall should be clearly marked as coming from the codicil (e.g., "Source: Codicil (1891-05-20)")
- Rev. Edward J. Drinkhouse should be listed as executor
- There should be some indication that the executor is also a family member (relationship_candidate flag or similar)
- Angeline Drinkhouse's bequest of $3,916.78 should show the fund source breakdown (e.g., "Source: Mixed dower and inherited money")
- The total of all bequests should sum to approximately $12,250.34 (accounting reconciliation)

---

## General UI/UX Checks

For all profiles, verify:

- [ ] Page loads without console errors (check browser DevTools for any red errors or failed resource loads)
- [ ] No "loading" spinner or progress indicator gets stuck (should complete within reasonable time)
- [ ] After successful ingestion, a confirmation message is displayed
- [ ] The "Submit another document" button appears on success screen and works
- [ ] Navigation to person profiles works correctly from the success screen
- [ ] Back button ("← Back to search") works from success screen
- [ ] All monetary amounts display with proper formatting (2 decimal places, dollar sign)
- [ ] All dates display in human-readable format (not raw ISO strings)
- [ ] Relationship edges render correctly with proper icons/labels
- [ ] No duplicate or redundant information is displayed
- [ ] Tooltips or help text are available for technical terms (e.g., "acknowledged debt", "trust instrument", "cross-will accounting")

---

## Document-Specific Checks

### Trust Instrument Display

- [ ] When viewing a trust instrument, both the trustee and beneficial owner are clearly labeled
- [ ] The legal protection language is displayed (e.g., "sole and separate use")
- [ ] The asset references (enslaved persons, properties) are listed under the trust

### Cross-Will Accounting Display

- [ ] The accounting reconciliation is clearly explained in the UI
- [ ] The delta (98 cents) is shown or explained
- [ ] Both wills are linked to each other bidirectionally (each profile shows link to the other's will)

### Anonymous Groups

- [ ] Null-name entries (like "Caroline's children") display with a clear visual indicator that this is an anonymous group
- [ ] The group description is preserved and displayed correctly
- [ ] No placeholder or "unknown" text appears for named groups

### Prior Transfers

- [ ] Angelica Chew's advancement appears in a "prior transfers" or "advancements" section, NOT as an enslaved person
- [ ] The note about equalizing shares is displayed

---

## Bug Detection Red Flags

If you observe any of the following, **STOP and document as a bug**:

❌ **CRITICAL BUGS (prevent any further ingestion until fixed):**
- Prior transfer reference appears as an enslaved person entry
- Acknowledged debt ($12,250.34) appears as part of estate wealth (gross valuation)
- Trust instrument has trustee === beneficiary (collapsed into single person)
- Enslaved person entries are missing from profile
- Cross-will accounting shows wrong reconciliation
- Null-name entries (anonymous groups) are dropped completely

⚠ **WARNINGS (document but continue):**
- Trust instrument legal protection language is missing
- Bequest fund sources are not specified
- Named properties lack graveyard flags
- Relationship candidate flags are missing for surname collisions
- Formatting inconsistencies between dates or monetary amounts

---

## Test Execution Checklist

Before starting the smoke test:

- [ ] All will test suites (Layers 0-4) pass with 0 failures
- [ ] Database is clean from previous test data (run tests/integration/test-fanout-writes.js cleanup if needed)
- [ ] Browser DevTools Console is open (to catch any runtime errors)
- [ ] You have the canonical person IDs for Ann Maria Biscoe (141015), Henry Weaver, and Mary Ann Weaver ready for lookup
- [ ] Screenshot capability is ready (optional but helpful for documentation)

After completing the smoke test:

- [ ] All checkboxes above have been completed
- [ ] Screenshot(s) captured for each profile (optional)
- [ ] Any bugs or unexpected behaviors have been documented in GitHub issue
- [ ] Test report filed (summary of what passed, what failed, and what needs fixing)

---

## Notes for Testers

- This checklist is designed to be thorough but not exhaustive. Add additional checks if you discover issues.
- Focus on **data correctness** over UI prettiness. A pretty UI with wrong data is worse than an ugly UI with correct data.
- When documenting bugs, include:
  - Which person profile exhibits the issue
  - What the incorrect behavior is
  - What the correct behavior should be
  - Screenshots or examples if possible
  - Steps to reproduce (if applicable)
- Update this checklist after each major test session to reflect new learnings or discovered edge cases.