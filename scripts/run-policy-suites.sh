#!/usr/bin/env bash
# 1.4.6 (QA V145-9): runs the abandon-related suites once under each policy ('review' interim default, 'flag', 'consent'),
# serially (the lifecycle walks on core/demo, API and rules use the current policy), then restores 'review' and checks the
# rules are in sync. CI runs only the default.
# 1.4.7 (QA tooling): strict mode and the suites' REAL exit codes – 1.4.6 piped them through grep, so the script's status
# was grep's (a crashed suite with no "Tests:" line, or a "✕" line, could still pass). Full output is tee'd to $LOG; the
# script exits non-zero if any suite (or the final rules sync check) fails, and always restores 'review'.
#   scripts/run-policy-suites.sh            (needs the Firestore emulator for the rules suite and MySQL for the server)
set -euo pipefail
cd "$(dirname "$0")/.."
POL=src/core/abandonPolicy.ts
LOG=${LOG:-/tmp/policy-suites.log}
: > "$LOG"
setpol() { sed -i "s/export const ABANDON_POLICY: AbandonPolicy = '[a-z]*';/export const ABANDON_POLICY: AbandonPolicy = '$1';/" "$POL"; node scripts/gen-abandon-policy.js >/dev/null; }
restore() {
  local code=$?
  set +e
  setpol review && node scripts/gen-abandon-policy.js --check
  local chk=$?
  [ "$code" -eq 0 ] && [ "$chk" -ne 0 ] && code=$chk
  echo "=== exit $code (log: $LOG) ==="
  exit "$code"
}
trap restore EXIT
failed=()
# run <label> <dir> <cmd...>: the command's own exit status (pipefail: not tee's)
run() {
  local label=$1 dir=$2; shift 2  # NEED_TESTS=1 run …: also fail when no test passed (see below)
  echo "--- $label ---" | tee -a "$LOG"
  local st=0 out
  out=$(mktemp)
  (cd "$dir" && "$@") 2>&1 | tee -a "$LOG" "$out" || st=$?
  # 1.4.8 (QA tooling): jest exits 0 when a -t filter matches nothing (every test skipped) – a step that ran 0 tests fails
  if [ "$st" -eq 0 ] && [ -n "${NEED_TESTS:-}" ] && ! grep -Eq '^Tests:.* [1-9][0-9]* passed' "$out"; then
    echo "--- $label: 0 tests ran (filter matched nothing) ---" | tee -a "$LOG"
    st=99
  fi
  rm -f "$out"
  echo "--- $label: exit $st ---" | tee -a "$LOG"
  [ "$st" -eq 0 ] || failed+=("$label($st)")
}
for p in review flag consent; do
  setpol "$p"
  echo "=== policy $p ===" | tee -a "$LOG"
  export VL_POLICY_RUN=$p
  run "core+demo/$p" . npx jest --maxWorkers=2 src/core/__tests__/lifecycle src/services/__tests__/lifecycle146
  run "api/$p" server env TEST_DATABASE_URL="${TEST_DATABASE_URL:-mysql://root@127.0.0.1:3306/volleylive_test}" node --import tsx --test --test-concurrency=1 tests/lifecycle.test.ts
  NEED_TESTS=1 run "rules/$p" rules-tests env FIRESTORE_EMULATOR_HOST="${FIRESTORE_EMULATOR_HOST:-127.0.0.1:8181}" FIREBASE_STORAGE_EMULATOR_HOST="${FIREBASE_STORAGE_EMULATOR_HOST:-127.0.0.1:9299}" npx jest --runInBand -t "lifecycle walk"
done
if [ "${#failed[@]}" -gt 0 ]; then
  echo "FAILED: ${failed[*]}" | tee -a "$LOG"
  exit 1
fi
echo "all policy suites passed" | tee -a "$LOG"
