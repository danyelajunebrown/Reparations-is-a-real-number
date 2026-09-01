# reference-data — authoritative external denominators

These lists exist because a coverage metric anchored to our own output cannot measure coverage.

`check-ingest-progress.mjs` reported the 1860 slave-schedule corpus **100% COMPLETE** while 100 counties
were missing, because it compared scraped locations against *enumerated* locations — a denominator produced
by the same crawl being measured. It could only ever confirm itself.

The FamilySearch waypoint API returns **at most 100 child waypoints** per parent and honours no paging
parameter (`count`, `pageSize`, `start` all tested; byte-identical responses). Every state with more than
100 counties was therefore truncated alphabetically at 100:

| state | FS lists | we held | missing | first missing |
|---|---|---|---|---|
| Virginia | 147 | 100 | 47 | Petersburg |
| Georgia | 132 | 100 | 32 | Randolph |
| Missouri | 113 | 100 | 13 | St Francois |
| Kentucky | 108 | 100 | 8 | Trimble |

Operator-supplied from the FamilySearch browse UI, which lists all of them even though the API will not.
Use these to SEED enumeration, and to check coverage against something we did not generate.
