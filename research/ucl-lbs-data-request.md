# UCL LBS — data-request (the "completeness" half of the Wayback + request plan)

_Why: the live site is behind a Cloudflare Turnstile that refuses automated access and grants no reusable
clearance (verified 2026-07-04; FlareSolverr confirmed unable to clear Turnstile/managed challenges). The
Wayback path gives us ~22,190 archived records autonomously, but the AUTHORITATIVE + COMPLETE route is to
request the deposited dataset directly. It is CC BY-NC-SA 4.0 and formally deposited at the UK Data
Service (SN-852209); the LBS team routinely shares extracts with researchers._

## Where to send
- **Primary — LBS / CSLBS team:** via the site contact page (https://www.ucl.ac.uk/lbs/contact/) and/or
  the Centre for the Study of the Legacies of British Slavery, UCL Dept of History. General UCL History
  enquiries can route it if no direct address is listed.
- **Parallel — UK Data Service:** the deposit is SN-852209 (DOI 10.5255/UKDA-SN-852209). Register at
  https://ukdataservice.ac.uk and request access to the collection; note the ReShare page currently
  shows "no files" and points back to UCL, so the UCL request is the more likely to yield the actual
  relational export.

## Draft email

Subject: Data-extract request — Legacies of British Slavery database (non-commercial reparative research)

Dear Centre for the Study of the Legacies of British Slavery,

I am writing on behalf of a non-commercial, reparative-history research project that documents the
financial legacies of transatlantic slavery and links them, with primary-source citations, to the
descendants of both enslaved people and slave-owners. The 1834 Slave Compensation record your team has
assembled — the compensation claims, the named awardees and their roles, the per-estate enslaved counts,
and the biographical/relationship material on the owner class — is directly relevant to our dual-ledger
methodology (compensation paid *to* owners recorded as evidence of debt owed, never as a credit).

We would be very grateful for access to the underlying dataset — ideally the relational export deposited
at the UK Data Service (SN-852209) or any CSV/SQL extract of the Individuals, Claims, Estates, and
Commercial-legacy tables — so that we do not place load on your public website. We fully respect the
CC BY-NC-SA 4.0 licence: our use is strictly non-commercial, we will attribute "Legacies of British
Slavery, UCL" (and the underlying TNA T71 / British Parliamentary Papers sources) on every derived
record, and we will release any transformations under the same licence.

If a direct extract is not possible, could you advise whether a rate-limited API key or a bulk snapshot
is available for accredited researchers? We are happy to sign any data-use agreement you require and to
describe our storage and access controls.

Thank you for building and openly licensing this extraordinary resource.

With appreciation,
[Name]
[Affiliation / project]
db7613@bard.edu

## Notes for the sender
- Attach a one-paragraph project description if you have one; emphasise non-commercial + reparative.
- If they grant a dump, it supersedes the Wayback corpus (100% coverage, authoritative) — ingest it via
  the same stage-2 parser mapping (claims→dual-ledger, persons→spine, relationships→edges).
- Licence compliance is a project constraint already met by our CC BY-NC-SA sourcing posture.
