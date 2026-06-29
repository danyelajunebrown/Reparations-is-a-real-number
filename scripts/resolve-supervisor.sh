#!/bin/bash
# Supervisor: keep resuming the FamilySearch resolver after Chromium crashes.
# Stops only when (a) the worklist is exhausted, or (b) FamilySearch forces a
# re-login (needs the human). Fully resumable: each resolver run picks up from
# the progress file, so a crash costs nothing but a relaunch.
cd "/Users/danyelabrown/Desktop/danyelajunebrown GITHUB/Reparations-is-a-real-number-main" || exit 1
LOG=worksheets/resolve-run.log
SUPLOG=worksheets/supervisor.log
echo "=== SUPERVISOR START $(date +%H:%M:%S) ===" >> "$SUPLOG"
for attempt in $(seq 1 40); do
  # Remaining worklist size (unnamed OR placeless). 0 => done.
  REMAIN=$(node -e '
    require("dotenv").config();
    const {neon}=require("@neondatabase/serverless");
    const sql=neon(process.env.DATABASE_URL);
    const SID="f4a5b049-30dc-437f-8d55-fe5d68d42115", FS_ID="P4RF-PFQ";
    (async()=>{
      const vs=await sql`SELECT visited_set AS v FROM ancestor_climb_sessions WHERE id=${SID}::uuid`;
      const visited=(vs[0].v||[]).filter(Boolean).filter(x=>x!==FS_ID);
      const have=await sql`SELECT pei.external_id fs, (cp.primary_state IS NOT NULL OR cp.primary_county IS NOT NULL) hp
        FROM person_external_ids pei JOIN canonical_persons cp ON cp.id=pei.canonical_person_id
        WHERE pei.id_system=\x27familysearch\x27 AND pei.external_id=ANY(${visited})`;
      const k=new Map(); for(const r of have) if(!k.has(r.fs)) k.set(r.fs,r.hp);
      const wl=visited.filter(id=>{const v=k.get(id);return v===undefined||!v;});
      console.log(wl.length);
    })().catch(e=>{console.error(e.message);process.exit(2)});' 2>>"$SUPLOG")
  echo "[attempt $attempt] $(date +%H:%M:%S) remaining worklist=$REMAIN" >> "$SUPLOG"
  if [ "$REMAIN" = "0" ]; then
    echo "=== WORKLIST EXHAUSTED — regenerating worksheet ===" >> "$SUPLOG"
    HEADLESS=1 LIMIT=0 REGEN=1 node scripts/generate-ancestor-probate-worksheet.mjs >> "$SUPLOG" 2>&1
    echo "DONE_EXHAUSTED" >> "$SUPLOG"; exit 0
  fi
  # Run the resolver. REGEN=0 here; we regenerate once at the very end.
  echo "--- resolver launch attempt $attempt $(date +%H:%M:%S) ---" >> "$LOG"
  HEADLESS=1 LIMIT=0 REGEN=0 node scripts/resolve-climb-ancestors.js >> "$LOG" 2>&1
  # If it bailed on a login wall, stop and hand off to the human.
  if tail -25 "$LOG" | grep -qi "Login required but running headless"; then
    echo "NEED_RELOGIN at $(date +%H:%M:%S)" >> "$SUPLOG"; exit 3
  fi
  sleep 5
done
echo "MAX_ATTEMPTS_REACHED" >> "$SUPLOG"; exit 4
