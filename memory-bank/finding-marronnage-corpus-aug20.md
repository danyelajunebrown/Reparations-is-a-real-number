# Finding — Le marronnage dans le monde atlantique: the enslaver testifying against himself

_Measured 2026-08-20, O-of-O steps 1–3 complete. NO PEOPLE WRITTEN YET._
Related: [[standard-assertion-store-and-inference-decisions]] · [[standard-targeted-harvesting]] ·
[[interpretive-framework]] · [[finding-fabrication-classes-aug19-20]]

## What it is

**22,485 marronnage (self-liberation) notices, 1765–1833**, from 21 newspapers across 7 colonies.
Directed by **Myriam Cottias (EHESS/CNRS)** and **Laurent Dubois (Duke)**; v2.0 launched 2019 at the
*Enslaved: People of the Historical Slave Trade* conference — an **Enslaved.org sibling**, so their Q-IDs
are a likely dedup path into a corpus we already hold.

| colony | ads |
|---|---|
| Saint-Domingue | 17,308 |
| Caroline du Sud | 1,785 |
| Jamaïque | 1,784 |
| Louisiane | 993 |
| Guadeloupe | 451 |
| Bas-Canada | 87 |
| Guyane française | 77 |

Saint-Domingue stops after the 1790s — the revolution ended the newspaper that carried the ads. Louisiana
and South Carolina land directly in our existing US corpus; the rest is the global dimension.

## Why this source is unlike anything else we hold

A probate inventory records a person **as property at a moment of transfer**. A runaway ad records a person
**refusing that** — and because the enslaver wanted them caught, it describes them in detail no inventory
ever does:

> *Un Negre nouveau, nation Congo, **étampé Ch**, est maron depuis trois semaines.* (id=117)

African origin (Congo), recency of arrival (*nouveau* = bossale, not creole), a **brand burned into the
skin reading "Ch"** — the enslaver's own initials — and the duration of self-liberation. The mark of
ownership **is** the mark of harm, in the same three letters. The Quebec ad for Drummond adds *"walks
heavily"*, a disability recorded only because it made him identifiable.

**This is the enslaver testifying against himself**, which is the strongest evidence class we have.

## Exact corpus-wide counts (the source's own keyword index — counted, not sampled)

| evidence | ads | destination |
|---|---|---|
| **`étampé` — BRANDED** | **9,915 (44%)** | `harm_events` + the brand text is an ownership mark |
| `marqué au fer` | 1,988 | `harm_events` |
| `cicatrice` — scars | 778 | `harm_events` |
| `geôle` — jailed | 721 | `harm_events` |
| `fouet` — whip | 113 | `harm_events` |
| `fers` — irons | 32 | `harm_events` |
| **`nation` — African ethnonym** | **2,975** | `person_facts` — origin, a field almost nothing else we hold carries |
| `récompense` — reward | 4,367 | priced → ledgerable |

## The two measurements that decide the ingest design

1. **The curated `noms` index is usable.** It indexes *the enslaved person's name* ("incluant une ou un
   esclave nommé X"), separately from the transcription. Probed 12/12 francophone **and** anglophone
   (`Sambo` 11, `Quashie` 18, `Cuffee` 24, `March` 8). So named people can be ingested **deterministically
   off a curated index** rather than parsed out of free text — which is exactly where fabricated people
   come from. The `Drummond`=0 miss is one gap, not an anglophone exclusion.
2. **67% of ads carry a scan**, under `/documents/…/YYYYMMDD_R_noNN_pPPP_N.jpg` — a path that itself encodes
   issue number and page for the citation. Rule 8 (S3 + Wayback) is therefore feasible on the real
   newspaper page, not just the transcription.

## Methodological correction worth keeping

My 110-ad stratified sample said **branded = 1%**. The true figure is **44%**. Cause: the frame capped ~6 ads
per colony×decade cell, so **Bas-Canada (87 ads = 0.4% of corpus) took 24% of sample slots** while
**Saint-Domingue (77% of corpus) took 22%**. Equalising cells gives *spread*, not *representativeness*, and
harm concentrates in the colony I under-weighted.

> **Rule: when the source exposes exact counts, COUNT. Sample only what cannot be counted.**

Same family as the DLAS first pass (84% legislative against an 83%-county-court corpus). A frame report
catches this; a bare census does not. Both scripts now print the frame achieved.

## Access posture (§6)

`robots.txt` is the **stock Mandriva Apache default from 2007** — no AI clause, no crawl-delay, nothing
covering `/fr/` or `document.php`. It *does* `Disallow: /images/`, which we honour; the scans live under
`/documents/`, so nothing we need is disallowed. Pace ~1.2 req/sec with a contactable UA: small scholarly
server, public money.

**Endpoint contract** (cost two failed requests — recorded so nobody repeats it):
`POST /fr/resultats.php` — the form's `url: "resultats.php"` is *relative to* `/fr/recherche.php`; posting
to the site root 404s. Payload is exactly `$('#frminterroger').serializeArray()`, so the submit button is
**not** sent, and `minyear`/`maxyear` are readonly slider-populated fields — **sending them empty 500s the
server**. Bounds: `MinYear=1765`, `MaxYear=1833`. Facets: `location` (7 colony names), `newspaper` (1–22),
`noms`, `motscles`, `page`.

## Open decisions before ingest (do NOT default these)

* **Person type.** A person in a runaway ad is enslaved *and* self-liberating. Do not silently write
  `person_type='enslaved'` and lose the second fact — per §4, no ingest assigns a type by provenance.
* **The brand text is an identifier.** `étampé Ch` links the person to an enslaver by initials. That is a
  **lead**, not a match — Biscoe rule. It goes to `linkage_verdicts='uncertain'`, never an auto-merge.
* **One ad ≠ one person.** Repeat flights mean the same person is advertised more than once; ~5% of ads
  reference a prior flight. Dedup on the curated `noms` + colony + enslaver, and preserve ambiguity.
* **Free-text names (the 46% the `noms` index misses)** must not be regex-parsed into person rows. That is
  the tally-mark failure in a new costume.
