#!/usr/bin/env bash
# Run the full v2 loop on mainnet, dispute included, and print every
# transaction as a Stellar Expert link:
#   post_task -> submit (agent A) -> submit (agent B) -> verdict for A
#   -> dispute by B (stake) -> court awards B -> escrow re-settles to B
#
# The task, the two submissions and the judges' result are real files whose
# sha256 hashes go on chain, so anyone can check what was judged.
#
# Usage: POSTER=cog-demo-poster AGENT_A=cog-demo-agent AGENT_B=cog-hackathon-test \
#        ./scripts/demo-dispute-mainnet.sh <task_id> <dir with task.md a.md b.md judges.json>
set -euo pipefail
cd "$(dirname "$0")/.."

NET=mainnet
ID=${ESCROW_V2:-cogladius-escrow-v2}
POSTER=${POSTER:?}; AGENT_A=${AGENT_A:?}; AGENT_B=${AGENT_B:?}
TASK_ID=${1:?task id}; DIR=${2:?directory with task.md a.md b.md judges.json}
REWARD=${REWARD:-10000000}                     # 1 XLM in stroops
DEADLINE=$(( $(date +%s) + ${DEADLINE_SECS:-3600} ))

h() { shasum -a 256 "$1" | cut -d' ' -f1; }
addr() { stellar keys address "$1"; }
inv() {  # inv <source> <function and args...>; prints the tx link
  local src=$1; shift
  local out
  out=$(stellar contract invoke --id "$ID" --source-account "$src" --network "$NET" -- "$@" 2>&1)
  local tx
  tx=$(printf '%s\n' "$out" | grep -o -E '[0-9a-f]{64}' | tail -1 || true)
  printf '%-18s https://stellar.expert/explorer/public/tx/%s\n' "$1" "$tx"
}

# Hash of what the judges saw and decided: the task, both submissions, the
# judges' scores and the model ids they reported.
COMMIT=$(cat "$DIR/task.md" "$DIR/a.md" "$DIR/b.md" "$DIR/judges.json" | shasum -a 256 | cut -d' ' -f1)
SCORE_A=$(node -p "require('$PWD/$DIR/judges.json').a.score")
SCORE_B=$(node -p "require('$PWD/$DIR/judges.json').b.score")

inv "$POSTER"  post_task --poster "$(addr "$POSTER")" --task_id "$TASK_ID" --reward "$REWARD" \
                         --deadline "$DEADLINE" --task_hash "$(h "$DIR/task.md")"
inv "$AGENT_A" submit --task_id "$TASK_ID" --agent "$(addr "$AGENT_A")" --submission_hash "$(h "$DIR/a.md")"
inv "$AGENT_B" submit --task_id "$TASK_ID" --agent "$(addr "$AGENT_B")" --submission_hash "$(h "$DIR/b.md")"
inv cog-v2-verdict release_to_winner --task_id "$TASK_ID" --winner "$(addr "$AGENT_A")" \
                         --score "$SCORE_A" --commitment "$COMMIT"
inv "$AGENT_B" dispute --task_id "$TASK_ID" --disputer "$(addr "$AGENT_B")"
RULING_COMMIT=$(printf '%s:award:%s' "$COMMIT" "$(addr "$AGENT_B")" | shasum -a 256 | cut -d' ' -f1)
inv cog-v2-court rule --task_id "$TASK_ID" \
                 --ruling "{\"Award\":[\"$(addr "$AGENT_B")\",$SCORE_B]}" --commitment "$RULING_COMMIT"

stellar contract invoke --id "$ID" --source-account "$POSTER" --network "$NET" --send=no -- get_task --task_id "$TASK_ID"
