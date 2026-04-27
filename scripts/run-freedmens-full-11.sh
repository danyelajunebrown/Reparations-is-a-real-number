#!/bin/bash
# Full-roll Freedmens enslaver-field extraction on the 11 branches that
# have "Name of last master/mistress/plantation" fields per the form
# inventory. No 200-depositor cap. Honors mid-roll template cutoffs.
#
# Optional: set FREEDMENS_BRANCHES to a space-separated list of slugs to
# restrict the run, e.g. FREEDMENS_BRANCHES="huntsville memphis tallahassee
# savannah-r8 charleston-r21" to retry only the branches that failed in
# the Apr 24 run. Empty / unset = run all branches.
set -uo pipefail
cd "/Users/danyelabrown/Desktop/danyelajunebrown GITHUB/Reparations-is-a-real-number-main"
export NODE_OPTIONS="--max-old-space-size=1536"

OUT=/tmp/freedmens-full-11
mkdir -p "$OUT"
RUN_LOG="$OUT/run.log"

declare -a BRANCHES=(
  "charleston-r21|Charleston, South Carolina — Roll 21|324|319"
  "baltimore|Baltimore, Maryland|99999|"
  "huntsville|Huntsville, Alabama|99999|"
  "louisville|Louisville, Kentucky|99999|"
  "memphis|Memphis, Tennessee|99999|"
  "tallahassee|Tallahassee, Florida|99999|"
  "richmond-r26|Richmond, Virginia — Roll 26|99999|"
  "savannah-r8|Savannah, Georgia — Roll 8|75|"
  "dc-r4|Washington, D.C. — Roll 4|232|"
  "new-orleans|New Orleans, Louisiana|101|"
)

FILTER="${FREEDMENS_BRANCHES:-}"

for spec in "${BRANCHES[@]}"; do
    IFS='|' read -r slug branch max_img acct_max <<< "$spec"

    if [ -n "$FILTER" ] && [[ " $FILTER " != *" $slug "* ]]; then
        echo "[$(date +%T)] --- skipping $slug (not in FREEDMENS_BRANCHES) ---" | tee -a "$RUN_LOG"
        continue
    fi

    log="$OUT/${slug}.log"
    echo "[$(date +%T)] === $branch (max_img=$max_img) ===" | tee -a "$RUN_LOG"

    args=(--branch "$branch")
    [ -n "$max_img" ] && [ "$max_img" != "99999" ] && args+=(--max-image "$max_img")
    [ -n "$acct_max" ] && args+=(--acct-max "$acct_max")

    node scripts/extract-freedmens-fields.js "${args[@]}" > "$log" 2>&1
    rc=$?
    echo "[$(date +%T)] $branch exit=$rc" | tee -a "$RUN_LOG"
    grep -E "Records parsed|Cache hits|Depositors matched|DB updates|Errors|Pages OCRd" "$log" 2>/dev/null | tail -8 | tee -a "$RUN_LOG"
    sleep 75
done
echo "[$(date +%T)] === FREEDMENS RUN COMPLETE ===" | tee -a "$RUN_LOG"
