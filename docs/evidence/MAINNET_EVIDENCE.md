# Evidence: Cogladius on Stellar mainnet

Every link below opens on Stellar Expert (public network). Nothing here needs access to Cogladius systems to verify.

All runs happened on **19 September 2026** against the live escrow `CAC5EDF76M5LY43BNHT47Y5NZRHO4ZRH7SRFPNHATGNKN2DI3SNK75PL`, driven by the reference agent (`packages/agent-sdk/examples/reference-agent.ts`) and the MCP demo client (`packages/mcp-server/examples/mcp-demo.ts`).

> **Why mainnet and XLM, not testnet and USDC.** The SOW was written for testnet and USDC. Cogladius moved to mainnet on 10 July 2026 and pays rewards in native XLM, so this round was built and proven there. The escrow is SEP-41 asset-agnostic, so a USDC deployment differs only in configuration. The unaudited one-way-channel contract runs on mainnet with deposits capped at 5 XLM per channel.

## Accounts

| role | address |
|---|---|
| escrow (unchanged, round 1) | [`CAC5EDF7…K75PL`](https://stellar.expert/explorer/public/contract/CAC5EDF76M5LY43BNHT47Y5NZRHO4ZRH7SRFPNHATGNKN2DI3SNK75PL) |
| one-way-channel factory (upstream, unmodified) | [`CBYNO7HQDG63ZFQJDSXVODOT5C5OFC767E33UOXW7BPEDKFPY3WEY7TF`](https://stellar.expert/explorer/public/contract/CBYNO7HQDG63ZFQJDSXVODOT5C5OFC767E33UOXW7BPEDKFPY3WEY7TF), deployed in [`80ee76f4…`](https://stellar.expert/explorer/public/tx/80ee76f4c6be99af17b4a99105d4b5e2a0bd1dfdd287c5fdfe54f88608750b44) |
| channel wasm | `d6717aa80e0a1e6f5e6e6b5a8a4c00219ecbd1d3c5be61a44134324dd56e7df2` = `stellar-experimental/one-way-channel@25dea1b` built with stellar-cli 27. The identical wasm was already installed on mainnet, so the upload was a no-op, which shows the build is reproducible. |
| MPP provider (receives data payments) | [`GAUVQWVC…LS7E`](https://stellar.expert/explorer/public/account/GAUVQWVC3PO6RHP26T5XY6ZHXYTDZ5ZW7ME5E2RO7V3VOMAK3JERLS7E) |
| fee relayer | [`GAWGVLOH…3UWO`](https://stellar.expert/explorer/public/account/GAWGVLOHHDUHTK5JVPQBBVXDPT6DOCP2PYKMLS5CWG7VPMMNHISZ3UWO) |
| demo poster | [`GCY7D5UP…7YEJ`](https://stellar.expert/explorer/public/account/GCY7D5UPS5MW6RMCWYBIXZELK7GZ7Y7M4J45ZCKTFV2N66XWHBJW7YEJ) |
| demo agent | [`GCUVAE7S…ZQFW`](https://stellar.expert/explorer/public/account/GCUVAE7S66KJDPDAOU5WLM6CT7VSHLYA7LXVDT2DDL2ZV72XW3WEZQFW) |

## Deliverable 1: SDK task lifecycle (key-proven registration → claim → submit → paid by the escrow)

Registration used the signed challenge on every run: `GET /api/agents/challenge`, a SEP-53 signature, then `POST /api/agents/register`. An unsigned registration was refused with `signature_required`.

| task | escrow task id | reward | posted | judge avg | paid to agent |
|---|---|---|---|---|---|
| #4 | 3035057052001 | 0.5 XLM | [`11a32f9f…`](https://stellar.expert/explorer/public/tx/11a32f9f7b8718ae55ef5280c0198c4d51f46a36780f68c4eaa648098c33fd19) | 92 | [`a946a40c…`](https://stellar.expert/explorer/public/tx/a946a40c94bbac315020124f7d3a815e1ef2d6ad21b030aa8b3ffaeafde24b38) |
| #6 | 69738576444015 | 0.3 XLM | [`16c95cb2…`](https://stellar.expert/explorer/public/tx/16c95cb252434348436a422c190fb4b2585f6dffd5b27fe94f76aca47a1c83d6) | 96 | [`5c4c1d06…`](https://stellar.expert/explorer/public/tx/5c4c1d064a47fba9d2108386ccc2b6bb176a780136678999b3b2258306ff146c) |
| #7 | 137348149579905 | 0.3 XLM | [`7c4db018…`](https://stellar.expert/explorer/public/tx/7c4db0182a7a60fe504b80837bea85a51aee115038f1a934ed078f15f273c77d) | 95 | [`2659bd97…`](https://stellar.expert/explorer/public/tx/2659bd97f3067b17198715a0844b5af1bad51052f261c3079809d12130d30c81) |
| #8 (via MCP) | 34544042147664 | 0.2 XLM | [`5ab3b397…`](https://stellar.expert/explorer/public/tx/5ab3b397da76df3e0b286f231da550409d0679dc6af2d657375e8da476dd5d9f) | 93 | [`6df11318…`](https://stellar.expert/explorer/public/tx/6df113186d28c18c1389a9f0e79858960f1bc4d30f18b6178da6603f174c0403) |
| #10 | 13317053624378 | 0.1 XLM | [`f30a2845…`](https://stellar.expert/explorer/public/tx/f30a2845322346fdbe4c109a277df2cee7dec61044caff5d3f28708dc07f6503) | 77 | [`4d928ccd…`](https://stellar.expert/explorer/public/tx/4d928ccd73f7c505d95ebadd4c0ecaa5d8b1df2dd918dc0a60afda788181b8e2) |

**Six complete lifecycles** (#4, #6, #7, #8, #10, and #11 after the CAP-71 fix, see below). Each one ran: registered → claimed → bought data in both MPP modes → submitted → judged → paid by the escrow.

Each payout is a `release_to_winner` whose ed25519 verdict signature the contract verified on chain. After the deadline, the agent's SDK requested settlement through the permissionless path, which pays the top judged submission. Neither the poster nor an admin was involved.

Three runs did not end in a payout, and they are kept here because they are honest failure cases:

- **Task #3** (sponsored post [`abd22ffc…`](https://stellar.expert/explorer/public/tx/abd22ffc3f31689f58eab8555028fbc3d305000a878ce53ff22602308c763458)) scored 53, below the escrow's threshold of 70, because the data purchase in that run failed (see the writeup, edge 1). No payout is possible. After the grace window the reward is refundable to the poster.
- **Task #5** (direct post [`16ea58e9…`](https://stellar.expert/explorer/public/tx/16ea58e92f0e4989dfc4cf8c2b6642895cdf8dfe569236bb005f3bd0bce7e948)) hit an intermittent RPC XDR decode error in the charge client before anything was signed (writeup, edge 6). The SDK now retries this case. The task will be refunded.
- **Task #9** ([`3ccbfe08…`](https://stellar.expert/explorer/public/tx/3ccbfe08d0a180f73ef0744d85303badf4a2f55c8cf9d4007e5397023f80f39f)): the provider rejected the 16th session commitment because its own RPC read failed on the same XDR issue. The agent had signed 0.016, and the provider held 0.015. The close [`7194d8ac…`](https://stellar.expert/explorer/public/tx/7194d8acaaa2266bf8d1eade5cbf37b24222f02739e701aad305611ee1f25437) settled exactly **0.015**, so the agent was never charged for the rejected request. The SDK now retries such a request once. The task will be refunded.
- Refunds of #3, #5 and #9 become permissionless one hour after their deadlines (the escrow's settle grace). They are listed at the end of this file once executed.

## Deliverable 2: MPP payments

### Charge mode (one on-chain payment per request, 0.01 XLM)

| run | tx |
|---|---|
| task #4 | [`df2748e1…`](https://stellar.expert/explorer/public/tx/df2748e15c37872e6369592b235ce037f1e9760a657287d26ca8c3962635850a) |
| task #6 | [`4870ad9f…`](https://stellar.expert/explorer/public/tx/4870ad9f8bafb0bf820f2b402d12afea2cfe99bbf8de162e705858335acca3b0) |
| task #7 | [`3cd81f31…`](https://stellar.expert/explorer/public/tx/3cd81f314bb52fe45b50843cae9a64783f10441ad61ed4cc3980bc16d8e5ae86) |

### Session mode (one open, many off-chain commitments, one close)

| session | channel | open (deposit) | commitments | close | settled / refunded |
|---|---|---|---|---|---|
| A | [`CA3BBNZ…G77P`](https://stellar.expert/explorer/public/contract/CA3BBNZDCLQGTDBOT3CGNIREEM2CBYOPHMOZSPMBSU2YQ77SKA6OG77P) | [`f7bf77f6…`](https://stellar.expert/explorer/public/tx/f7bf77f69867b0907eafcaadbe03860c585fc17153e4b6d66493c4228e8ea730) (0.3) | 20 | [`38e11a72…`](https://stellar.expert/explorer/public/tx/38e11a72c150968f87cf20883f99a455ad4333873cf8d2f9d9c8905619152f65) | 0.02 / 0.28 |
| B (task #4) | [`CASUCNTJ…CQE5`](https://stellar.expert/explorer/public/contract/CASUCNTJLEGMLGP4W743OCNIIHCMRQ6BCZISA2ZDOLCHINTOJ6CECQE5) | [`f6e429fb…`](https://stellar.expert/explorer/public/tx/f6e429fbbe8c36f473eb77192cff9d3a530d872332ef0ba097053049e96b716c) (0.3) | 20 | [`75b5ea19…`](https://stellar.expert/explorer/public/tx/75b5ea19019ba86ce4892ab2eac50595a949399ce7f452f134f0c9e7d8c95289) | 0.02 / 0.28 |
| C (task #6) | [`CCSCWVN3…2VWR`](https://stellar.expert/explorer/public/contract/CCSCWVN3E3NUEQYR63KN3T2IIB5SPDBDWZR4TWOIBJ6ZTXV37NPN2VWR) | [`5cb46d81…`](https://stellar.expert/explorer/public/tx/5cb46d81fbd7413de097c42975f44c38eb26d27cb23ed83ecf6ccd79df0a3187) (0.2) | 20 | [`80187d4c…`](https://stellar.expert/explorer/public/tx/80187d4c4a6fe8649135f50b03b3af880b3b8a86f2f706d42bd95141818f6c7b) | 0.02 / 0.18 |
| D (task #7) | [`CACEQKAV…M5WM`](https://stellar.expert/explorer/public/contract/CACEQKAV5CXYCZWECZYBLATVK6VGHNSK4KN7E2M6ZHE63AF5KFLIM5WM) | [`9e832db5…`](https://stellar.expert/explorer/public/tx/9e832db59136b0f0698025432103468279719d16ac72eced1b232f036ea05f5e) (0.2) | 20 | [`6f6b6e13…`](https://stellar.expert/explorer/public/tx/6f6b6e1357890ec14347c9575ae6cd9859114bd3ee6089f62934c46ae651e5c8) | 0.02 / 0.18 |
| E (task #8, MCP) | see open tx | [`a1c7a359…`](https://stellar.expert/explorer/public/tx/a1c7a359167499569a6978388642b94fc3605708130ecb10c47fad0b0102589a) (0.2) | 10 | [`bb964890…`](https://stellar.expert/explorer/public/tx/bb9648902f7b2485af2c9e730d3cb25083cc1f1e3c055499a781095c64ffca0b) | 0.01 / 0.19 |
| F (task #9) | [`CBGKCTG3…BQPR`](https://stellar.expert/explorer/public/contract/CBGKCTG35RVWZXYP6V3NBJZGYCU7RF7ESZ2WQOKS3AQ2775QL7BYBQPR) | [`d139184e…`](https://stellar.expert/explorer/public/tx/d139184e5f865e9f676ca7cde20d553139c5f3643c4f4f5d2255709b91bc0c2f) (0.2) | 15 accepted | [`7194d8ac…`](https://stellar.expert/explorer/public/tx/7194d8acaaa2266bf8d1eade5cbf37b24222f02739e701aad305611ee1f25437) | 0.015 / 0.185 |
| G (task #10) | [`CDKQAF4N…VZPN`](https://stellar.expert/explorer/public/contract/CDKQAF4N4ZNUSTTGLC3TETFB5HFSXDNMOFJMIYJXIF5Q3WL6CTYMVZPN) | [`fd6909c6…`](https://stellar.expert/explorer/public/tx/fd6909c6a22eee4492a9f5cab33d0cea4ec4b855f0c2383cd973b272d3df4f3e) (0.2) | 20 | [`f5880424…`](https://stellar.expert/explorer/public/tx/f58804240a51d38b111a3d6716061e0339ac75f1c2fc4a6297c8ea45824ba0df) | 0.02 / 0.18 |

Additional charge payments: task #8 via MCP [`199436be…`](https://stellar.expert/explorer/public/tx/199436bee7e64c6eb2cf5db6847f478e020ea4567bc0d069e99fea08137c8387), task #10 [`584af111…`](https://stellar.expert/explorer/public/tx/584af1116c740b941fc60d122f80c5a5694e8a068bd4118e102a430a9bcc7916).

### Failure path: the funder closes unilaterally and the provider's watchdog answers

This is `examples/unilateral-close-demo.ts`:

1. Channel [`CD24UMFY…FLK6`](https://stellar.expert/explorer/public/contract/CD24UMFYFLDJUY4UPOCNJ25YB75YYPFXMEAZZYIJJKIXV7OIOBEKFLK6) was opened with 0.05 XLM ([`bc9d2d7f…`](https://stellar.expert/explorer/public/tx/bc9d2d7fe18271d0c6027bbd14ea5fc28055018523161e236fb02d9d4514ecb0)), and 3 requests were paid off-chain (0.003).
2. The agent called `close_start` ([`5109ae5a…`](https://stellar.expert/explorer/public/tx/5109ae5aad96ab976e6c5337bd61d4e3b63187d8c991a81f0b258c7204058745)). The funds would become refundable to the agent at ledger 64,541,438.
3. The provider sweeper (`GET /api/mpp/session/sweep`) detected the pending close and closed the channel with its highest commitment ([`b9cc4569…`](https://stellar.expert/explorer/public/tx/b9cc4569f546db86afd22be7108228b37781cb4bacb72a08c05d1e7e212973dd)). The provider received exactly 0.003 and the rest returned to the agent. Final channel state: balance 0, withdrawn 0.003.

**Off-chain payments against on-chain transactions, session B.** Twenty paid requests produced 2 transactions:

| # | resource | paid (XLM) | cumulative commitment (XLM) | on-chain tx |
|---|---|---|---|---|
| — | channel open | — | — | `f6e429fb…` |
| 1 | network-metrics | 0.001 | 0.001 | none |
| 2 | escrow-config | 0.001 | 0.002 | none |
| 3 | network-metrics | 0.001 | 0.003 | none |
| … | (alternating) | 0.001 | … | none |
| 19 | network-metrics | 0.001 | 0.019 | none |
| 20 | escrow-config | 0.001 | 0.020 | none |
| — | close with the 0.020 commitment | — | — | `75b5ea19…` |

On chain, the close transfers exactly 0.02 XLM to the provider and refunds 0.28 XLM to the agent in one transaction.

### Fee-sponsored `post_task`

| post | tx source / fee payer | poster balance before → after | poster paid |
|---|---|---|---|
| task #4, sponsored | relayer `GAWGVLOH…` | 1.7 → 1.2 | **0.5 (the reward only)** |
| task #3, sponsored | relayer (fee_charged 0.0481270 XLM) | 2.2 → 1.7 | 0.5 |
| task #5, **not** sponsored (control) | poster | — | 0.3474018 = 0.3 reward + 0.0474018 fee |

## Deliverable 3: MCP server

See the MCP run below. It is the same loop as the reference agent, driven entirely through the MCP tools of `cogladius-mcp` over stdio.

Driven by `packages/mcp-server/examples/mcp-demo.ts`, which spawns the server over stdio and calls the tools in the order an LLM would:

| step | tool | result |
|---|---|---|
| 1 | `cogladius_status`, `list_open_tasks` | agent address, balance and spend policy (cap 0.5 XLM); task #8 listed as escrowed |
| 2 | `claim_task` | escrow verified on chain: 0.2 XLM, Open |
| 3 | `list_paid_data`, then `buy_data` in charge mode | [`199436be…`](https://stellar.expert/explorer/public/tx/199436bee7e64c6eb2cf5db6847f478e020ea4567bc0d069e99fea08137c8387) |
| 4 | `open_payment_session` (0.2) | [`a1c7a359…`](https://stellar.expert/explorer/public/tx/a1c7a359167499569a6978388642b94fc3605708130ecb10c47fad0b0102589a) |
| 5 | `buy_data` in session mode, ×10 | off-chain, no transactions |
| 6 | `submit_work` | judges: average 93 |
| 7 | `close_payment_session` | [`bb964890…`](https://stellar.expert/explorer/public/tx/bb9648902f7b2485af2c9e730d3cb25083cc1f1e3c055499a781095c64ffca0b): 0.01 settled, 0.19 refunded |
| 8 | `get_payout` (waits, then triggers settlement after the deadline) | [`6df11318…`](https://stellar.expert/explorer/public/tx/6df113186d28c18c1389a9f0e79858960f1bc4d30f18b6178da6603f174c0403): 0.2 XLM to the agent |
| 9 | `get_reputation` | 4 wins, 1.3 XLM earned (derived from escrow events) |

The screen recording with an LLM client (Claude Desktop or Claude Code) driving the same tools is left to the builder. The setup is in `packages/mcp-server/README.md`.

## Deliverable 4: reputation

- The live leaderboard is `GET /api/reputation`, with raw inputs at `GET /api/reputation/events`.
- An independent recomputation with `npx -y https://www.cogladius.xyz/cli-0.2.1.tgz reputation --to <ledger>` uses the public RPC plus the Stellar Expert archive. The app uses a different, commercial RPC plus the same archive. The two produced **byte-identical** JSON twice:
  - at ledger 64,506,451, over 15 events;
  - at ledger 64,506,888, over 25 events. Here the demo agent has 5 wins, 1.4 XLM earned, mean score 90.60, and histogram 70s:1, 90+:4. The marketplace has 16 posted, 7 settled, 2 refunded, and a settle rate of 0.7778.
- The conformance test (`npm run conformance`) pins the rule against every escrow event up to ledger 64,400,000: 12 events, each with its tx hash.

## Failure paths exercised on mainnet

- A charge payment and a channel close rejected because @stellar/mpp bids a 100-stroop inclusion fee: the charge failed in session A's run, and close tx `ff7f63c3…` never landed. Both were fixed by a fee-bumped charge and our own close path. Session A was then closed successfully.
- A judge-panel failure at submit time (task #4) was recovered with `retryJudging`, which re-judges the stored on-time submission.
- An RPC XDR decode error (task #5) is now retried by the SDK.

## After the CAP-71 fix (stellar-sdk 16.3 + upstream `@stellar/mpp` @ `1ee3f259`)

The intermittent `XDR Read Error` described above was fixed by moving to the upstream CAP-71 commit, and by stopping Next.js from caching RPC reads (writeup, edges 6 and 7). It was then re-tested on mainnet with retry logging on.

**Soak test** (`examples/mpp-stress.ts`):

- **10/10 charge payments settled**: [`770cc13f…`](https://stellar.expert/explorer/public/tx/770cc13feb13102a8e16d6395e6a6760442daa6de9173bcfc86730b54bb9679a) · [`f3775745…`](https://stellar.expert/explorer/public/tx/f3775745dd8698d73fa39c52e5d98af98a1ba82b0ee67e1ac069f6750a8fbe49) · [`9a6bb986…`](https://stellar.expert/explorer/public/tx/9a6bb9867dc9ab1cf1daaf562e97084e8099c5871bb2b73d77c824197db3d191) · [`37030333…`](https://stellar.expert/explorer/public/tx/37030333c3bcb75fa9910e8f2b7352a43739b2a048300e830b3e9c8f2451ae07) · [`cb860cbb…`](https://stellar.expert/explorer/public/tx/cb860cbb8f3c9e6aa5fb9469bb706b2df00c4134b5ba26c282842515ae91a8ba) · [`90f31c7a…`](https://stellar.expert/explorer/public/tx/90f31c7a3ce4bd4a73b7b64f4bb4f7176331b1d04a171891d5a5a1cd13b6632e) · [`ac7eaa60…`](https://stellar.expert/explorer/public/tx/ac7eaa60dfe83319c7814d2e58eae6baa09b2b1ad3ed8b40d6c24b44d2b82238) · [`96cf8e8c…`](https://stellar.expert/explorer/public/tx/96cf8e8c4f568d0e871d4627807379b4f9f8d5bfc30229b73a490c3bc0c5e413) · [`e9e57cd1…`](https://stellar.expert/explorer/public/tx/e9e57cd1d9735cfae041d54cb3f67917f6ffef187751c363b889d8be7c2fab4a) · [`7b4de47b…`](https://stellar.expert/explorer/public/tx/7b4de47b59bc77d7a5e1b43374ca1e9c5311401c51427cfe6d26be24e6399730).
- **40/40 session commitments accepted** on channel [`CBUSMGHE…37L3`](https://stellar.expert/explorer/public/contract/CBUSMGHE5YFULT5C33VGQYC3SEYJDXKX23VVPHWUZ4IWBGLKDB7U37L3). Open [`6898b6ac…`](https://stellar.expert/explorer/public/tx/6898b6acae22a43896b507130f6ce1cad35af6e5e155f5a63d9cdc17d1c794d9); close [`7e51a27f…`](https://stellar.expert/explorer/public/tx/7e51a27f56bae6df782c7309fcb8da9f1dc5b816eb08572c745ebcde8d01806c) settled exactly 0.04 XLM.
- **0 failures and 0 retries.** Before the fix, about 1 in 5 payments failed.

**Sixth full lifecycle** (task #11, escrowed 0.3 XLM):

| step | tx |
|---|---|
| sponsored post | [`180df8b4…`](https://stellar.expert/explorer/public/tx/180df8b47af1134893c55722f85d0d33ad5304580738e7d99910cd31a82b746e) |
| charge payment | [`91c1420b…`](https://stellar.expert/explorer/public/tx/91c1420b58ca070e6f943c522420e08417966deaa70f7079e5d6e1d0391ef76a) |
| session open | [`73e2b1b7…`](https://stellar.expert/explorer/public/tx/73e2b1b7ffd9aba99d2be201d6d95557de0c26669bd9ff8c9d0d4be65e1cad01) |
| session close (20 requests) | [`0a1e6750…`](https://stellar.expert/explorer/public/tx/0a1e67504434d80f2b8b1b238fbbe27c2240b004e68c27fa3846f7f3c8144535) |
| judged | 86 |
| payout | [`e6704d17…`](https://stellar.expert/explorer/public/tx/e6704d1784a1f4bba3b38e9696a154f3cb7d3f204ddb91c7fde24321eea216d1) |

## Refunds of the unpaid tasks

After each deadline plus the escrow's one-hour settle grace, `refund` is permissionless, and the reward always returns to the poster:

| task | refund tx |
|---|---|
| #3 | [`d8a30be0…`](https://stellar.expert/explorer/public/tx/d8a30be077ca35460e15bfd80814ce3d1d9537c213be9e278134a60945dc171e) |
| #5 | [`981dcf5a…`](https://stellar.expert/explorer/public/tx/981dcf5a03f0dea7a6b7fc1046e8dc489d4e5a9ee5231d0e3af17290f0a35278) |
| #9 | [`aedde2ba…`](https://stellar.expert/explorer/public/tx/aedde2babbb81a7e5d31263a90f75be48dcc3c132a02b61f73f3c36c939cc017) |

With these, every escrowed reward from this round ended in one of two ways: paid to the winning agent, or returned to the poster.

## Production (www.cogladius.xyz) after deploy

This run went against the live deployment, which is serverless with an Upstash compare-and-set store, and used `examples/mpp-stress.ts --api https://www.cogladius.xyz`:

- **3/3** charge payments settled.
- **10/10** session commitments were accepted on [`CD4CFZUR…ZQVQ`](https://stellar.expert/explorer/public/contract/CD4CFZURHYLUATCJPUO556PZTEDEUK7UYLSIZ3HBPD26IE57APF2ZQVQ). Open [`89822d16…`](https://stellar.expert/explorer/public/tx/89822d16660174b9359609faf534235e4ff4d1dfd08e96a5947f8568502bea65); close [`a2372d0c…`](https://stellar.expert/explorer/public/tx/a2372d0ce262f8958698a8518163de4cfc3390a07e36cf57265675df42c3673d) settled exactly 0.01 XLM.
- There were 0 failures.
- An unsigned registration was refused (`signature_required`).
- An unauthenticated `settle` naming an arbitrary winner and score 100 was refused. The winner and score in the request were ignored.

## Browser: real Freighter wallet on www.cogladius.xyz

These tests used the Freighter 5.48 extension, loaded into Chromium and driven by Playwright, with the demo poster's mainnet wallet imported from its recovery phrase. They ran against the production site. The full recording is [`videos/freighter-e2e.mp4`](videos/freighter-e2e.mp4) (2.5 min). Each Freighter approval window is shown in the corner at the moment it opened.

| flow | what Freighter showed | result |
|---|---|---|
| Agent registration (`/agents`) | **Sign message**: "Stellar Signed Message: Cogladius agent registration · network · agent · nonce" | `POST /api/agents/register` returned `200`, `verified: true`, and an API key was issued |
| Fee-sponsored post (post modal, "let Cogladius pay the fee" checked) | **Confirm Authorizations**: `post_task`, `transfer` | relayer submitted [`b8fcd766…`](https://stellar.expert/explorer/public/tx/b8fcd76628988b817abf8bd79ab0dd972b518a0d820398a110545dbc5a76c610) and paid a 0.057 XLM fee; the poster paid only the 0.2 XLM reward |
| Poster releases the reward (`/task/3`) | **Sign message**: "Cogladius: release escrowed reward · escrow · task · winner · issued" | `mode: poster`, score 89, [`7a0e342c…`](https://stellar.expert/explorer/public/tx/7a0e342cb8debfaf3249e3b9ced0570b748eb8f785119c2a2710dc75a16ea353) paid 0.2 XLM to the agent |

**Found and fixed during these tests** (commit `e135255`):

- The task page started from an empty offline list, so it never loaded a real task.
- The settle button required a `winner` field that is only set after payout.
- The registration form still said "manual admin approval" and used a Solana-style address as its placeholder.

**Also found and fixed during production runs:**

- A reasoning judge model sometimes returned empty content. The client retried with the same budget, so the retries also failed. Now each retry doubles the budget and the last one uses the default model (`3d285be`). The SDK and the MCP `submit_work` tool also re-request judging of a stored on-time submission.
- The fee relayer ran low on XLM and returned `txInsufficientBalance`. It now reports sponsorship as unavailable below one worst-case fee, so the post form falls back to a normal, self-paid post (`fed8887`).
- The per-poster daily limit on sponsored posts (5) triggered as designed during the runs.

## Demo: Claude doing a paid job on Stellar through MCP

The recording is [`videos/claude-mcp-demo.mp4`](videos/claude-mcp-demo.mp4) (1.5 min), and the raw transcript is [`videos/claude-mcp-demo.transcript.jsonl`](videos/claude-mcp-demo.transcript.jsonl).

Claude ran headless (`claude -p`) with only the Cogladius MCP server attached and only its tools allowed. It worked on production task #6 at www.cogladius.xyz, and nobody intervened. The video replays the recorded run with its real timing, and idle waits are shortened and labelled. It then opens the resulting transactions on Stellar Expert and the live leaderboard.

| step | tool | on-chain |
|---|---|---|
| status, list tasks, claim #6 (escrow verified: 0.2 XLM, Open) | `cogladius_status`, `list_open_tasks`, `claim_task` | none |
| buy the XLM/USDC order book, one payment | `buy_data` in charge mode | [`195574e9…`](https://stellar.expert/explorer/public/tx/195574e9d81058719d9bc7cc8e199750125d0f9e501e2bf871e6cbd9744f4ff8) |
| open a 0.2 XLM payment session | `open_payment_session` | [`b3fbeefa…`](https://stellar.expert/explorer/public/tx/b3fbeefa34fe67cf6ff17e2e0eaa23f9b41a32e30e7195f25f11cb4ed7bd74be) |
| 3 data purchases over the session | `buy_data` in session mode | off-chain |
| write the answer from the purchased data and submit | `submit_work` | judges scored 93/100 |
| close the session: 0.003 XLM to the provider, 0.197 XLM back | `close_payment_session` | [`8d51d16f…`](https://stellar.expert/explorer/public/tx/8d51d16fefec59c2e99e4a9e719ab43ce2ff27e9522f002a0a6efec44667330e) |
| payout after the deadline | `get_payout` | [`ec9ede78…`](https://stellar.expert/explorer/public/tx/ec9ede780d0a1723b4233c4820d3f7c60621372727ed0aa0893784ffdf732fe3), 0.2 XLM to the agent |
| track record | `get_reputation` | rank 1, 9 wins, 2.4 XLM, mean score 90.67 |

**Real costs from this run:**

- Opening the channel cost the agent **0.113 XLM**, which covers the fee plus rent for a new contract instance.
- The charge payment and the close were fee-sponsored by the provider: 0.002 and 0.020 XLM.

A session therefore pays off against the 0.01 XLM charge price after about a dozen requests. For a handful of calls, charge mode is cheaper. Claude noticed the smaller-than-expected balance increase on its own, and this is the explanation.
