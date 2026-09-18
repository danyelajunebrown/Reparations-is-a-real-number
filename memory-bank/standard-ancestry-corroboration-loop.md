# STANDARD — Ancestry corroboration loop (bot drives, human actuates)

_User directive 2026-08-09: use Ancestry Library Edition as a FAST finding-aid, "and I can initiate the pull."
The bot NEVER accesses Ancestry (automated access breaches Ancestry ToS + the ProQuest/ALE institutional
license, and risks the operator's card + DCPL's whole subscription). Division of labour that stays clean:_

```
BOT: seed a worklist + generate each ancestrylibrary.com search + the FREE-source crosswalk
BOT: ntfy the operator the next items (at their pace)          ← the human's approval/actuation point
YOU: run the search in YOUR browser (patron right) → export the results (like a printed PDF)
BOT: --ingest the export → crosswalk to the FREE primary source (LVA / FamilySearch / NARA) → corroborate /
     match vs our canonicals → queue the free-source pull. Facts + pointers only; no Ancestry content stored.
```

## Implementation
- `scripts/ancestry-corroborate.mjs` (migration 133: `ancestry_corroboration_queue` + `source_redirect_leads`).
- `src/services/ancestry/collection-crosswalk.js` — Ancestry collection → FREE source.
- Modes: `--seed [--county <C>]` · `--notify-next [--n K]` · `--ingest <pdf> [--person ID]` · `--status`.
- **Ntfy cron** (Mini, `0 13 * * *` = 9am ET): notifies 3 items/day so the worklist feeds the operator at pace.

## County-saturation strategy (the winning move)
Don't chase scattered individuals — saturate ONE county's record web. `--seed --county <C>` seeds every
enslaver we hold in that county PLUS the bridge record-SETS that name the enslaved: **1866 Cohabitation
Register** (THE bridge — enslaved couples + their former enslaver), 1850/1860 Slave Schedules, Will Books /
estate inventories, Freedmen's Bureau, 1870 census. Each → its FREE source.

## LIVE: Amelia County VA (first target, 2026-08-09)
We hold **447 canonical enslavers in Amelia Co VA and 0 enslaved** — the exact gap. Seeded: 447 enslavers +
6 record-sets. The 1866 Cohabitation Register is the #1 pull (pairs the 447 owners with named enslaved people
+ descendants). NEXT build (when the first export lands): wire `--ingest` of the cohabitation-register export
to auto-create the enslaved leads + `enslaved_owner` edges matched to the 447, and the 1870→descendant chain.
