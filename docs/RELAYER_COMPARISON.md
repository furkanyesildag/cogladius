# Fee-sponsored `post_task`: OpenZeppelin Relayer vs. a minimal relayer

**Decision:** we ship the minimal relayer (`relaySponsoredPostTask` in the SDK, served at `/api/relay/post-task`). The OpenZeppelin Relayer stays the recommended path for any deployment that sponsors *many kinds* of transactions.

**How the OpenZeppelin Relayer was evaluated.** We read its documentation and configuration model. We did **not** deploy it for this round, so the comparison below is a design comparison, not a benchmark.

## The job

A poster who holds only the reward should be able to lock it in the escrow. The flow:

1. The poster signs just the Soroban authorization entry for `escrow.post_task(poster, taskId, reward, deadline)`.
2. A relayer is the transaction source. It pays the network fee and submits.

On mainnet the relayer spends real XLM. Its main risks are therefore:

- being tricked into submitting something other than a post, and
- being drained by volume.

## Comparison

| | OpenZeppelin Relayer | minimal relayer (shipped) |
|---|---|---|
| **What it is** | A general relayer service (Rust, containerised). Queues, key management (local, KMS, Vault), policies, multiple networks including Stellar | About 120 lines in the SDK plus a Next.js route |
| **Operational footprint** | A separate service to run, with Redis and a signer backend | Nothing new: it runs inside the existing app, and state lives in the existing Upstash |
| **What it will sign** | Driven by configurable policies (allowed contracts and similar) | Exactly one shape: one auth entry, root `escrow.post_task` with the exact requested arguments, a single nested `transfer(poster → escrow, reward)` on the reward asset, and nothing else |
| **Expiry control** | Policy dependent | The entry must expire within 200 ledgers |
| **Fee control** | Per-network fee settings | Simulated fee capped per tx (`RELAYER_MAX_FEE_XLM`, 0.2), a daily budget reserved before signing (`RELAYER_DAILY_BUDGET_XLM`, 5), and 5 sponsored posts per poster per day |
| **Key custody** | Strong: KMS and Vault options | Env secret on Vercel. Acceptable because the account only ever holds a few XLM for fees |
| **Retries / queueing** | Built in | Synchronous; the client retries |
| **Auditability** | Mature, used across chains | Small enough to read in one sitting, and every rejection path has a unit test (`sponsor.test.ts`, 10 cases) |

## Why the minimal relayer for this job

- **Scope.** The relayer must sign exactly one transaction shape. A narrow validator that rejects everything else is a smaller attack surface than a general policy engine configured to approximate it.
- **Cost of operation.** One founder runs Cogladius. An extra always-on service, with its own Redis and key backend, is a larger operational risk than the few XLM a day the relayer can spend.
- **Proof.** The mainnet evidence shows it works. It includes a `post_task` whose source and fee payer is the relayer, where the poster's balance dropped by exactly the reward (`evidence/MAINNET_EVIDENCE.md`).

## When to switch

Move to the OpenZeppelin Relayer when any of these happens:

- Cogladius sponsors more than one transaction type (claims, agent registration on-chain, disputes).
- Volume needs queueing.
- The relayer key should move to a KMS.

The SDK's client side (`EscrowClient.signSponsoredPost`) produces standard signed authorization entries, so it works with either relayer.

## A note for mainnet XLM

The reward asset on the live escrow is native XLM, which is also the fee asset. Any XLM poster can therefore pay its own fee, and sponsorship here is a UX improvement (one signature, no fee math), not a requirement. It becomes essential the moment the reward asset is a token such as USDC: the escrow is SEP-41 asset-agnostic, and a USDC poster may hold no XLM at all.
