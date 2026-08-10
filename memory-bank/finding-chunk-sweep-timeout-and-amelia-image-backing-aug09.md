# Finding — the chunk sweep's timeout was the bug, and Amelia's harms are now image-backed (2026-08-09, later session)

Related: [[finding-retrievability-metric-and-doc-tails-aug09]] · [[finding-name-validator-false-rejects-aug09]] ·
[[standard-canonical-person-and-document-gate]] · [[activeContext]]

## 1. The chunk sweep did not "hang" — a 30s ceiling was mislabelling a queue as a failure

`embed-doc-chunks.mjs --unchunked` died at **1,725 / 21,817 docs** and was found stopped, with the log
ending in `The operation was aborted due to timeout`.

**Measured, not assumed:** with the sweep stopped, one embed round-trips in **0.213s**. With the sweep
running at `--conc 6`, one embed took **39.6s** — and CPU was ~10%, so nothing was compute-bound. Ollama
does not serve embeds concurrently; it **queues** them. The script's hardcoded `AbortSignal.timeout(30000)`
therefore did not protect against a hung server, it **guaranteed failures** the moment the queue got deep.

Same shape as the name-validator defect: a guard written from an *idea* of the failure ("the server might
hang") rather than from the system's actual behavior ("the server queues, and a queued request is healthy").

**Fixed:** `--timeout` (default **180000**) + `--retries` (default 2, backoff). Restarted at `--conc 3`:
**0 errors, ~70 docs/min**, versus a run that previously collapsed into timeouts.

## 2. The worse bug underneath: partial docs were silently permanent

The `--unchunked` selector asks *"does this doc have ANY `chunk_index > 0` row?"* So a doc that embedded 7
of 8 passages **looked complete forever**, while the 8th passage — which on a probate page is as likely as
any to hold the heirs, the named enslaved, or the valuations — was simply absent from RAG. Nothing
surfaced it; the doc had left the work pool.

**Fixed:** any doc with a failed chunk now has its partial chunk set **DELETED** and returns to the sweep
pool (`chunk()` is deterministic, so redoing it is free), and `rolled back` is printed and summarized.
Better to redo a document than to silently under-index it.

**Measured blast radius of what already happened: only 4 documents** had gapped chunk sequences
(`count(*) <> max(chunk_index)`); their 10 rows were deleted so they re-sweep. Small — but it was invisible,
and invisibility, not size, is the problem. **A silent partial is worse than a loud failure.**

## 3. Amelia Freedmen's Bureau — 10 harms went from citation to evidence

`ingest-amelia-freedmens-letters.mjs` had written 10 real `harm_events` with `source_document_id = NULL`
and only a citation *string*. **A citation a reader cannot open is an assertion, not evidence.**

New `scripts/archive-amelia-freedmens-images.mjs` (file-first, dry-run default):
- **23 scans → S3** (`sources/freedmens-bureau/va/amelia/letters-received/`), sha256'd, 28.9MB,
  **23/23 with Wayback snapshots**, `source_artifacts` + `person_documents` rows carrying the FS ARK.
- Ran **from the MacBook** — AWS creds are local, so the Mini was never needed for this (the prior session
  was routing it through the Mini and got stuck there).
- **Page numbers were hand-read from the scans by the model, one at a time**, because the filenames are FS
  image-ARK suffixes and carry **no page ordering**. Recorded as the two-page OPENING (`'123-124'`), since
  a harm on the right-hand page must not be cited to the left-hand number.
- Linkage is **deterministic containment** (a scan covers N and N+1; a harm citing P belongs to it iff
  P ∈ {N, N+1}) — never a name or content guess. **10/10 harm_events now carry `source_document_id`.**

**A misread caught by cross-checking, worth keeping:** `ZHZ` was first recorded as pages 155-156. It is
actually **the same opening as `ZZ8` (135-136)**, shot twice — once with the tipped-in Campbell letter laid
flat over the register column, once lifted. Period 3s and 5s are near-identical in this hand; the content,
not the numeral, settled it.

## 4. Two open gaps, stated rather than papered over

- **The 23 scans have `ocr_text = NULL`, so they are NOT RAG-retrievable** (`AMELIA_DOC_EMBEDS = 0`). The
  harm *narratives* are embedded (`harm_narrative`, 10/10), so the tea is retrievable — but the images are
  a silo by RULE 0.5. These are 1867-68 cursive; machine OCR will be poor. The honest fix is to store the
  **hand transcription** as `ocr_text` with `ocr_model='claude-hand-read'`, not to pretend an OCR pass ran.
- **The scans hold cases the ingest never captured.** Pages read but *not* among the 10 harm_events include
  p.11 "Georgianna" (child retained by Robert Thrift) · p.25 Frank Patterson v. John Bowles/Louisa Martin ·
  p.119 Pop Goode & wife Milly, and a 90-year-old freedman left unsupported · p.147 Martha Robertson's two
  bound children · p.163 Benj Lewis (USCT). **The corpus on disk is richer than what was extracted.**

## 5. Mac Mini SSH is broken — and it is NOT the FamilySearch captcha

Distinct failures, easy to conflate: the operator cleared a **FamilySearch bot-detection captcha** (that
restores the *scraping* session), but **`ssh mac-mini-ts` still fails**. Tailscale is up and the host pings
(25-45ms). Verbose SSH shows `Server accepts key: … ED25519` followed by
`Permission denied (publickey,password,keyboard-interactive)` — the key is *authorized*, then auth fails.
That points at the **Mini side**: `StrictModes` perms on `~`/`~/.ssh`/`authorized_keys`, or Remote Login's
"allow access for only these users" list — both of which a macOS update or reboot resets.

Needs a **VNC session** (`vnc://100.114.130.16`) per [[feedback_no_physical_access_assumption]]; from the
Mini's own Terminal: `ls -ld ~ ~/.ssh ~/.ssh/authorized_keys` then `chmod 755 ~; chmod 700 ~/.ssh;
chmod 600 ~/.ssh/authorized_keys`, and check System Settings → General → Sharing → Remote Login.

**This blocks the whole RULE 0.7 free-automation suite** (`project-health-monitor`, `auto-issue-monitor`,
probate drip, nightly embeds) — the exact single-point-of-failure already logged as structural debt in
[[standard-project-monitoring-and-free-agents]]. Nothing has been alerting while it has been down.
