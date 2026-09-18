# FINDING — the mint gate was silently rejecting real people (Aug 9 2026)

_Found while diagnosing why 640 probate estates had no decedent on the person spine, during the
descent-first build ([[plan-descent-first-lineage]]). User directive: "fix the validator"._

---

## 1 · What was wrong

`src/utils/person-name-validator.js` → `isValidPersonName` is the mint gate: `PersonService.findOrCreateLead`
refuses to create a person whose name fails it. It was rejecting **real names, at scale**, in four
independent ways — each of which looks like prudence and is actually data loss:

| # | Defect | Rejected | Why it happened |
|---|---|---|---|
| 1 | **Initials read as function words** | `A. S. Bacon`, `H. A. Bacon`, `Newton A. Booth`, `D. I. Dawson` | the `NON_NAME_TOKENS` lookup ran BEFORE the "middle initial is allowed" branch, so `A.` normalized to the article `a` and `I.` to the pronoun `i` |
| 2 | **`y` was not a vowel** | `Hannah Byrd`, `John Smyth`, `Michael Flynn`, `Patrick Lynch`, `Jacobus Van Dyck` | the "multi-letter name words need a vowel" test used `[aeiou]` — excluding an entire class of English/Welsh surnames |
| 3 | **Generational suffixes are vowel-less** | `Thomas Bacon Sr.`, `Ephraim Paine Jr` | `sr`/`jr` failed the vowel test and rejected the WHOLE name — and those suffixes sit on exactly the patriarchs an inheritance chain runs through |
| 4 | **Honorifics are vowel-less** | `Mrs. Eunice Miller Ashmore`, `Mrs. Hattie C. Darsey`, `Rev. Charles A. Wharton` | same test on `mrs`/`dr`/`rev`; `capt` was additionally hard-listed as junk. **Honorifics are the principal way 19th-century probate records name WOMEN, so the rule's effect was biased** |

A fifth, found in the same pass: **`Wm`** (William) and **`Hy`** (Henry) — the standard period abbreviations,
ubiquitous in probate hands — are vowel-less and were rejected. `Wm. F. King`, `Wm Barber`, `Wm C. Millard`
are real decedents in this corpus.

## 2 · Why this is the expensive direction of failure

The gate exists because a May-2026 audit deleted **3,271** junk rows that were never people. That is a real
cost, and it is **visible**: junk sits in a table until somebody removes it.

A false *reject* is invisible. The row is never created, so there is nothing to audit, nothing to count, and
no way to notice — the corpus simply appears not to contain that person. Under audit rule 5 ("real or
absent"), silently converting *real* into *absent* is the more serious error, and it is the one nobody
catches. Here it was found only because descent needed the decedents and they were missing.

**Same failure class as `fsIdClean()`** ([[reference_familysearch_id_format]]), which required a digit in a
FamilySearch ID and so 400'd `LTVZ-WSF`, discarding 8 real climb seeds. Both validators were written from an
*idea* of what the data looks like instead of from the corpus. **The rule: a validator is a claim about the
corpus and must be tested against it, in both directions.**

## 3 · The fix

- Initials are checked **before** the function-word lookup — a single letter is an initial, never a word.
- `y` is a vowel: `[aeiouy]`.
- New `IGNORABLE_TOKENS` (honorifics + generational suffixes) — they neither reject the string nor count
  toward the "≥1 real name word" requirement, so bare `Capt` still fails while `Capt. John Smith` passes.
  `capt` moved out of `NON_NAME_TOKENS` accordingly.
- New `ABBREVIATED_GIVEN_NAMES` (`wm`, `hy`, `thos`, `jno`, `chas`, `geo`, …) — these COUNT as name words
  and bypass the vowel test, because they *are* the given name.
- The ≤5-token phrase limit now counts **name-bearing** tokens, so titles and suffixes don't push a real
  name over the limit.
- **Tightened at the same time:** relaxing the honorific rule admitted `Mrs Sandiford's four daughters` — a
  will disposing to a CLASS. Group nouns and cardinals (`daughters`, `sons`, `family`, `two`…`ten`,
  `legatees`, `representatives`) are now rejected. A class of heirs names no individual; under rule 5 that
  is absent, not a person.

## 4 · Measured effect (live corpus, 2026-08-09)

| | |
|---|---|
| distinct probate decedent names | 5,927 |
| **newly ACCEPTED by the fix** | **353** |
| **REGRESSIONS** (accepted before, rejected now) | **0** |
| unpromoted decedents on heir-bearing estates | 647 → **636 now pass** (was 556) |

Unblocks roughly **doubling descent yield** once `promote-probate-extractions.mjs --apply` is re-run,
followed by `descend-from-probate.mjs --apply` and the RULE 0.5 embed step.

## 5 · Guard against regression

- **`tests/fixtures/person-names.json`** — ground truth from the live corpus, 54 cases across four lists:
  `must_pass`, `must_reject`, `must_be_suspect`, `must_not_be_suspect`. Per
  [[feedback_no_hardcoded_test_data]] the truth lives in the fixture, never in the validator or a scraper.
- **`tests/unit/test-person-name-validator.js`** — `node tests/unit/test-person-name-validator.js`, exits
  non-zero on any failure. 54/54 passing.
- Note: the repo has **no `npm test` runner** (`package.json` still has the placeholder `exit 1`). This test
  must be run directly, which means it is not yet enforced anywhere. Wiring a runner is open work.

## 6 · Known, deliberate residual false-rejects

Left alone because changing them carries real junk risk for one or two names each — documented so they are
not rediscovered as bugs:
- **Month-word surnames.** `John March` is rejected: `march` is in `NON_NAME_TOKENS` as ledger/date noise.
  `March`, `May`, `June` are genuine surnames; removing them would admit date fragments. Tradeoff accepted.
- **Will-preamble bleed.** `God Amen George Owens`, `God Amen John Vanlighten` — rejected on `god`. These
  are correctly rejected as *fragments*, but they conceal real people (`George Owens`). **This is an
  EXTRACTION defect, not a validator one** — the preamble "In the name of God Amen" is leaking into the
  decedent field. Belongs on the probate-extractor quality pass.
- **`Peter To Bradt`, `Richard Bradfield To`** — same class, `to` bleed.

## See also
[[standard-canonical-person-and-document-gate]] · [[plan-descent-first-lineage]] ·
[[project_biscoe_identity_resolution]] · [[finding-ny-probate-audit-jul01]] ·
[[finding-retrievability-metric-and-doc-tails-aug09]] · [[reference_familysearch_id_format]]
