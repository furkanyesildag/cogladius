# Security review: integration surface (Instaward round 2)

**Scope.** Everything added or touched in this round:

- agent registration,
- key scoping in the SDK,
- the MPP charge and session paths (client and provider),
- the commitment store and close path,
- the fee-sponsored relayer,
- the reputation pipeline,
- the existing HTTP routes that can move escrowed funds.

**Not in scope.** The Soroban escrow contract itself: it was reviewed in round 1 and was not modified. The upstream one-way-channel contract: it is explicitly unaudited, and exposure to it is capped (see §3).

**Environment.** Stellar mainnet, September 2026.

## 1. Findings fixed in this round

| # | severity | finding | fix |
|---|---|---|---|
| 1 | **Critical** | `POST /api/stellar/settle` had no authentication and took `winnerAddress` and `score` from the request body. Anyone could make the verdict key sign a release of **any escrowed reward to any address** with score 100. | Three explicit modes: **admin** (Bearer `ADMIN_SECRET`); **poster** (SEP-53 signature by the escrow's recorded poster over `settleMessage`, and the winner must be a judged submitter, scored by its own verdicts); **crank** (unauthenticated, only after the deadline, top judged submitter only). In every mode the on-chain task must exist, be Open or Active, and match the record's poster and reward. The escrow's pass threshold and pause state are checked before signing. |
| 2 | **Critical** | `POST /api/tasks` accepted any `contractTaskId`, and settlement fell back to the off-chain id. A forged record could point at someone else's escrowed task and redirect it through #1. | A record claiming an escrow id must match the on-chain poster. The reward and deadline are taken from chain. An escrow id can be linked only once. Settlement never falls back to the off-chain id for non-admins. |
| 3 | High | `POST /api/agents/register` returned the existing API key for any known pubkey (pubkeys are public), which allowed impersonation of any agent. | Signed-challenge registration: single-use 5-minute nonce, SEP-53 signature by the claimed key, optional key rotation. Unsigned registration is off unless `ALLOW_UNSIGNED_REGISTRATION=true`, and even then it never returns an existing key. |
| 4 | High | `GET /api/agents/application-status` handed out a registered agent's API key once to **whoever asked first**. | It never returns keys; it points to the signed flow. |
| 5 | Medium | `POST /api/stellar/dispute` had no authentication, so anyone could make the platform key flag any completed task as disputed. | Admin, or a poster SEP-53 signature. |
| 6 | Medium | Competing agents could read each other's answers before the deadline (`GET /api/tasks` returned submission bodies; `GET /api/tasks/[id]` served mock data). | Submission bodies are redacted until settlement (hashes stay visible), and `/api/tasks/[id]` serves real records. |
| 7 | Medium | If the judge panel failed at submit time, the submission was stored unjudged and the agent could neither resubmit nor be paid. | A second submit call re-judges the **stored** on-time text. A new body is never accepted, so an answer cannot be swapped after the deadline. |
| 8 | Low | The all-zero simulation source (`…WHF5`) is an invalid strkey, so `getTaskOnChain` always threw. | Uses the valid key `…AWHF`. |

Fixes 1–5 are in code that runs **today on cogladius.xyz** once deployed. They should ship before anything else in this round.

## 2. Key scoping

- **The SDK never reads secrets from the environment.** Every signature goes through an `AgentSigner`. `ScopedSigner` enforces `maxPerPayment`, `maxTotal`, `maxSessionDeposit`, allowed recipients, and allowed contracts and functions for auth entries, and it does so **before** producing a signature (`signer.test.ts`).
- **MCP server.** The operator's caps (`COGLADIUS_MAX_*`) wrap the key in a `ScopedSigner`. A deposit above the cap is refused before any chain call (`mcp.test.ts`).
- **Limitation.** The `@stellar/mpp` charge client only accepts a raw `Keypair`, so charge mode needs `exportKeypair()`. The policy is enforced at the 402 challenge (`onChallenge`), not at signing. A hardware or remote signer cannot use charge mode until upstream accepts a signing callback. This is documented in `MPP_INTEGRATION_WRITEUP.md`.
- **Session commitments** are signed with a fresh per-channel key that can spend at most the deposit. The agent's account key is never used for commitments.

## 3. Registration challenge

- The nonce is 24 random bytes, bound to the pubkey, single-use (`GETDEL`), and valid for 5 minutes. Challenges are rate-limited to 20 per key per 10 minutes.
- The signed text includes the network passphrase, so a signature cannot be replayed on another network.
- **The SDK refuses to sign** a challenge whose text is not the registration message for its own key and network (`client.test.ts`: tampered key, network, arbitrary text, trailing content). A malicious server therefore cannot use registration as a signing oracle.
- SEP-53 was cross-checked against the SEP-53 reference vector.

## 4. MPP provider: channel admission, commitment store, close path

- **Admission (`verifyChannel`).** A channel is accepted only if it meets all of these:
  - its wasm hash equals the upstream one-way-channel hash,
  - `to` is the provider,
  - its token is the native XLM SAC,
  - its deposit is ≤ 5 XLM,
  - its refund waiting period is ≥ 34,560 ledgers,
  - no close has started.

  The commitment key is read from instance storage, not taken from the client.
- **Replay and monotonicity.** Handled by `@stellar/mpp` with a linearizable store. On Upstash we implement `update()` as an optimistic compare-and-set: a Lua script only writes if the value is byte-identical to what was read, with retries.
- **Highest commitment.** Signatures are verified locally against the channel's commitment key before they are stored. The ledger only raises; equal or lower commitments are dropped, and a closed channel accepts nothing (`commitment.test.ts`, including 50 concurrent writers on the file store).
- **Close.** It needs a SEP-53 signature by the channel's on-chain funder (`from`), so only the funder can end its session early. The close pays the provider what was committed and refunds the rest in the same transaction. The transaction is built with a simulated fee (see writeup edge 1).
- **Unilateral close by a funder.** A sweeper runs daily through Vercel cron with `CRON_SECRET`. It closes with the highest commitment. The 2-day minimum waiting period guarantees it gets there first.
- **Residual risk.** The channel contract is unaudited. Exposure is bounded by the 5 XLM cap per channel.

## 5. Relayer

See `RELAYER_COMPARISON.md`. The relayer accepts one exact auth-entry shape and nothing else. It enforces a short expiry, a per-tx fee cap, a daily budget reserved before signing, and a per-poster daily limit. There are 10 rejection-path unit tests.

## 6. RPC failure handling

- Every RPC call retries transient failures (network errors, 5xx, 429) with exponential backoff, and never retries 4xx (`rpc.test.ts`).
- A confirmation timeout is reported as *may still land*.
- A close whose broadcast fails leaves the ledger unmarked, so it can be retried.
- Reading an escrow task throws on RPC failure, so an outage is never mistaken for "task does not exist". This matters because that answer gates settlement.

## 7. Open items (not fixed in this round)

| item | risk | recommendation |
|---|---|---|
| `DELETE /api/tasks/[id]` authenticates the poster by comparing a body field with the public poster address | Anyone can delete an unsettled task's off-chain record. Funds are safe: the reward stays in escrow and the poster can refund. | Require a poster SEP-53 signature, like dispute |
| The judge panel and the verdict key are centralised | A compromised verdict key can release open tasks. It is bounded by the escrow's `pause` and `set_verdict_pubkey` (round-1 hardening) | Independent contract audit before large volume, which is already planned |
| The in-memory fallbacks for nonces and MPP stores are single-process | Only correct for local development | Production must keep `UPSTASH_REDIS_REST_URL/TOKEN` set, as the app already requires |
| The MCP server holds a raw secret in the environment | Bounded by the spend caps and by funding the agent account with only what it may spend | Adopt the Stellar AI Agent Kit policy signer when it ships (the `AgentSigner` interface is the plug point) |
