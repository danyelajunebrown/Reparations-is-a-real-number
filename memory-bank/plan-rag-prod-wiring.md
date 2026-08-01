> **REALITY-CHECK (2026-07-31).** RagService is built but imported by ~zero live code (orphaned); live reads are still ILIKE keyword. Retrievability requires WIRING RAG to a live read surface, not just embedding. An untracked `src/api/routes/rag.js` may be an in-progress fix.

# RUNBOOK — wire /api/rag/query to work in production (make "Ask the archive" live)

_Created 2026-07-07. The frontend Ask surface + eval harness are built and deployed; they
return "retrieval unavailable" because the backend can't embed the query. This is the
ops step to fix that. Code is READY — this is config + a Mini run, not a code change._

## The problem (verified)
`GET/POST /api/rag/query` is mounted on Render and responds, but returns
`{ degraded:true, error:"retrieval unavailable: fetch failed" }`. Cause: `RagService`
(`src/services/rag/RagService.js`) embeds the query via ollama at `OLLAMA_URL`
(default `http://localhost:11434/api/embeddings`). **Render has no local ollama and is
NOT on the Tailscale tailnet**, so the fetch fails and the route degrades (by design).

## CRITICAL: the query must embed in the SAME space as the corpus (nomic)
The doc corpus (`embeddings`, content_kind='doc_ocr') was embedded with
**`nomic-embed-text` on the Mini's ollama**. `RagService` defaults `EMBED_SOURCE=ollama`,
`EMBED_MODEL=nomic-embed-text`. **Do NOT set `EMBED_SOURCE=gemini` as a shortcut** —
gemini-embedding-001 is a DIFFERENT vector space; querying nomic-corpus with a gemini
vector returns garbage (cosine across mismatched spaces). The only correct prod path is
`OLLAMA_URL` → a reachable **nomic** ollama. (A gemini path would require RE-embedding the
whole corpus in gemini space first — don't.)

## Steps (run on the Mini + set Render env)

### 1. Expose the Mini's ollama to Render via Tailscale Funnel
Render isn't on the tailnet, so `tailscale serve` (tailnet-only) is not enough — use
**Funnel** (public HTTPS). On the Mini:
```bash
# ollama must be listening (it already runs for the embed drips). Confirm:
curl -s http://localhost:11434/api/tags | head -c 200        # lists models incl. nomic-embed-text

# Expose port 11434 publicly over HTTPS (Funnel). One of:
tailscale funnel 11434                # foreground; or
tailscale funnel --bg 11434           # background
tailscale funnel status               # prints the public https://<mini>.<tailnet>.ts.net URL
```
This yields e.g. `https://danyelicas-mini.<tailnet>.ts.net`. The embeddings endpoint is
then `https://danyelicas-mini.<tailnet>.ts.net/api/embeddings`.

**Security note:** Funnel is PUBLIC + `RagService.embedQuery` sends no auth header, so this
exposes a public unauthenticated embedding endpoint. It's read-only and cheap, but if you
want it locked down, front ollama with a tiny auth proxy (check a shared header) and point
Funnel at the proxy, or Funnel the Mini's own Express (which has local ollama) instead of
raw ollama. Acceptable to start open; revisit.

### 2. Point Render at it
Render dashboard → the `reparations-platform` service → Environment → add:
```
OLLAMA_URL = https://danyelicas-mini.<tailnet>.ts.net/api/embeddings
# EMBED_SOURCE stays 'ollama' (default); EMBED_MODEL stays 'nomic-embed-text' (default)
```
Save → Render redeploys. (No code change; env only.)

### 3. Verify
```bash
curl -s https://reparations-platform.onrender.com/api/rag/health          # embedded_docs > 0
curl -s -X POST https://reparations-platform.onrender.com/api/rag/query \
  -H 'content-type: application/json' \
  -d '{"question":"enslaved persons in an estate inventory with appraised values","k":5}'
# expect grounded:true + citations[], NOT degraded:true
```
Then load the live site → **Ask** tab → a real cited answer should appear.

### 4. Records-level coverage (the deferred backfill) — enables person recall
Doc-OCR is embedded; `canonical_persons` are NOT, so questions "about a person" only hit
document text. To embed the person corpus (RULE 0.6), on the Mini:
```bash
cd ~/Desktop/Reparations-is-a-real-number && git pull        # deploy-from-git, not scp
EMBED_SOURCE=ollama node scripts/embed-persons.mjs           # idempotent/resumable; ~days
# (EMBED_SOURCE=ollama is REQUIRED or it silently falls back to the 429-capped gemini)
```

### 5. Baseline the eval (once 2–4 are done)
From the MacBook (or anywhere with network):
```bash
node scripts/eval-records-rag.mjs        # hard gates + calibration baselines
```
Record the printed baselines in `activeContext.md`. Served-gold + stratified recall go
from ~0 to real numbers after step 4.

## Related
- Ask surface + citations: `frontend/src/components/Ask/AskPanel.jsx` (deployed).
- Eval harness: `scripts/eval-records-rag.mjs` + `tests/fixtures/rag-eval/gold.json`.
- Corpus/embedding background: [[plan-phase2-rag]] (nomic decision, CONC=1, the Funnel note).
- Gate gap this unblocks measuring: marquee enslavers serve scans but assertable=false;
  AR "George Washington" #452284 assertable=true (#118) — see the front-end audit in activeContext.
