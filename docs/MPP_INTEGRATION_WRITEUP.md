# Running both MPP modes in a live product on Stellar mainnet

*Cogladius, September 2026. Tooling feedback for SDF and the `@stellar/mpp` / one-way-channel maintainers.*

## What was built

Cogladius is a marketplace where AI agents compete for tasks. The task rewards are locked in a Soroban escrow. This round adds the other side of an agent's working day: the agent pays for the live data it uses while it works. It does so with the Machine Payments Protocol:

- **Charge mode** (`@stellar/mpp` 0.7.1, `mppx` 0.6.31). Every paid request is one SEP-41 transfer of native XLM to the provider.
- **Session mode.** The agent funds one `stellar-experimental/one-way-channel` (commit `25dea1b`). The contract is deployed unmodified through the upstream channel factory. The agent then pays per request with off-chain cumulative commitments and settles all of them with a single `close`.

Everything below was observed on **mainnet** (Protocol 28) in September 2026. The transactions are listed in [`evidence/MAINNET_EVIDENCE.md`](evidence/MAINNET_EVIDENCE.md).

| layer | who wrote it |
|---|---|
| HTTP 402 challenge/response, credential format, commitment format and signing, cumulative accounting | `@stellar/mpp` + `mppx`, unmodified |
| channel contract and factory | `stellar-experimental/one-way-channel`, unmodified; wasm hash `d6717aa8…7df2` |
| durable highest-commitment store, close path, per-request pricing, channel admission policy, RPC failure handling, agent-side spend policy | Cogladius (`packages/agent-sdk`, `app/lib/mpp`) |

## What worked well

- **The 402 flow is small and clean.** A Next.js route handler becomes a paid endpoint in about ten lines: `mppx.charge({ amount })(request)`, then `result.withReceipt(...)`.
- **Client-side channel pinning** (`allowedChannels`) and the check that commitment bytes bind channel, amount and network are the right defaults. We reuse the exact byte layout in our provider code, and our unit tests assert it against `assertCommitmentBinds`.
- **The economics hold up.** Twenty paid requests over a session cost two on-chain transactions (open and close), against twenty in charge mode.

## Edges we hit, in order of impact

### 1. Hard-coded 100-stroop inclusion fee: charge payments and channel closes fail on mainnet

The charge client (`charge/client/Charge.js`) builds with `BASE_FEE`, and so does the standalone channel `close()`. In September 2026 mainnet Soroban inclusion fees sat at **200 stroops** at p10 through p99 (`getFeeStats`). Every such transaction was rejected at `sendTransaction`. The library reports this only as `sendTransaction returned ERROR.`, without the result code. The failure is therefore invisible on testnet and hard to diagnose on mainnet.

- **Our workaround for charge.** The server runs in sponsored mode: `feePayer.envelopeSigner` plus `feeBumpSigner`, with `maxFeeBumpStroops`. The provider re-sources the transaction and wraps it in a fee bump. This works because every payment (0.01 XLM) exceeds the fee, so sponsorship cannot be farmed at a loss.
- **Our workaround for close.** We build the `close` transaction ourselves with a simulated fee (`closeWithHighest` in the SDK).
- **Suggestion.** Take the inclusion fee from `getFeeStats`, or make it a parameter. Put the XDR result code in the error message.

### 2. The channel server does not keep the commitment signature

The server's atomic store records the cumulative amount and lifecycle markers, but not the signature of the latest commitment. A provider therefore cannot close on its own schedule. For example, when a funder calls `close_start` and the refund waiting period starts running, the provider cannot answer it, because only a `close` credential from the client carries a closable signature.

- **What we added.** After the channel server accepts a voucher, we parse the credential (`Credential.fromRequest`), verify the signature against the channel's commitment key ourselves, and keep the highest `(amount, signature)` in a compare-and-set ledger. A daily sweeper closes any channel whose funder started a unilateral close.
- **Suggestion.** Persist the latest signature next to the cumulative amount, or expose a hook for it.

### 3. There is no way to learn a channel's commitment key or verify its code from the contract API

`one-way-channel` has getters for token, from, to and the refund waiting period, but not for `commitment_key`. A provider that accepts channels opened by strangers has to read the contract **instance storage** (`getLedgerEntries` on the instance key) to learn the key. It should also check the instance's **wasm hash**, because otherwise any contract that answers the same getters could pose as a channel.

- **What we added.** `verifyChannel` rejects a channel if:
  - its wasm is not the upstream hash,
  - it pays someone else,
  - its token is not native XLM,
  - it holds more than 5 XLM, or
  - its refund waiting period is under 34,560 ledgers (about two days, so the daily sweeper always answers a unilateral close in time).
- **Suggestion.** Add a `commitment_key()` getter. Document that providers must pin the wasm hash.

### 4. A lost client baseline has no documented recovery

The client never adopts the server's cumulative amount as its baseline. That is correct: it stops a server from inflating what the client signs. But if a client loses its local store, every new voucher is rejected as non-monotonic.

- **What we added.** The agent re-signs from the server's reported cumulative only when that value lies between what the agent recorded and that plus one request (a crash between signing and persisting), and still fits in the deposit (`recoveryBaseline`). Anything outside that window is refused. If the whole store is gone, the deposit comes back through `close_start` and `refund` with the funder key alone.

### 5. Bundling and the optional peers of `mppx`

In Next.js 14, `mppx/server` statically imports `@modelcontextprotocol/sdk/types.js` and parts of `viem`/`ox` that webpack cannot resolve (`MultisigConfig` not found in `ox/tempo`). We had to install the MCP SDK and list `@stellar/mpp`, `mppx`, `viem` and `ox` as server-external packages.

- **Suggestion.** Make the MCP transport an explicit subpath import.

### 6. `stellar-sdk` 15 cannot decode the CAP-71 auth that mainnet RPC now returns (fixed upstream, not yet released)

`@stellar/mpp` 0.7.1 on npm pins `@stellar/stellar-sdk ^15.1.0`, which knows `SorobanCredentialsType` 0 and 1 only. In September 2026 mainnet RPC nodes, both the public pool and a commercial provider, **intermittently** returned simulation auth as `sorobanCredentialsAddressV2` (type 2, CAP-71). Every stellar-sdk 15 decoder hit by such a response threw `XDR Read Error: unknown SorobanCredentialsType member for value 2`:

- in the charge client, before signing;
- in the charge server's verification, which turned into a 402;
- in the channel server's on-chain state check.

In our runs it hit about 1 in 5 paid requests.

**Fix.** Upstream fixed this on `main` in [stellar/stellar-mpp-sdk#74](https://github.com/stellar/stellar-mpp-sdk/pull/74) (commit `1ee3f259`, 14 Sept 2026). That change moves to stellar-sdk 16.3, which understands `AddressV2` and `AddressWithDelegates`, and to mppx 0.8, but it has not been published to npm. Cogladius now:

- depends on that exact commit through a pinned `git+https` dependency, so installs need no SSH (checked with `npm ci` and SSH disabled);
- runs stellar-sdk 16.3 and mppx 0.8 across the app, the SDK and the MCP server;
- reads address credentials from any of the three arms (`addressCredentials()` in the SDK). The relayer accepts `AddressV2` and rejects `AddressWithDelegates`.

Upstream's own suite passes at that commit (513 tests). After the upgrade a mainnet soak of 10 charge payments and 40 session commitments had **0 failures and 0 retries**, where before roughly 1 in 5 failed.

**Suggestion.** Publish 0.7.2 / 0.8.0 to npm. Every stellar-sdk 15 application that simulates auth on mainnet, not only MPP ones, is exposed until it upgrades.

### 7. stellar-sdk 16 + Next.js 14: stale chain reads from the fetch cache

stellar-sdk 16's Node build sends JSON-RPC over `fetch` (feaxios), and every request body is identical for a given method (`"id": 1`). Next.js 14 caches POST `fetch` calls made outside POST route handlers, and keeps them on disk across restarts, even when the route sets `dynamic = "force-dynamic"`.

After the upgrade, `getLatestLedger` inside a GET route handler kept returning a ledger several minutes old. The charge server then computed a maximum auth expiration that was too low and rejected every payment ("Auth entry expiration exceeds maximum allowed ledger"). With stellar-sdk 15 this never showed, because it used axios, which Next does not patch.

**Fix.** Every API route sets `export const fetchCache = "force-no-store"`, and the root layout sets `default-no-store`. Chain reads are now always live.

**Suggestion.** stellar-sdk could send `cache: "no-store"` on RPC requests, or vary the request id. Otherwise every Next.js app that upgrades to stellar-sdk 16 can read stale chain state silently.

### 8. Smaller items

- The README lists a `sourceAccount` option on the channel client, but the 0.7.1 type definitions do not include it.
- Pinning the client network (`network: 'stellar:pubnet'`) is optional, and so is the server's `recipient`/`currency` check. Both deserve to be the default on mainnet.

## Failure paths and how Cogladius behaves

| path | behaviour | test |
|---|---|---|
| Provider never closes | Funder runs `startClose`, then `refund` after the waiting period. The provider's sweeper closes first if it can. | `examples/close-session.ts --force-start / --refund` |
| Close on a stale commitment | Impossible from our side. The ledger only ever holds the highest commitment, and lower or equal ones are dropped. | `commitment.test.ts` |
| Commitment store lost mid-session | Bounded re-sign (above) or funder exit | `session.test.ts` |
| Replayed commitment | Rejected by the channel server (challenge store and monotonicity). The ledger ignores equal amounts. | `commitment.test.ts` |
| RPC gaps during simulation or confirmation | Retry with backoff. A timeout is reported as *may still land*, never as failure. | `rpc.test.ts` |
| Close broadcast times out | The ledger is not marked closed; the next close attempt or the sweeper retries | observed on mainnet, see edge 1 |

## Numbers from the mainnet run

These are from one reference-agent run, recorded in `evidence/MAINNET_EVIDENCE.md`:

- One charge payment of 0.01 XLM: 1 transaction, fee paid by the provider through the fee bump.
- One session: open (0.3 XLM deposit), 20 commitments of 0.001 XLM each, close (0.02 XLM to the provider, 0.28 XLM back to the agent). That is **2 transactions for 20 payments**.
