# cogladius-escrow-v2

The second version of the Cogladius escrow. It holds a task's reward until a judged submission is paid, and keeps it in the contract long enough for a wrong verdict to be disputed and re-settled. The live v1 contract (`../cogladius-escrow`, `CAC5EDF7…K75PL`) is not modified; v2 deploys at a new address.

What v2 enforces that v1 did not, one line each (the reasoning is in `docs/THREAT_MODEL.md` §1):

| v1 | v2 |
|---|---|
| No record of what was judged | `post_task` pins a `task_hash`; `submit` records each agent's `submission_hash` |
| Verdict is a custom ed25519 message | The verdict authority authorizes `(task_id, winner, score, commitment)` with Soroban native auth |
| Any address the authority signs is paid | The winner must have a recorded submission |
| Payout is immediate; a dispute cannot reverse it | A verdict moves the task to `Settling`; `finalize` pays only after `dispute_window` |
| `flag_disputed` records a dispute, nothing more | `dispute` locks a stake; a separate court authority's `rule` upholds, awards another submitter, or refunds |
| Admin calls `activate` | The first `submit` makes the task Active |
| Work can be refunded one hour after the deadline | Work in progress is locked until `deadline + adjudication_sla + dispute_window`, and a missed SLA can be `escalate`d to the court |
| Verdict key rotates immediately | Authority and admin changes are announced, then applied after 48 hours |
| No fee | `fee_bps`, fixed at deployment and capped at 5%, taken only when a winner is paid and shown in the `settle` event |

## Lifecycle

```text
post_task ─▶ [Open] ─submit─▶ [Active] ─release_to_winner─▶ [Settling] ─finalize─▶ [Completed]
               │                 │  └─escalate─┐                │
               │                 │             ▼                └─dispute─▶ [Disputed] ─rule─▶ [Completed]
               └──── refund ─────┴──────▶ [Refunded] ◀──────────────────────────┘ (ruling: refund)
```

| Function | Who authorizes | When |
|---|---|---|
| `post_task(poster, task_id, reward, deadline, task_hash)` | poster | not paused; deadline in the future |
| `submit(task_id, agent, submission_hash)` | agent | Open or Active, before the deadline; one per agent; not the poster |
| `release_to_winner(task_id, winner, score, commitment)` | verdict authority, over exactly these arguments | Active; winner submitted; `pass_threshold ≤ score ≤ 100` |
| `finalize(task_id)` | anyone | Settling, after `dispute_until` |
| `dispute(task_id, disputer)` | disputer (poster or another submitter); stake = max(`min_dispute_stake`, reward × `dispute_stake_bps`) | Settling, before `dispute_until`; once per task |
| `escalate(task_id, submitter)` | a submitter, no stake | Active with no verdict, between `deadline + adjudication_sla` and that plus `dispute_window` |
| `rule(task_id, ruling, commitment)` | court authority, over exactly these arguments | Disputed |
| `resolve_expired_dispute(task_id)` | anyone | Disputed, after `court_until`: the standing verdict is paid (or the poster refunded if there was none) and the stake goes back |
| `refund(task_id)` | poster before the deadline; anyone after | Open; or Active after `deadline + adjudication_sla + dispute_window` |
| `pause` / `unpause` | admin | stops `post_task`, `submit`, `release_to_winner`, `finalize`, `rule`; never `refund`, `dispute`, `escalate` |
| `propose_rotation` / `apply_rotation` / `cancel_rotation` | admin / anyone after 48 h / admin | the verdict and court authorities can never be the same address |

Rulings: `Uphold` pays the original winner and gives them the stake; `Award(submitter, score)` re-settles to another submitter and returns the stake; `Refund` returns the reward to the poster and the stake to the disputer. No fee is taken on refunds.

## Events

`post`, `settle`, `refund` and `dispute` keep v1's topics and field names, so reputation derived from escrow events (`packages/agent-sdk/src/reputation`) keeps working. In `settle`, `reward` is what the winner received and `fee` is what went to the fee recipient. New: `submit`, `verdict` (with the commitment and `dispute_until`), `escalate`, `ruling`, `court_timeout`, `pause`, `rotation_proposed`, `rotation_applied`, `rotation_cancelled`.

## Deployment parameters

The constructor takes one `Config`. It rejects a fee above 5%, any window under 24 hours, a stake share above 100%, and a verdict authority equal to the court authority.

| Field | Proposed mainnet value |
|---|---|
| `admin` | 2-of-3 multisig account |
| `token` | native XLM SAC `CAS3J7GY…OWMA` |
| `verdict_authority`, `court_authority` | two separate accounts, keys in KMS or a hardware wallet |
| `fee_recipient`, `fee_bps` | published address, 300 (3%) |
| `pass_threshold` | 70 |
| `dispute_window`, `adjudication_sla` | 86 400 (24 h) each |
| `court_sla` | 259 200 (72 h) |
| `dispute_stake_bps`, `min_dispute_stake` | 1 000 (10%), 5 000 000 stroops (0.5 XLM) |

## Build and test

```bash
cargo test              # 38 tests
stellar contract build  # target/wasm32v1-none/release/cogladius_escrow_v2.wasm
```

Status: written and tested; not yet reviewed by the second engineer, not audited, not deployed.
