# FINDING — Amelia Freedmen's Bureau register (the Ancestry-loop's first fruit, 2026-08-09)

The county-saturation loop worked end to end: operator pulled worklist item ⑤ (Freedmen's Bureau, Amelia),
found it's **FamilySearch collection cc=1596147, "Virginia, Freedmen's Bureau Field Office Records"** — the
*Register of Letters Received, Amelia C.H. office (5th Div, 2nd Sub-Dist VA), Jul 1867–Dec 1868*. This office
covered **Amelia, Powhatan, and Cumberland** counties (bonus: three-county de-silo). Named freedpeople + their
FORMER ENSLAVERS + kinship — the exact named-enslaved bridge data the 897 nameless 1860-schedule tallies lack.

## Named people + edges read from the first 23 pages (to be ingested/verified against images)
- **Daniel Shepherd** (freedman) — sons **John Shepherd** & **Andrew Shepherd** sold to **George Pannon (Orange
  Co)** then to **James Fisher (Powhatan)**; seeking his children. [family separation by sale — core reparations]
- **Harriet Walthall** (aged freedwoman, on Robert G. Bacon's plantation, Mitchell Co GA) — sister **Sally
  Miller**; four children in Petersburg: **Mary Fields, Sally Fields, Wm Robison, Tom Robison**.
- **Fanny Greene** (dec.) — children **Miles (14), Robert (9), Lucy (girl, 6)**; son **Junius Sidney** (Petersburg);
  kin in Amelia; children placed with **Richd D. Carter** / **Lavinia Williams**; witness **Mary Burton**.
- **Benj Lewis** (freedman) — **Late Private Co "D", 5th US Colored Troops**, resides Amelia Co. [USCT vet]
- **Lizzie Jackson** (~13) — held by **Dr. Frank Jeter (Amelia)**; father **Andrew Jackson**; mother enslaved by
  Jeter family, died when Lizzie was ~1; raised by Mrs. Hurt (Culpeper). [apprenticeship/custody dispute]
- **George Parker** (freedman) — wife **Lucy Howell** (dec., free); 5 children; estate on Fine Creek Powhatan,
  managed by Jos. Campbell, rented to Shepard Bentley; proceeds withheld. Guardian E.C. Mosely.
- **Armstead Lee** (freedman) — children with Mrs. Martha M. Robertson (Amelia).
- **Pleasant Parker** (freedman, Subletts Tavern Powhatan) — wife beaten by **Joseph Perdue (white)**, miscarried.
- **Washington Baker** (freedman) — judgment vs Joseph Ganse (Amelia). **Scott Egleston** (Amelia) — wrongful
  imprisonment. **Pop Goode & wife Milly** (Powhatan, aged/indigent). **John Lewis** (Powhatan) — political
  persecution. Road-duty racial discrimination cases (Cumberland Co, overseer Wade, Constable Huddleston).

## Systematic pull (the platform's job — NOT yet built)
FS ARKs supplied (collection 1596147, groupId 1596147): S3HY-6X37-7S6, S3HY-6X37-Q6N, S3HY-6X37-3MW + "a shit
ton more" in the group. PLAN: a FS-image-group walker (reuse the FS Chrome lifecycle :9222) → for each image:
archive to S3 (RULE 0.6/8) → OCR via the vision-router (cursive-strong Qwen-VL) → structured-extract via the
source-type registry (freedmens/generic handler → freedperson + former-enslaver + kin) → gate/match to the
Amelia 447 + create enslaved_owner + family edges. **BLOCKER: needs the FS Chrome session LOGGED IN on the Mini
(VNC login — the one step only the operator can do; it was SESSION_EXPIRED at last check).**
