#![no_std]
//! # Cogladius Escrow v2
//!
//! Holds a task's reward until a judged submission is paid, with a window in
//! which a wrong verdict can be disputed and re-settled before any money leaves
//! the contract. It closes the gaps listed in `docs/THREAT_MODEL.md` §1:
//!
//! 1. **What was judged is on chain.** `post_task` pins a `task_hash`, and every
//!    agent records its `submission_hash` with `submit` before the deadline.
//! 2. **The verdict commits to its inputs.** The verdict authority authorizes
//!    `(task_id, winner, score, commitment)` through Soroban native auth
//!    (`require_auth_for_args`), so replay protection and expiry come from the
//!    host, and the authority can be a multisig or policy account.
//! 3. **Only a submitter can be paid.** The winner must have a recorded
//!    submission for the task.
//! 4. **A verdict is reversible until it is final.** A verdict moves the task to
//!    `Settling`; the reward stays in the contract for `dispute_window`. The
//!    poster or any other submitter can `dispute` with a stake; a separate court
//!    authority rules, and the escrow re-settles.
//! 5. **Activation is not the operator's call.** The first `submit` makes the
//!    task Active; there is no admin `activate`.
//! 6. **Adjudication cannot be starved into a refund.** A task with submissions
//!    cannot be refunded until `deadline + adjudication_sla + dispute_window`,
//!    and if no verdict arrives within the SLA any submitter can `escalate` to
//!    the court instead.
//! 7. **Keys rotate slowly and in public.** Changing the verdict authority, the
//!    court authority or the admin is proposed, announced in an event, and
//!    applied only after `ROTATION_DELAY`.
//! 8. **The fee is visible and capped.** `fee_bps` is fixed at deployment, can
//!    never exceed `MAX_FEE_BPS`, is taken only when a winner is paid, and is
//!    shown in the settlement event. Refunds carry no fee.
//!
//! ## State machine
//! ```text
//!  post_task ─▶ [Open] ─submit─▶ [Active] ─release_to_winner─▶ [Settling] ─finalize─▶ [Completed]
//!                 │                 │  └─escalate─┐                │
//!                 │                 │             ▼                └─dispute─▶ [Disputed] ─rule─▶ [Completed]
//!                 └──── refund ─────┴──────▶ [Refunded] ◀──────────────────────────┘ (ruling: refund)
//! ```
//!
//! `pause` stops new work and payouts (`post_task`, `submit`,
//! `release_to_winner`, `finalize`, `rule`). It never stops `refund`,
//! `dispute` or `escalate`, so a pause cannot trap funds or run out a dispute
//! window.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    Address, BytesN, Env, IntoVal,
};

/// Highest protocol fee the contract will ever accept: 5%.
pub const MAX_FEE_BPS: u32 = 500;
/// Shortest dispute window, adjudication SLA and court SLA accepted: 24 hours.
pub const MIN_WINDOW: u64 = 86_400;
/// Delay between announcing and applying a key or admin change: 48 hours.
pub const ROTATION_DELAY: u64 = 172_800;
const BPS: i128 = 10_000;

// Persistent entries are bumped on every write.
const TTL_THRESHOLD: u32 = 17_280; // ~1 day
const TTL_EXTEND: u32 = 518_400; // ~30 days

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Open = 0,
    Active = 1,
    Settling = 2,
    Disputed = 3,
    Completed = 4,
    Refunded = 5,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    /// Pauses the contract and proposes rotations. Intended to be a multisig.
    pub admin: Address,
    /// SEP-41 token the rewards are paid in (the native XLM SAC on mainnet).
    pub token: Address,
    /// Authorizes verdicts: `(task_id, winner, score, commitment)`.
    pub verdict_authority: Address,
    /// Authorizes rulings on disputed tasks; separate from the verdict authority.
    pub court_authority: Address,
    /// Receives the protocol fee.
    pub fee_recipient: Address,
    /// Fee on a paid reward, in basis points. At most `MAX_FEE_BPS`.
    pub fee_bps: u32,
    /// Minimum judged score (1-100) that can be paid.
    pub pass_threshold: u32,
    /// Seconds a verdict stays disputable before `finalize` can pay it.
    pub dispute_window: u64,
    /// Seconds after the deadline within which a verdict is expected.
    pub adjudication_sla: u64,
    /// Seconds the court has to rule before anyone can resolve the dispute.
    pub court_sla: u64,
    /// Dispute stake as a share of the reward, in basis points.
    pub dispute_stake_bps: u32,
    /// Smallest dispute stake, whatever the reward.
    pub min_dispute_stake: i128,
    /// Emergency stop for new work and payouts.
    pub paused: bool,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Task {
    pub poster: Address,
    pub reward: i128,
    pub deadline: u64,
    /// Hash of everything the task promises: description, criteria, tests.
    pub task_hash: BytesN<32>,
    pub status: Status,
    pub submissions: u32,
    pub winner: Option<Address>,
    pub score: u32,
    /// Commitment to what the judges saw, bound into the verdict.
    pub commitment: Option<BytesN<32>>,
    /// End of the dispute window once a verdict is in.
    pub dispute_until: u64,
    pub disputer: Option<Address>,
    pub stake: i128,
    /// Deadline for the court once a dispute is open.
    pub court_until: u64,
}

/// What the court decides about a disputed task.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum Ruling {
    /// The verdict stands: the original winner is paid and receives the stake.
    Uphold,
    /// Pay this submitter at this score instead; the stake goes back.
    Award(Address, u32),
    /// Nobody qualifies: the reward goes back to the poster with the stake.
    Refund,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Rotation {
    pub verdict_authority: Option<Address>,
    pub court_authority: Option<Address>,
    pub admin: Option<Address>,
    /// Earliest time `apply_rotation` succeeds.
    pub eta: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    Task(u64),
    Submission(u64, Address),
    Rotation,
}

#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum Error {
    TaskExists = 1,
    TaskNotFound = 2,
    InvalidState = 3,
    InvalidAmount = 4,
    ScoreTooLow = 5,
    Paused = 6,
    InvalidConfig = 7,
    InvalidDeadline = 8,
    DeadlinePassed = 9,
    AlreadySubmitted = 10,
    NotASubmitter = 11,
    PosterCannotSubmit = 12,
    DisputeWindowOpen = 13,
    DisputeWindowClosed = 14,
    NotAParty = 15,
    RefundLocked = 16,
    EscalationNotOpen = 17,
    CourtWindowOpen = 18,
    NothingToUphold = 19,
    NoRotation = 20,
    RotationNotReady = 21,
    InvalidScore = 22,
}

// ── Events. `post`, `settle`, `refund` and `dispute` keep the v1 topics and
// field names, so reputation derived from escrow events works unchanged.

#[contractevent(topics = ["post"])]
pub struct PostEvent {
    pub task_id: u64,
    pub poster: Address,
    pub reward: i128,
    pub deadline: u64,
    pub task_hash: BytesN<32>,
}

#[contractevent(topics = ["submit"])]
pub struct SubmitEvent {
    pub task_id: u64,
    pub agent: Address,
    pub submission_hash: BytesN<32>,
}

#[contractevent(topics = ["verdict"])]
pub struct VerdictEvent {
    pub task_id: u64,
    pub winner: Address,
    pub score: u32,
    pub commitment: BytesN<32>,
    pub dispute_until: u64,
}

/// A winner was paid. `reward` is what the winner received; `fee` went to the
/// fee recipient in the same transaction.
#[contractevent(topics = ["settle"])]
pub struct SettleEvent {
    pub task_id: u64,
    pub winner: Address,
    pub reward: i128,
    pub fee: i128,
    pub score: u32,
}

#[contractevent(topics = ["refund"])]
pub struct RefundEvent {
    pub task_id: u64,
    pub poster: Address,
    pub reward: i128,
}

#[contractevent(topics = ["dispute"])]
pub struct DisputeEvent {
    pub task_id: u64,
    pub disputer: Address,
    pub stake: i128,
    pub court_until: u64,
}

/// A submitter took a task with no verdict past its SLA to the court.
#[contractevent(topics = ["escalate"])]
pub struct EscalateEvent {
    pub task_id: u64,
    pub submitter: Address,
    pub court_until: u64,
}

#[contractevent(topics = ["ruling"])]
pub struct RulingEvent {
    pub task_id: u64,
    pub ruling: Ruling,
    pub commitment: BytesN<32>,
}

/// The court missed its SLA; the dispute closed on the standing verdict.
#[contractevent(topics = ["court_timeout"])]
pub struct CourtTimeoutEvent {
    pub task_id: u64,
}

#[contractevent(topics = ["pause"])]
pub struct PauseEvent {
    pub paused: bool,
}

#[contractevent(topics = ["rotation_proposed"])]
pub struct RotationProposedEvent {
    pub rotation: Rotation,
}

#[contractevent(topics = ["rotation_applied"])]
pub struct RotationAppliedEvent {
    pub rotation: Rotation,
}

#[contractevent(topics = ["rotation_cancelled"])]
pub struct RotationCancelledEvent {
    pub eta: u64,
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// Deploy with the full configuration. `paused` is ignored and starts false.
    pub fn __constructor(env: Env, config: Config) {
        if config.fee_bps > MAX_FEE_BPS
            || config.pass_threshold < 1
            || config.pass_threshold > 100
            || config.dispute_window < MIN_WINDOW
            || config.adjudication_sla < MIN_WINDOW
            || config.court_sla < MIN_WINDOW
            || config.dispute_stake_bps > BPS as u32
            || config.min_dispute_stake < 0
            || config.verdict_authority == config.court_authority
        {
            panic_with_error!(&env, Error::InvalidConfig);
        }
        let mut config = config;
        config.paused = false;
        env.storage().instance().set(&DataKey::Config, &config);
    }

    /// Lock a reward. The poster authorizes the transfer into the contract.
    pub fn post_task(
        env: Env,
        poster: Address,
        task_id: u64,
        reward: i128,
        deadline: u64,
        task_hash: BytesN<32>,
    ) -> Result<(), Error> {
        poster.require_auth();
        let config = Self::config(&env);
        if config.paused {
            return Err(Error::Paused);
        }
        if reward <= 0 {
            return Err(Error::InvalidAmount);
        }
        if deadline <= env.ledger().timestamp() {
            return Err(Error::InvalidDeadline);
        }
        let key = DataKey::Task(task_id);
        if env.storage().persistent().has(&key) {
            return Err(Error::TaskExists);
        }
        let task = Task {
            poster: poster.clone(),
            reward,
            deadline,
            task_hash: task_hash.clone(),
            status: Status::Open,
            submissions: 0,
            winner: None,
            score: 0,
            commitment: None,
            dispute_until: 0,
            disputer: None,
            stake: 0,
            court_until: 0,
        };
        Self::save(&env, task_id, &task);
        token::TokenClient::new(&env, &config.token).transfer(
            &poster,
            &env.current_contract_address(),
            &reward,
        );
        PostEvent { task_id, poster, reward, deadline, task_hash }.publish(&env);
        Ok(())
    }

    /// Record an agent's submission before the deadline. One per agent; the
    /// first one makes the task Active.
    pub fn submit(
        env: Env,
        task_id: u64,
        agent: Address,
        submission_hash: BytesN<32>,
    ) -> Result<(), Error> {
        agent.require_auth();
        if Self::config(&env).paused {
            return Err(Error::Paused);
        }
        let mut task = Self::load(&env, task_id)?;
        if task.status != Status::Open && task.status != Status::Active {
            return Err(Error::InvalidState);
        }
        if env.ledger().timestamp() > task.deadline {
            return Err(Error::DeadlinePassed);
        }
        if agent == task.poster {
            return Err(Error::PosterCannotSubmit);
        }
        let sub_key = DataKey::Submission(task_id, agent.clone());
        if env.storage().persistent().has(&sub_key) {
            return Err(Error::AlreadySubmitted);
        }
        env.storage().persistent().set(&sub_key, &submission_hash);
        env.storage().persistent().extend_ttl(&sub_key, TTL_THRESHOLD, TTL_EXTEND);
        task.submissions += 1;
        task.status = Status::Active;
        Self::save(&env, task_id, &task);
        SubmitEvent { task_id, agent, submission_hash }.publish(&env);
        Ok(())
    }

    /// Accept a verdict authorized by the verdict authority over
    /// `(task_id, winner, score, commitment)`. The reward stays in the contract
    /// until the dispute window closes.
    pub fn release_to_winner(
        env: Env,
        task_id: u64,
        winner: Address,
        score: u32,
        commitment: BytesN<32>,
    ) -> Result<(), Error> {
        let config = Self::config(&env);
        if config.paused {
            return Err(Error::Paused);
        }
        let mut task = Self::load(&env, task_id)?;
        if task.status != Status::Active {
            return Err(Error::InvalidState);
        }
        Self::check_score(&config, score)?;
        if !Self::has_submitted(&env, task_id, &winner) {
            return Err(Error::NotASubmitter);
        }
        config.verdict_authority.require_auth_for_args(
            (task_id, winner.clone(), score, commitment.clone()).into_val(&env),
        );
        let dispute_until = env.ledger().timestamp().saturating_add(config.dispute_window);
        task.status = Status::Settling;
        task.winner = Some(winner.clone());
        task.score = score;
        task.commitment = Some(commitment.clone());
        task.dispute_until = dispute_until;
        Self::save(&env, task_id, &task);
        VerdictEvent { task_id, winner, score, commitment, dispute_until }.publish(&env);
        Ok(())
    }

    /// Pay the winner once the dispute window has closed. Anyone may call it.
    pub fn finalize(env: Env, task_id: u64) -> Result<(), Error> {
        let config = Self::config(&env);
        if config.paused {
            return Err(Error::Paused);
        }
        let mut task = Self::load(&env, task_id)?;
        if task.status != Status::Settling {
            return Err(Error::InvalidState);
        }
        if env.ledger().timestamp() <= task.dispute_until {
            return Err(Error::DisputeWindowOpen);
        }
        let winner = task.winner.clone().unwrap();
        task.status = Status::Completed;
        Self::save(&env, task_id, &task);
        Self::pay_winner(&env, &config, task_id, &winner, task.reward, task.score);
        Ok(())
    }

    /// Contest a verdict during the dispute window. Only the poster or another
    /// submitter can dispute, once per task, and must lock a stake.
    pub fn dispute(env: Env, task_id: u64, disputer: Address) -> Result<(), Error> {
        disputer.require_auth();
        let config = Self::config(&env);
        let mut task = Self::load(&env, task_id)?;
        if task.status != Status::Settling {
            return Err(Error::InvalidState);
        }
        if env.ledger().timestamp() > task.dispute_until {
            return Err(Error::DisputeWindowClosed);
        }
        let is_party = disputer == task.poster || Self::has_submitted(&env, task_id, &disputer);
        if !is_party || Some(disputer.clone()) == task.winner {
            return Err(Error::NotAParty);
        }
        let stake = Self::stake_for(&config, task.reward);
        let court_until = env.ledger().timestamp().saturating_add(config.court_sla);
        task.status = Status::Disputed;
        task.disputer = Some(disputer.clone());
        task.stake = stake;
        task.court_until = court_until;
        Self::save(&env, task_id, &task);
        if stake > 0 {
            token::TokenClient::new(&env, &config.token).transfer(
                &disputer,
                &env.current_contract_address(),
                &stake,
            );
        }
        DisputeEvent { task_id, disputer, stake, court_until }.publish(&env);
        Ok(())
    }

    /// Take a task with no verdict past its SLA to the court. Any submitter may
    /// do this, without a stake, until the escalation window closes.
    pub fn escalate(env: Env, task_id: u64, submitter: Address) -> Result<(), Error> {
        submitter.require_auth();
        let config = Self::config(&env);
        let mut task = Self::load(&env, task_id)?;
        if task.status != Status::Active {
            return Err(Error::InvalidState);
        }
        let now = env.ledger().timestamp();
        let opens = task.deadline.saturating_add(config.adjudication_sla);
        let closes = opens.saturating_add(config.dispute_window);
        if now <= opens || now > closes {
            return Err(Error::EscalationNotOpen);
        }
        if !Self::has_submitted(&env, task_id, &submitter) {
            return Err(Error::NotASubmitter);
        }
        let court_until = now.saturating_add(config.court_sla);
        task.status = Status::Disputed;
        task.disputer = Some(submitter.clone());
        task.stake = 0;
        task.court_until = court_until;
        Self::save(&env, task_id, &task);
        EscalateEvent { task_id, submitter, court_until }.publish(&env);
        Ok(())
    }

    /// Apply the court's ruling, authorized by the court authority over
    /// `(task_id, ruling, commitment)`.
    pub fn rule(
        env: Env,
        task_id: u64,
        ruling: Ruling,
        commitment: BytesN<32>,
    ) -> Result<(), Error> {
        let config = Self::config(&env);
        if config.paused {
            return Err(Error::Paused);
        }
        let mut task = Self::load(&env, task_id)?;
        if task.status != Status::Disputed {
            return Err(Error::InvalidState);
        }
        // Check the ruling can be carried out before asking for authorization.
        match &ruling {
            Ruling::Uphold => {
                if task.winner.is_none() {
                    return Err(Error::NothingToUphold);
                }
            }
            Ruling::Award(winner, score) => {
                Self::check_score(&config, *score)?;
                if !Self::has_submitted(&env, task_id, winner) {
                    return Err(Error::NotASubmitter);
                }
            }
            Ruling::Refund => {}
        }
        config.court_authority.require_auth_for_args(
            (task_id, ruling.clone(), commitment.clone()).into_val(&env),
        );
        let disputer = task.disputer.clone().unwrap();
        let stake = task.stake;
        let token = token::TokenClient::new(&env, &config.token);
        match ruling.clone() {
            Ruling::Uphold => {
                let winner = task.winner.clone().unwrap();
                task.status = Status::Completed;
                Self::save(&env, task_id, &task);
                // A failed dispute forfeits its stake to the winner it delayed.
                if stake > 0 {
                    token.transfer(&env.current_contract_address(), &winner, &stake);
                }
                Self::pay_winner(&env, &config, task_id, &winner, task.reward, task.score);
            }
            Ruling::Award(winner, score) => {
                task.status = Status::Completed;
                task.winner = Some(winner.clone());
                task.score = score;
                Self::save(&env, task_id, &task);
                if stake > 0 {
                    token.transfer(&env.current_contract_address(), &disputer, &stake);
                }
                Self::pay_winner(&env, &config, task_id, &winner, task.reward, score);
            }
            Ruling::Refund => {
                task.status = Status::Refunded;
                Self::save(&env, task_id, &task);
                if stake > 0 {
                    token.transfer(&env.current_contract_address(), &disputer, &stake);
                }
                Self::pay_refund(&env, &config, task_id, &task.poster, task.reward);
            }
        }
        RulingEvent { task_id, ruling, commitment }.publish(&env);
        Ok(())
    }

    /// Close a dispute the court did not rule on in time. Anyone may call it.
    /// The standing verdict is paid (or, for an escalated task with no
    /// verdict, the poster is refunded), and the stake goes back to the
    /// disputer: a court that does not show up costs nobody their stake.
    pub fn resolve_expired_dispute(env: Env, task_id: u64) -> Result<(), Error> {
        let config = Self::config(&env);
        let mut task = Self::load(&env, task_id)?;
        if task.status != Status::Disputed {
            return Err(Error::InvalidState);
        }
        if env.ledger().timestamp() <= task.court_until {
            return Err(Error::CourtWindowOpen);
        }
        let disputer = task.disputer.clone().unwrap();
        let stake = task.stake;
        match task.winner.clone() {
            Some(winner) => {
                task.status = Status::Completed;
                Self::save(&env, task_id, &task);
                if stake > 0 {
                    token::TokenClient::new(&env, &config.token).transfer(
                        &env.current_contract_address(),
                        &disputer,
                        &stake,
                    );
                }
                Self::pay_winner(&env, &config, task_id, &winner, task.reward, task.score);
            }
            None => {
                task.status = Status::Refunded;
                Self::save(&env, task_id, &task);
                if stake > 0 {
                    token::TokenClient::new(&env, &config.token).transfer(
                        &env.current_contract_address(),
                        &disputer,
                        &stake,
                    );
                }
                Self::pay_refund(&env, &config, task_id, &task.poster, task.reward);
            }
        }
        CourtTimeoutEvent { task_id }.publish(&env);
        Ok(())
    }

    /// Return the reward to the poster.
    ///
    /// - **Open** (no submissions): the poster may cancel at any time; after the
    ///   deadline anyone may refund.
    /// - **Active** (submissions, no verdict): locked until
    ///   `deadline + adjudication_sla + dispute_window`, so the verdict and the
    ///   escalation window both come first; after that anyone may refund.
    ///
    /// Never paused, and never pays anyone but the poster.
    pub fn refund(env: Env, task_id: u64) -> Result<(), Error> {
        let config = Self::config(&env);
        let mut task = Self::load(&env, task_id)?;
        let now = env.ledger().timestamp();
        match task.status {
            Status::Open => {
                if now <= task.deadline {
                    task.poster.require_auth();
                }
            }
            Status::Active => {
                let unlock = task
                    .deadline
                    .saturating_add(config.adjudication_sla)
                    .saturating_add(config.dispute_window);
                if now <= unlock {
                    return Err(Error::RefundLocked);
                }
            }
            _ => return Err(Error::InvalidState),
        }
        task.status = Status::Refunded;
        Self::save(&env, task_id, &task);
        Self::pay_refund(&env, &config, task_id, &task.poster, task.reward);
        Ok(())
    }

    /// Emergency stop for new work and payouts. Admin only.
    pub fn pause(env: Env) {
        let mut config = Self::config(&env);
        config.admin.require_auth();
        config.paused = true;
        env.storage().instance().set(&DataKey::Config, &config);
        PauseEvent { paused: true }.publish(&env);
    }

    pub fn unpause(env: Env) {
        let mut config = Self::config(&env);
        config.admin.require_auth();
        config.paused = false;
        env.storage().instance().set(&DataKey::Config, &config);
        PauseEvent { paused: false }.publish(&env);
    }

    /// Announce a change of verdict authority, court authority and/or admin.
    /// It can be applied only after `ROTATION_DELAY`, so the change is public
    /// before it takes effect. Replaces any pending proposal. Admin only.
    pub fn propose_rotation(
        env: Env,
        verdict_authority: Option<Address>,
        court_authority: Option<Address>,
        admin: Option<Address>,
    ) -> Result<(), Error> {
        let config = Self::config(&env);
        config.admin.require_auth();
        if verdict_authority.is_none() && court_authority.is_none() && admin.is_none() {
            return Err(Error::InvalidConfig);
        }
        let next_verdict = verdict_authority.clone().unwrap_or(config.verdict_authority.clone());
        let next_court = court_authority.clone().unwrap_or(config.court_authority.clone());
        if next_verdict == next_court {
            return Err(Error::InvalidConfig);
        }
        let rotation = Rotation {
            verdict_authority,
            court_authority,
            admin,
            eta: env.ledger().timestamp().saturating_add(ROTATION_DELAY),
        };
        env.storage().instance().set(&DataKey::Rotation, &rotation);
        RotationProposedEvent { rotation }.publish(&env);
        Ok(())
    }

    /// Apply the pending rotation once its delay has passed. Anyone may call it.
    pub fn apply_rotation(env: Env) -> Result<(), Error> {
        let rotation: Rotation = env
            .storage()
            .instance()
            .get(&DataKey::Rotation)
            .ok_or(Error::NoRotation)?;
        if env.ledger().timestamp() < rotation.eta {
            return Err(Error::RotationNotReady);
        }
        let mut config = Self::config(&env);
        if let Some(a) = rotation.verdict_authority.clone() {
            config.verdict_authority = a;
        }
        if let Some(a) = rotation.court_authority.clone() {
            config.court_authority = a;
        }
        if let Some(a) = rotation.admin.clone() {
            config.admin = a;
        }
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().remove(&DataKey::Rotation);
        RotationAppliedEvent { rotation }.publish(&env);
        Ok(())
    }

    /// Withdraw a pending rotation. Admin only.
    pub fn cancel_rotation(env: Env) -> Result<(), Error> {
        let config = Self::config(&env);
        config.admin.require_auth();
        let rotation: Rotation = env
            .storage()
            .instance()
            .get(&DataKey::Rotation)
            .ok_or(Error::NoRotation)?;
        env.storage().instance().remove(&DataKey::Rotation);
        RotationCancelledEvent { eta: rotation.eta }.publish(&env);
        Ok(())
    }

    pub fn get_task(env: Env, task_id: u64) -> Option<Task> {
        env.storage().persistent().get(&DataKey::Task(task_id))
    }

    pub fn get_submission(env: Env, task_id: u64, agent: Address) -> Option<BytesN<32>> {
        env.storage().persistent().get(&DataKey::Submission(task_id, agent))
    }

    pub fn get_config(env: Env) -> Config {
        Self::config(&env)
    }

    pub fn get_rotation(env: Env) -> Option<Rotation> {
        env.storage().instance().get(&DataKey::Rotation)
    }

    /// The stake a dispute on a task with this reward requires.
    pub fn dispute_stake(env: Env, reward: i128) -> i128 {
        Self::stake_for(&Self::config(&env), reward)
    }
}

impl EscrowContract {
    fn config(env: &Env) -> Config {
        env.storage().instance().get(&DataKey::Config).unwrap()
    }

    fn load(env: &Env, task_id: u64) -> Result<Task, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Task(task_id))
            .ok_or(Error::TaskNotFound)
    }

    fn save(env: &Env, task_id: u64, task: &Task) {
        let key = DataKey::Task(task_id);
        env.storage().persistent().set(&key, task);
        env.storage().persistent().extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND);
    }

    fn has_submitted(env: &Env, task_id: u64, agent: &Address) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Submission(task_id, agent.clone()))
    }

    fn check_score(config: &Config, score: u32) -> Result<(), Error> {
        if score > 100 {
            return Err(Error::InvalidScore);
        }
        if score < config.pass_threshold {
            return Err(Error::ScoreTooLow);
        }
        Ok(())
    }

    fn stake_for(config: &Config, reward: i128) -> i128 {
        let share = reward.saturating_mul(config.dispute_stake_bps as i128) / BPS;
        if share > config.min_dispute_stake {
            share
        } else {
            config.min_dispute_stake
        }
    }

    /// Pay `reward` minus the protocol fee to the winner and the fee to the fee
    /// recipient. Callers update task state first (checks-effects-interactions).
    fn pay_winner(env: &Env, config: &Config, task_id: u64, winner: &Address, reward: i128, score: u32) {
        let fee = reward.saturating_mul(config.fee_bps as i128) / BPS;
        let net = reward - fee;
        let token = token::TokenClient::new(env, &config.token);
        token.transfer(&env.current_contract_address(), winner, &net);
        if fee > 0 {
            token.transfer(&env.current_contract_address(), &config.fee_recipient, &fee);
        }
        SettleEvent { task_id, winner: winner.clone(), reward: net, fee, score }.publish(env);
    }

    fn pay_refund(env: &Env, config: &Config, task_id: u64, poster: &Address, reward: i128) {
        token::TokenClient::new(env, &config.token).transfer(
            &env.current_contract_address(),
            poster,
            &reward,
        );
        RefundEvent { task_id, poster: poster.clone(), reward }.publish(env);
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test;
