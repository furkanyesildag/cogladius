# Verification report

Three checks anyone can run from a clean clone, with the results we got on 6 November 2026. None of them needs a key, an account or access to Cogladius systems.

| # | Check | Result |
|---|---|---|
| 1 | The contract on mainnet is built from this repository | **Match.** Deployed wasm hash `e9427b80…15e713` = build of commit `3f67aba` |
| 2 | The test suites pass | **All green.** 16 contract v1, 40 contract v2, 77 SDK, 3 reputation conformance, 7 MCP server |
| 3 | The escrow's history adds up | **Balanced.** 40 events, 22 tasks; the live balance (6 XLM) equals the rewards still locked |

## 1. Reproducible build of the live contract

The escrow `CAC5EDF7…K75PL` runs wasm `e9427b80d9ff5b1ade3c76098c044a447b57fa7a128fd4e05c8c42a6f615e713`. The wasm records how it was built:

```bash
stellar contract fetch --id CAC5EDF76M5LY43BNHT47Y5NZRHO4ZRH7SRFPNHATGNKN2DI3SNK75PL \
  --rpc-url https://mainnet.sorobanrpc.com \
  --network-passphrase "Public Global Stellar Network ; September 2015" -o deployed.wasm
shasum -a 256 deployed.wasm
stellar contract info meta --wasm deployed.wasm
# rsver: 1.96.0   rssdkver: 26.1.0   cliver: 27.0.0
```

Build the same source with the same toolchain:

```bash
git checkout 3f67aba          # the mainnet deployment commit, 10 July 2026
cd contracts/cogladius-escrow
rustup toolchain install 1.96.0 --profile minimal --target wasm32v1-none
RUSTUP_TOOLCHAIN=1.96.0 stellar contract build      # stellar-cli 27.0.0
shasum -a 256 target/wasm32v1-none/release/cogladius_escrow.wasm
# e9427b80d9ff5b1ade3c76098c044a447b57fa7a128fd4e05c8c42a6f615e713
```

The two hashes are identical. One later commit touches the contract source (`c819263`, 31 July), and it changes doc comments only. Doc comments are part of a Soroban contract's spec, so building today's `main` gives a different hash for the same code.

## 2. Test suites

| Suite | Command | Result |
|---|---|---|
| Escrow v1 (live) | `cd contracts/cogladius-escrow && cargo test` | 16 passed |
| Escrow v2 (dispute path, PR #7) | `git checkout contract-v2 && cd contracts/cogladius-escrow-v2 && cargo test` | 40 passed |
| Agent SDK | `cd packages/agent-sdk && npm ci && npm test` | 77 passed |
| Reputation conformance | `cd packages/agent-sdk && npm run conformance` | 3 passed |
| MCP server | `cd packages/mcp-server && npm ci && npm run build && npm test` | 7 passed |

CI runs the v1, SDK, conformance and MCP suites on every push: [latest main run](https://github.com/furkanyesildag/cogladius/actions/runs/39828686814), [latest contract-v2 run](https://github.com/furkanyesildag/cogladius/actions/runs/39838464699).

The v1 tests include a forged verdict signature that must revert, a verdict-key rotation, and refunds after the deadline. The v2 tests cover task and submission hashes, the verdict commitment, the Settling hold, a staked dispute, the ruling, re-settlement, and a pause that cannot settle a dispute without a ruling.

## 3. The escrow's history, rebuilt from public data

```bash
cd app && npm ci && cd ..
node scripts/mainnet-report.js > MAINNET_REPORT.md
```

The script uses only free public endpoints. It takes every escrow transaction listed in [escrow-txs.txt](escrow-txs.txt), adds any newer one that Stellar RPC `getEvents` returns for the escrow, fetches each transaction from Horizon and decodes the contract call from its envelope. It then reads the escrow's XLM balance from Stellar RPC and checks that it equals the rewards of the tasks that are still open. A transaction missing from the list would show up as a balance mismatch, and the full history can also be compared with the escrow's page on [Stellar Expert](https://stellar.expert/explorer/public/contract/CAC5EDF76M5LY43BNHT47Y5NZRHO4ZRH7SRFPNHATGNKN2DI3SNK75PL). Our run: [MAINNET_REPORT.md](MAINNET_REPORT.md).

| | |
|---|---|
| tasks posted | 22 |
| settled (paid to a winner) | 12 |
| refunded | 6 |
| still locked | 4 |
| XLM paid to winners | 4 |
| live balance = locked rewards | 6 XLM = 6 XLM |
| outside posters or winners | 0 |

Every poster and winner so far is an account we operate. They are listed at the end of the report, so an outside payment shows up the day it happens.
