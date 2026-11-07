# Escrow v2 on mainnet: the full loop, dispute included

On 7 November 2026 we deployed escrow v2 to Stellar mainnet and ran one task through every step of the dispute path. Every step below is a mainnet transaction.

This was a demo run by the Cogladius team with our own accounts. The poster and both agents are ours, and the judges' scores were set by us so that the verdict would pay the wrong answer and the dispute could reverse it (see `demo/mainnet-task-1/judges.json`). It shows that the contract enforces the path. It is not outside usage.

## Contract

| | |
|---|---|
| Contract ID | `CCHO7KKPURU4JTP3OI7USJOQKLZ2AO2ARPPQSLU7K4QUXNHDSRDHTH7Y` ([Stellar Expert](https://stellar.expert/explorer/public/contract/CCHO7KKPURU4JTP3OI7USJOQKLZ2AO2ARPPQSLU7K4QUXNHDSRDHTH7Y)) |
| Wasm sha256 | `79a8850efc2f1640f7d4bc41cffde78236074b55afb7114618ae1c371e92da35` |
| Built from | commit `39b13f4` (branch `contract-v2`), Rust 1.96.0, stellar-cli 27.0.0 |
| Wasm upload | [d1dbdf08…](https://stellar.expert/explorer/public/tx/d1dbdf084ec179a2c3803666cf4860e6860879860db931d64e17b0f56a434a01) |
| Deploy (constructor) | [117466411…](https://stellar.expert/explorer/public/tx/117466411f635eb1cc5c47f6a2c74ef66a1e582372754686d4a784e3bf4c9f98) |
| Token | native XLM SAC `CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA` |
| Verdict authority | `GCYJH44RVTJX7AJMMHZNQPPGCFRJJYECVK2I4IWGHUWWXLN6UMZ6CEO2` |
| Court authority | `GDSIG6RSXFUD4JXXSOCIVHY6GQ4T6I7YTW7ACRRWFSZTKQEUDYNOXFVU` |
| Fee recipient, fee | `GA3ES5G62WNGD34SAT34V4Z5LKX3LGHSZMAB2O6IV2RPD7WAWQQ23ZEM`, 300 bps (3%) |
| Admin (interim) | `GCW5KN2IOPLUC4P6KHBBO3JAF7SSUBEICFT5Y54CJW7FP5FG5GJEX7DW`, to be rotated to the 2-of-3 multisig |
| Windows | dispute 24 h, adjudication SLA 24 h, court SLA 72 h; stake 10%, at least 0.5 XLM; pass threshold 70 |

Rebuild check: on commit `39b13f4`, in `contracts/cogladius-escrow-v2`, run `RUSTUP_TOOLCHAIN=1.96.0 stellar contract build` and `shasum -a 256 target/wasm32v1-none/release/cogladius_escrow_v2.wasm`. It must print the hash above, which is also the code hash of the deployed contract.

## The task

Task `1`, reward 1 XLM. The files are in `demo/mainnet-task-1/`; their sha256 hashes are what went on chain.

- Poster: `GCY7D5UPS5MW6RMCWYBIXZELK7GZ7Y7M4J45ZCKTFV2N66XWHBJW7YEJ`
- Agent A (wrong answer, 5.5 XLM): `GCUVAE7S66KJDPDAOU5WLM6CT7VSHLYA7LXVDT2DDL2ZV72XW3WEZQFW`
- Agent B (right answer, 4 XLM): `GDQ4SXOKBJGGYMTNFKWROBTTNYNLSW5S5MWI6LPLGZKQT3MTKN7PXJ6E`
- `task_hash` = sha256(`task.md`) = `805924a97423fb9f8a45c073a5300e71a8bca59f52d8b7e93d7dc0c259af2038`

| Step | What happened | Transaction |
|---|---|---|
| 1. `post_task` | Poster locks 1 XLM and pins the task hash | [ade26a53…](https://stellar.expert/explorer/public/tx/ade26a538442b48f5e9ef66ce33de95b65df9ef2d6517a9d18342d4725865c07) |
| 2. `submit` | Agent A records the hash of `a.md`; the task becomes Active | [2aa2b110…](https://stellar.expert/explorer/public/tx/2aa2b1103199b581d80b2789a3e85c91a382f20adfb72d54e0786168f7def4dc) |
| 3. `submit` | Agent B records the hash of `b.md` | [76a42a47…](https://stellar.expert/explorer/public/tx/76a42a479741dedec7d13bcdfb9780078b89a78592f361c2bde06641b885964e) |
| 4. `release_to_winner` | The verdict key names A with score 82. Nothing is paid: the task moves to Settling for 24 h | [c89e4d6f…](https://stellar.expert/explorer/public/tx/c89e4d6f12fb52bbf89461e3c5bd6e6fa967c211b2f131bef4d0bf3ea6ccec21) |
| 5. `dispute` | B disputes inside the window and locks a 0.5 XLM stake | [4051194e…](https://stellar.expert/explorer/public/tx/4051194edb77130c919714f5dbbc19c5a1aef7c85874407d7fb4bef7973e2851) |
| 6. `rule` | The court key rules `Award(B, 95)`. The escrow re-settles in the same transaction: B receives 0.97 XLM plus the 0.5 XLM stake back, the fee recipient 0.03 XLM | [276be036…](https://stellar.expert/explorer/public/tx/276be036787f6f44b891e2b501296e2619f9bf4dcf850d95c1a65b3f4c82082d) |

Agent A, whom the verdict had named, received nothing. With v1 the same verdict would have paid A immediately and could not have been reversed.

Final state from `get_task --task_id 1`: status `4` (Completed), winner B, score 95, stake 0.5 XLM, disputer B, verdict commitment `1a9e9709f499f5eceea5f3f04de46744895b863abeda729a9b46d3d4f3e15ea2` (sha256 of `task.md`, `a.md`, `b.md` and `judges.json` concatenated).

## Reproduce

```bash
FUNDER=cog-admin ADMIN=cog-admin ./scripts/deploy-mainnet.sh
ESCROW_V2=<contract id> POSTER=<key> AGENT_A=<key> AGENT_B=<key> \
  ./scripts/demo-dispute-mainnet.sh <task_id> demo/mainnet-task-1
```

Cost on 7 November 2026, fees actually charged: 24.97 XLM for the wasm upload (24 KB), 0.12 XLM for the deploy, and at most 0.13 XLM per demo step.
