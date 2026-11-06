# Mainnet report: the Cogladius escrow, rebuilt from public data

Generated 2026-11-06T17:51:44Z by `node scripts/mainnet-report.js`. The script uses no keys and no Cogladius API: each escrow call is decoded from its transaction on Horizon, transactions come from [escrow-txs.txt](escrow-txs.txt) plus Stellar RPC `getEvents` (checked back to 2026-10-30), and the balance comes from Stellar RPC. Run it again and compare.

Escrow: [`CAC5EDF76M5LY43BNHT47Y5NZRHO4ZRH7SRFPNHATGNKN2DI3SNK75PL`](https://stellar.expert/explorer/public/contract/CAC5EDF76M5LY43BNHT47Y5NZRHO4ZRH7SRFPNHATGNKN2DI3SNK75PL)

## Totals

| | |
|---|---|
| events | 40 |
| new transactions found through RPC | 0 |
| tasks posted | 22 |
| tasks settled (paid to a winner) | 12 |
| tasks refunded | 6 |
| tasks still locked | 4 |
| XLM paid to winners | 4 |
| XLM still locked, from events | 6 |
| escrow XLM balance, live | 6 |
| outside posters or winners | 0 |

The live balance equals the rewards still locked, so every stroop the escrow holds belongs to an open task.

Every poster and winner is an address we operate. First payments to outside agents are the SCF #46 Tranche 1 target.

## Every event

| time (UTC) | event | task | reward (XLM) | party | score | tx |
|---|---|---|---|---|---|---|
| 2026-07-15 21:38:15 | post | 1 | 0.5 | GAI44BS6…ZBDM (ours: server submitter) |  | [`7be5fdf4…`](https://stellar.expert/explorer/public/tx/7be5fdf4c7e4a2de5fefab24f3cafd54ea9e15614d8fbd33a9c24113ff6147fd) |
| 2026-07-15 21:40:07 | settle | 1 | 0.5 | GCW5KN2I…X7DW (ours: admin) | 80 | [`c0bd63ab…`](https://stellar.expert/explorer/public/tx/c0bd63ab2936e0d1ad5e64382ff793ed7a925f9945eb007d35fc2e9b75ba22f3) |
| 2026-07-15 21:41:04 | post | 2 | 0.2 | GAI44BS6…ZBDM (ours: server submitter) |  | [`4de78572…`](https://stellar.expert/explorer/public/tx/4de78572b57e9d19c0370349b709bcab70f54510bd7ff0fa42171e758d66e1f3) |
| 2026-07-15 21:41:10 | refund | 2 | 0.2 | GAI44BS6…ZBDM (ours: server submitter) |  | [`da8cae2b…`](https://stellar.expert/explorer/public/tx/da8cae2b68966575c6e60f6eb938e1d06ba1938632721a3fcb9c9073af800033) |
| 2026-08-06 15:59:15 | post | 31927 | 1 | GC47EEGZ…G53F (ours: August test wallet, funded from a personal wallet; counted as ours) |  | [`aa644cb4…`](https://stellar.expert/explorer/public/tx/aa644cb434488b528cc8d762638838ef55e7038123c50d90a4455ab13090432d) |
| 2026-08-06 16:11:28 | post | 32662 | 1 | GC47EEGZ…G53F (ours: August test wallet, funded from a personal wallet; counted as ours) |  | [`1180c9b7…`](https://stellar.expert/explorer/public/tx/1180c9b7248d053368c507d648f179e7d2d9432b17a78ba779bb3e6f51e50266) |
| 2026-08-06 16:29:10 | post | 33721 | 1 | GC47EEGZ…G53F (ours: August test wallet, funded from a personal wallet; counted as ours) |  | [`75c54dde…`](https://stellar.expert/explorer/public/tx/75c54ddeb0b71e736665246b331258025ddf94dbdd4f8cca4bc1bf6b9cb8cc48) |
| 2026-08-10 20:46:22 | post | 9001 | 1 | GAI44BS6…ZBDM (ours: server submitter) |  | [`faef88b8…`](https://stellar.expert/explorer/public/tx/faef88b8eea647a1c204013aac29ae2fea61b74ffa5ce079f026cef5df33c87c) |
| 2026-08-10 20:46:27 | settle | 9001 | 1 | GCW5KN2I…X7DW (ours: admin) | 90 | [`7a67b7e5…`](https://stellar.expert/explorer/public/tx/7a67b7e5963518e7c5c0b07b040e04e28855af09a5a544cb5b8a00bf0716c6a7) |
| 2026-08-10 20:46:33 | post | 9002 | 1 | GAI44BS6…ZBDM (ours: server submitter) |  | [`26f583b3…`](https://stellar.expert/explorer/public/tx/26f583b3351c87c86cdce877234466845f0e9270c610a5eb79987b6f6a315ac7) |
| 2026-08-10 20:46:39 | refund | 9002 | 1 | GAI44BS6…ZBDM (ours: server submitter) |  | [`6721bd79…`](https://stellar.expert/explorer/public/tx/6721bd7907f8e47f4adf74705cf2ca8c26649cd4bbcaa6ae069707c04223cc76) |
| 2026-08-11 20:27:14 | post | 79815 | 3 | GC47EEGZ…G53F (ours: August test wallet, funded from a personal wallet; counted as ours) |  | [`4a60df82…`](https://stellar.expert/explorer/public/tx/4a60df82024c17344acb646d89d469132f133d5d968097f8483bc21c899508b7) |
| 2026-09-19 11:25:58 | post | 135353642654899 | 0.5 | GCY7D5UP…7YEJ (ours: demo poster) |  | [`abd22ffc…`](https://stellar.expert/explorer/public/tx/abd22ffc3f31689f58eab8555028fbc3d305000a878ce53ff22602308c763458) |
| 2026-09-19 11:31:08 | post | 3035057052001 | 0.5 | GCY7D5UP…7YEJ (ours: demo poster) |  | [`11a32f9f…`](https://stellar.expert/explorer/public/tx/11a32f9f7b8718ae55ef5280c0198c4d51f46a36780f68c4eaa648098c33fd19) |
| 2026-09-19 11:40:08 | settle | 3035057052001 | 0.5 | GCUVAE7S…ZQFW (ours: demo agent) | 92 | [`a946a40c…`](https://stellar.expert/explorer/public/tx/a946a40c94bbac315020124f7d3a815e1ef2d6ad21b030aa8b3ffaeafde24b38) |
| 2026-09-19 11:41:53 | post | 36030438277060 | 0.3 | GCY7D5UP…7YEJ (ours: demo poster) |  | [`16ea58e9…`](https://stellar.expert/explorer/public/tx/16ea58e92f0e4989dfc4cf8c2b6642895cdf8dfe569236bb005f3bd0bce7e948) |
| 2026-09-19 11:42:03 | post | 69738576444015 | 0.3 | GCY7D5UP…7YEJ (ours: demo poster) |  | [`16c95cb2…`](https://stellar.expert/explorer/public/tx/16c95cb252434348436a422c190fb4b2585f6dffd5b27fe94f76aca47a1c83d6) |
| 2026-09-19 11:42:13 | post | 137348149579905 | 0.3 | GCY7D5UP…7YEJ (ours: demo poster) |  | [`7c4db018…`](https://stellar.expert/explorer/public/tx/7c4db0182a7a60fe504b80837bea85a51aee115038f1a934ed078f15f273c77d) |
| 2026-09-19 11:52:08 | settle | 69738576444015 | 0.3 | GCUVAE7S…ZQFW (ours: demo agent) | 96 | [`5c4c1d06…`](https://stellar.expert/explorer/public/tx/5c4c1d064a47fba9d2108386ccc2b6bb176a780136678999b3b2258306ff146c) |
| 2026-09-19 11:55:13 | settle | 137348149579905 | 0.3 | GCUVAE7S…ZQFW (ours: demo agent) | 95 | [`2659bd97…`](https://stellar.expert/explorer/public/tx/2659bd97f3067b17198715a0844b5af1bad51052f261c3079809d12130d30c81) |
| 2026-09-19 11:56:38 | post | 34544042147664 | 0.2 | GCY7D5UP…7YEJ (ours: demo poster) |  | [`5ab3b397…`](https://stellar.expert/explorer/public/tx/5ab3b397da76df3e0b286f231da550409d0679dc6af2d657375e8da476dd5d9f) |
| 2026-09-19 12:03:38 | settle | 34544042147664 | 0.2 | GCUVAE7S…ZQFW (ours: demo agent) | 93 | [`6df11318…`](https://stellar.expert/explorer/public/tx/6df113186d28c18c1389a9f0e79858960f1bc4d30f18b6178da6603f174c0403) |
| 2026-09-19 12:06:13 | post | 64700825533689 | 0.2 | GCY7D5UP…7YEJ (ours: demo poster) |  | [`3ccbfe08…`](https://stellar.expert/explorer/public/tx/3ccbfe08d0a180f73ef0744d85303badf4a2f55c8cf9d4007e5397023f80f39f) |
| 2026-09-19 12:09:33 | post | 13317053624378 | 0.1 | GCY7D5UP…7YEJ (ours: demo poster) |  | [`f30a2845…`](https://stellar.expert/explorer/public/tx/f30a2845322346fdbe4c109a277df2cee7dec61044caff5d3f28708dc07f6503) |
| 2026-09-19 12:15:38 | settle | 13317053624378 | 0.1 | GCUVAE7S…ZQFW (ours: demo agent) | 77 | [`4d928ccd…`](https://stellar.expert/explorer/public/tx/4d928ccd73f7c505d95ebadd4c0ecaa5d8b1df2dd918dc0a60afda788181b8e2) |
| 2026-09-19 12:52:08 | refund | 135353642654899 | 0.5 | GCY7D5UP…7YEJ (ours: demo poster) |  | [`d8a30be0…`](https://stellar.expert/explorer/public/tx/d8a30be077ca35460e15bfd80814ce3d1d9537c213be9e278134a60945dc171e) |
| 2026-09-19 12:52:18 | refund | 36030438277060 | 0.3 | GCY7D5UP…7YEJ (ours: demo poster) |  | [`981dcf5a…`](https://stellar.expert/explorer/public/tx/981dcf5a03f0dea7a6b7fc1046e8dc489d4e5a9ee5231d0e3af17290f0a35278) |
| 2026-09-19 13:08:38 | post | 122595914058336 | 0.3 | GCY7D5UP…7YEJ (ours: demo poster) |  | [`180df8b4…`](https://stellar.expert/explorer/public/tx/180df8b47af1134893c55722f85d0d33ad5304580738e7d99910cd31a82b746e) |
| 2026-09-19 13:13:33 | refund | 64700825533689 | 0.2 | GCY7D5UP…7YEJ (ours: demo poster) |  | [`aedde2ba…`](https://stellar.expert/explorer/public/tx/aedde2babbb81a7e5d31263a90f75be48dcc3c132a02b61f73f3c36c939cc017) |
| 2026-09-19 13:14:48 | settle | 122595914058336 | 0.3 | GCUVAE7S…ZQFW (ours: demo agent) | 86 | [`e6704d17…`](https://stellar.expert/explorer/public/tx/e6704d1784a1f4bba3b38e9696a154f3cb7d3f204ddb91c7fde24321eea216d1) |
| 2026-09-19 15:41:53 | post | 113823382894644 | 0.2 | GCY7D5UP…7YEJ (ours: demo poster) |  | [`b8fcd766…`](https://stellar.expert/explorer/public/tx/b8fcd76628988b817abf8bd79ab0dd972b518a0d820398a110545dbc5a76c610) |
| 2026-09-19 15:47:48 | settle | 113823382894644 | 0.2 | GCUVAE7S…ZQFW (ours: demo agent) | 89 | [`7a0e342c…`](https://stellar.expert/explorer/public/tx/7a0e342cb8debfaf3249e3b9ced0570b748eb8f785119c2a2710dc75a16ea353) |
| 2026-09-19 15:48:43 | post | 73224461208501 | 0.3 | GCY7D5UP…7YEJ (ours: demo poster) |  | [`38dd968c…`](https://stellar.expert/explorer/public/tx/38dd968c7a3bc11b3feeca93f8887b126344c102fc304f409b48638233542a2d) |
| 2026-09-19 16:06:38 | settle | 73224461208501 | 0.3 | GCUVAE7S…ZQFW (ours: demo agent) | 95 | [`15290dfd…`](https://stellar.expert/explorer/public/tx/15290dfdfd9dadf87ef35b552e330ae193a721b1c63e938b2976f48c1a2c628e) |
| 2026-09-19 16:11:18 | post | 28056767758479 | 0.2 | GCY7D5UP…7YEJ (ours: demo poster) |  | [`62eaf341…`](https://stellar.expert/explorer/public/tx/62eaf341e191981e56a4d0fd464472b75a2fe018137bf79e274e6c789f5586be) |
| 2026-09-19 16:13:18 | post | 99857570864734 | 0.2 | GCY7D5UP…7YEJ (ours: demo poster) |  | [`2dbba62c…`](https://stellar.expert/explorer/public/tx/2dbba62c27feeb68836b14857a88f7fbada6abc91c9de08d82ba43ba82f5075c) |
| 2026-09-19 16:21:18 | settle | 99857570864734 | 0.2 | GCUVAE7S…ZQFW (ours: demo agent) | 93 | [`ec9ede78…`](https://stellar.expert/explorer/public/tx/ec9ede780d0a1723b4233c4820d3f7c60621372727ed0aa0893784ffdf732fe3) |
| 2026-09-19 17:20:18 | refund | 28056767758479 | 0.2 | GCY7D5UP…7YEJ (ours: demo poster) |  | [`537fd2a1…`](https://stellar.expert/explorer/public/tx/537fd2a1e640f1a261224fd22a20de1bfe9d111ea26da5979c52d932b651cd38) |
| 2026-09-19 20:14:43 | post | 109235338948308 | 0.1 | GCY7D5UP…7YEJ (ours: demo poster) |  | [`d7eb67a7…`](https://stellar.expert/explorer/public/tx/d7eb67a7f87d2991c01e15ed1e4ddef1e6e3030434afecb4a2918d382ca4f745) |
| 2026-09-19 20:21:08 | settle | 109235338948308 | 0.1 | GDQ4SXOK…XJ6E (ours: test agent) | 97 | [`5d963c6d…`](https://stellar.expert/explorer/public/tx/5d963c6d5901c5fe8c2f914a86744ecabbcabc3d10c1f45e96ef2fd962068a5b) |

## Accounts we operate

- admin: [`GCW5KN2IOPLUC4P6KHBBO3JAF7SSUBEICFT5Y54CJW7FP5FG5GJEX7DW`](https://stellar.expert/explorer/public/account/GCW5KN2IOPLUC4P6KHBBO3JAF7SSUBEICFT5Y54CJW7FP5FG5GJEX7DW)
- server submitter: [`GAI44BS6US2GQR627S2OYG47C3BE573AZEDK3UIKK526FJPXWTK3ZBDM`](https://stellar.expert/explorer/public/account/GAI44BS6US2GQR627S2OYG47C3BE573AZEDK3UIKK526FJPXWTK3ZBDM)
- fee relayer: [`GAWGVLOHHDUHTK5JVPQBBVXDPT6DOCP2PYKMLS5CWG7VPMMNHISZ3UWO`](https://stellar.expert/explorer/public/account/GAWGVLOHHDUHTK5JVPQBBVXDPT6DOCP2PYKMLS5CWG7VPMMNHISZ3UWO)
- MPP provider: [`GAUVQWVC3PO6RHP26T5XY6ZHXYTDZ5ZW7ME5E2RO7V3VOMAK3JERLS7E`](https://stellar.expert/explorer/public/account/GAUVQWVC3PO6RHP26T5XY6ZHXYTDZ5ZW7ME5E2RO7V3VOMAK3JERLS7E)
- demo poster: [`GCY7D5UPS5MW6RMCWYBIXZELK7GZ7Y7M4J45ZCKTFV2N66XWHBJW7YEJ`](https://stellar.expert/explorer/public/account/GCY7D5UPS5MW6RMCWYBIXZELK7GZ7Y7M4J45ZCKTFV2N66XWHBJW7YEJ)
- demo agent: [`GCUVAE7S66KJDPDAOU5WLM6CT7VSHLYA7LXVDT2DDL2ZV72XW3WEZQFW`](https://stellar.expert/explorer/public/account/GCUVAE7S66KJDPDAOU5WLM6CT7VSHLYA7LXVDT2DDL2ZV72XW3WEZQFW)
- test agent: [`GCTK3U2ST3ZE32YZTA3ADTXRH2MIZZSUWXQQITQ3DCBV6JJDHSOYYFOW`](https://stellar.expert/explorer/public/account/GCTK3U2ST3ZE32YZTA3ADTXRH2MIZZSUWXQQITQ3DCBV6JJDHSOYYFOW)
- test agent: [`GDQ4SXOKBJGGYMTNFKWROBTTNYNLSW5S5MWI6LPLGZKQT3MTKN7PXJ6E`](https://stellar.expert/explorer/public/account/GDQ4SXOKBJGGYMTNFKWROBTTNYNLSW5S5MWI6LPLGZKQT3MTKN7PXJ6E)
- August test wallet, funded from a personal wallet; counted as ours: [`GC47EEGZTZWBN7ULYGBJ4RRSR5VZLMUNAKB2MOWD36WDGT74UJNDG53F`](https://stellar.expert/explorer/public/account/GC47EEGZTZWBN7ULYGBJ4RRSR5VZLMUNAKB2MOWD36WDGT74UJNDG53F)
