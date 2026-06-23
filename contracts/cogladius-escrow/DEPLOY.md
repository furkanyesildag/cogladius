# Deploying the Cogladius escrow to Stellar testnet

Reproducible end-to-end. Requires the [Stellar CLI](https://developers.stellar.org/docs/tools/cli)
(`stellar 27+`) and the Rust `wasm32v1-none` target.

```bash
rustup target add wasm32v1-none
```

## 1. Network + identities

```bash
stellar network add testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"

# Deployer = admin = submitter (funded via Friendbot)
stellar keys generate cogladius-deployer --network testnet --fund

# Verdict authority (no funding needed — it only signs verdict messages)
stellar keys generate cogladius-verdict --network testnet
```

The contract stores the verdict authority's **raw** ed25519 public key. Derive it:

```bash
VERDICT_ADDR=$(stellar keys address cogladius-verdict)
node -e "const {Keypair}=require('@stellar/stellar-sdk'); \
  console.log(Keypair.fromPublicKey('$VERDICT_ADDR').rawPublicKey().toString('hex'))"
# → e.g. ebdaf5654c9ef27b07e536c5d32a5b4bebce48bfc010691d7da6a44a3c2b4a0e
```

## 2. USDC Stellar Asset Contract (SAC)

```bash
USDC_ISSUER=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5

# Deterministic id (already instantiated on testnet):
stellar contract id asset --asset USDC:$USDC_ISSUER --network testnet
# → CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA

# (If not yet instantiated on a fresh network:)
stellar contract asset deploy --asset USDC:$USDC_ISSUER \
  --source cogladius-deployer --network testnet
```

## 3. Build + deploy the escrow

```bash
stellar contract build   # → target/wasm32v1-none/release/cogladius_escrow.wasm

stellar contract deploy \
  --wasm target/wasm32v1-none/release/cogladius_escrow.wasm \
  --source cogladius-deployer --network testnet \
  -- \
  --admin "$(stellar keys address cogladius-deployer)" \
  --usdc_sac CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA \
  --verdict_pubkey ebdaf5654c9ef27b07e536c5d32a5b4bebce48bfc010691d7da6a44a3c2b4a0e \
  --pass_threshold 70
# → CAZ2F6DGJBEGEPX5OGYGR3NCF5Z4X4P6VMFBILUVQBF7OUSQS3PC6ZO7
```

## 4. Verify

```bash
CONTRACT=CAZ2F6DGJBEGEPX5OGYGR3NCF5Z4X4P6VMFBILUVQBF7OUSQS3PC6ZO7

stellar contract invoke --id $CONTRACT --source cogladius-deployer \
  --network testnet -- get_config
# → {"admin":"GBPWNBSO…","pass_threshold":70,"usdc_sac":"CBIELTK6…","verdict_pubkey":"ebdaf565…"}
```

## 5. Lock a USDC reward (post_task)

The poster needs a USDC trustline + balance:

```bash
stellar tx new change-trust --source cogladius-deployer --network testnet \
  --line USDC:$USDC_ISSUER
# Then fund USDC at https://faucet.circle.com (select "Stellar Testnet").

stellar contract invoke --id $CONTRACT --source cogladius-deployer \
  --network testnet -- post_task \
  --poster "$(stellar keys address cogladius-deployer)" \
  --task_id 1 --reward 20000000 --deadline 9999999999
# reward is in USDC stroops (7 decimals): 20000000 = 2.0 USDC
```

The resulting transaction shows USDC moving into the contract — verifiable on
[Stellar Expert](https://stellar.expert/explorer/testnet).

## App wiring

Set these in `app/.env.local` (see `app/.env.local.example`):

```
NEXT_PUBLIC_ESCROW_CONTRACT_ID=CAZ2F6DGJBEGEPX5OGYGR3NCF5Z4X4P6VMFBILUVQBF7OUSQS3PC6ZO7
NEXT_PUBLIC_USDC_SAC_ID=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
VERDICT_AUTHORITY_SECRET=<cogladius-verdict secret>
SOROBAN_SUBMITTER_SECRET=<cogladius-deployer secret>
```
