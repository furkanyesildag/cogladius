#!/usr/bin/env bash
# Deploy cogladius-escrow-v2 to Stellar mainnet.
#
# Keys come from the stellar CLI keystore; secrets are never printed.
#   FUNDER   pays for the new accounts and the deploy (needs ~15 XLM)
#   ADMIN    interim admin; rotate to the 2-of-3 multisig with
#            propose_rotation once its address exists (takes effect after 48 h)
# New keys created here if missing: cog-v2-verdict, cog-v2-court, cog-v2-fee.
#
# Usage: FUNDER=cog-admin ADMIN=cog-admin ./scripts/deploy-mainnet.sh
set -euo pipefail
cd "$(dirname "$0")/.."

NET=mainnet
FUNDER=${FUNDER:?set FUNDER to a funded keystore name}
ADMIN=${ADMIN:-$FUNDER}
XLM_SAC=CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA

exists() { curl -sf "https://horizon.stellar.org/accounts/$1" >/dev/null; }

for k in cog-v2-verdict cog-v2-court cog-v2-fee; do
  stellar keys address "$k" >/dev/null 2>&1 || stellar keys generate "$k" --network "$NET" >/dev/null
  addr=$(stellar keys address "$k")
  if ! exists "$addr"; then
    # 2 XLM: the 1 XLM base reserve plus room for fees.
    stellar tx new create-account --source-account "$FUNDER" --destination "$addr" \
      --starting-balance 20000000 --network "$NET" >/dev/null
    echo "created $k $addr"
  else
    echo "exists  $k $addr"
  fi
done

stellar contract build >/dev/null
WASM=target/wasm32v1-none/release/cogladius_escrow_v2.wasm

CONFIG=$(cat <<JSON
{"admin":"$(stellar keys address "$ADMIN")",
 "token":"$XLM_SAC",
 "verdict_authority":"$(stellar keys address cog-v2-verdict)",
 "court_authority":"$(stellar keys address cog-v2-court)",
 "fee_recipient":"$(stellar keys address cog-v2-fee)",
 "fee_bps":300,
 "pass_threshold":70,
 "dispute_window":86400,
 "adjudication_sla":86400,
 "court_sla":259200,
 "dispute_stake_bps":1000,
 "min_dispute_stake":"5000000",
 "paused":false}
JSON
)

ID=$(stellar contract deploy --wasm "$WASM" --source-account "$FUNDER" --network "$NET" \
  --alias cogladius-escrow-v2 -- --config "$CONFIG")
echo "deployed cogladius-escrow-v2: $ID"
echo "wasm sha256: $(shasum -a 256 "$WASM" | cut -d' ' -f1)"
stellar contract invoke --id "$ID" --source-account "$FUNDER" --network "$NET" --send=no -- get_config
