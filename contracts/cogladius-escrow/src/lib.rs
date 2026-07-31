#![no_std]
//! # Cogladius Escrow
//!
//! A non-custodial Soroban smart contract that holds a task's **USDC** reward
//! from the moment it is posted until a verified judge verdict releases it to
//! the winning agent — or the deadline passes and it is refunded to the poster.
//! No platform wallet ever holds the funds: the contract *is* the escrow.
//!
//! ## State machine
//! ```text
//!   post_task ──▶ [Open] ──activate──▶ [Active] ──release_to_winner──▶ [Completed]
//!                   │                      │
//!                   └────────── refund ────┴────▶ [Refunded]
//!                                  [Completed] ──flag_disputed──▶ [Disputed]
//! ```
//!
//! ## USDC custody (SAC)
//! Rewards are held as the real Stellar USDC asset through its Stellar Asset
//! Contract (SAC). The contract uses the SEP-41 token interface (`transfer`)
//! for both the lock (poster → contract) and the payout
//! (contract → winner / poster).
//!
//! ## Verdict authority (on-chain ed25519)
//! The three-judge LLM panel runs off-chain. Its averaged verdict is signed by
//! a verdict-authority ed25519 key whose public key is stored in the contract.
//! `release_to_winner` rebuilds the canonical verdict message and verifies the
//! signature on-chain with `env.crypto().ed25519_verify` — funds move only on a
//! genuine, unforgeable verdict, and only when the score clears the threshold.
//!
//! ## Emergency controls (mainnet hardening)
//! The verdict key is a hot key off-chain: if it leaks, an attacker could sign
//! valid verdicts and drain open tasks. To bound that blast radius the admin can
//! [`pause`] settlements (and new posts) and [`set_verdict_pubkey`] to rotate the
//! authority key without redeploying. Refunds are never paused so posters can
//! always exit.

use soroban_sdk::{
    contract, contractevent, contracterror, contractimpl, contracttype, panic_with_error, token,
    xdr::ToXdr, Address, Bytes, BytesN, Env,
};

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Open = 0,
    Active = 1,
    Completed = 2,
    Disputed = 3,
    Refunded = 4,
}

#[contracttype]
#[derive(Clone)]
pub struct Config {
    /// Administrative authority (state transitions, pause, key rotation).
    pub admin: Address,
    /// Stellar Asset Contract (SAC) address of the reward asset.
    ///
    /// NOTE: `usdc_sac` is a legacy field name from the first deployment, which
    /// escrowed Circle USDC. The escrow is SEP-41 asset-agnostic — it moves
    /// whatever asset this SAC address represents — and the live mainnet
    /// deployment sets it to the NATIVE XLM SAC
    /// (`CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA`), so winners
    /// need no trustline to be paid. The name is kept because renaming it would
    /// change the contract spec and force a redeploy of a live contract.
    pub usdc_sac: Address,
    /// ed25519 public key of the off-chain verdict authority (rotatable).
    pub verdict_pubkey: BytesN<32>,
    /// Minimum average score (1-100) required to pay a winner.
    pub pass_threshold: u32,
    /// Seconds after `deadline` during which a permissionless refund is blocked,
    /// giving the platform a window to settle to a winner without being
    /// front-run. Active tasks cannot be refunded until this window elapses.
    pub settle_grace: u64,
    /// Emergency stop: blocks `release_to_winner` and `post_task` (never refund).
    pub paused: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct Task {
    pub poster: Address,
    pub reward: i128,
    pub deadline: u64,
    pub status: Status,
    pub winner: Option<Address>,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    Task(u64),
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
    NotExpired = 6,
    Paused = 7,
    RefundLocked = 8,
    InvalidConfig = 9,
}

// ── Events (soroban-sdk 26 `#[contractevent]`) ──
#[contractevent(topics = ["post"])]
pub struct PostEvent {
    pub task_id: u64,
    pub poster: Address,
    pub reward: i128,
    pub deadline: u64,
}

#[contractevent(topics = ["activate"])]
pub struct ActivateEvent {
    pub task_id: u64,
}

#[contractevent(topics = ["settle"])]
pub struct SettleEvent {
    pub task_id: u64,
    pub winner: Address,
    pub reward: i128,
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
}

#[contractevent(topics = ["pause"])]
pub struct PauseEvent {
    pub paused: bool,
}

#[contractevent(topics = ["verdict_key"])]
pub struct VerdictKeyEvent {
    pub pubkey: BytesN<32>,
}

// Persistent task entries live ~30 days of ledgers before needing a bump.
const TASK_TTL_THRESHOLD: u32 = 17_280; // ~1 day
const TASK_TTL_EXTEND: u32 = 518_400; // ~30 days

/// Canonical verdict message the verdict authority signs and the contract
/// re-derives: `task_id(8, BE) || score(4, BE) || nonce(8, BE) || winner.to_xdr()`.
/// Binding the winner's XDR-serialized address makes the signature unusable for
/// any other recipient, task, score, or nonce.
pub fn verdict_message(
    env: &Env,
    task_id: u64,
    winner: &Address,
    score: u32,
    nonce: u64,
) -> Bytes {
    let mut msg = Bytes::new(env);
    msg.extend_from_array(&task_id.to_be_bytes());
    msg.extend_from_array(&score.to_be_bytes());
    msg.extend_from_array(&nonce.to_be_bytes());
    msg.append(&winner.clone().to_xdr(env));
    msg
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// One-time constructor: wires the USDC SAC, the verdict-authority public
    /// key, the pass threshold, and the post-deadline settlement grace window.
    pub fn __constructor(
        env: Env,
        admin: Address,
        usdc_sac: Address,
        verdict_pubkey: BytesN<32>,
        pass_threshold: u32,
        settle_grace: u64,
    ) {
        if pass_threshold < 1 || pass_threshold > 100 {
            panic_with_error!(&env, Error::InvalidConfig);
        }
        env.storage().instance().set(
            &DataKey::Config,
            &Config {
                admin,
                usdc_sac,
                verdict_pubkey,
                pass_threshold,
                settle_grace,
                paused: false,
            },
        );
    }

    /// Lock a task's USDC reward in escrow. Pulls `reward` from the poster's
    /// account into the contract via the USDC SAC. Requires the poster's auth.
    pub fn post_task(
        env: Env,
        poster: Address,
        task_id: u64,
        reward: i128,
        deadline: u64,
    ) -> Result<(), Error> {
        poster.require_auth();
        let config = Self::config(&env);
        if config.paused {
            return Err(Error::Paused);
        }
        if reward <= 0 {
            return Err(Error::InvalidAmount);
        }
        let key = DataKey::Task(task_id);
        if env.storage().persistent().has(&key) {
            return Err(Error::TaskExists);
        }
        // Effects before interaction: record the task, then pull the funds.
        env.storage().persistent().set(
            &key,
            &Task {
                poster: poster.clone(),
                reward,
                deadline,
                status: Status::Open,
                winner: None,
            },
        );
        env.storage()
            .persistent()
            .extend_ttl(&key, TASK_TTL_THRESHOLD, TASK_TTL_EXTEND);
        token::TokenClient::new(&env, &config.usdc_sac).transfer(
            &poster,
            &env.current_contract_address(),
            &reward,
        );
        PostEvent { task_id, poster, reward, deadline }.publish(&env);
        Ok(())
    }

    /// Mark a task Active (admin records the first agent submission).
    pub fn activate(env: Env, task_id: u64) -> Result<(), Error> {
        let config = Self::config(&env);
        config.admin.require_auth();
        let key = DataKey::Task(task_id);
        let mut task = Self::load(&env, &key)?;
        if task.status != Status::Open {
            return Err(Error::InvalidState);
        }
        task.status = Status::Active;
        env.storage().persistent().set(&key, &task);
        ActivateEvent { task_id }.publish(&env);
        Ok(())
    }

    /// Release the reward to the winning agent on a verified judge verdict.
    /// Anyone may submit the transaction, but only a signature from the verdict
    /// authority over the canonical `(task_id, winner, score, nonce)` message
    /// — with `score >= pass_threshold` — moves the funds.
    pub fn release_to_winner(
        env: Env,
        task_id: u64,
        winner: Address,
        score: u32,
        nonce: u64,
        signature: BytesN<64>,
    ) -> Result<(), Error> {
        let config = Self::config(&env);
        if config.paused {
            return Err(Error::Paused);
        }
        let key = DataKey::Task(task_id);
        let mut task = Self::load(&env, &key)?;
        if task.status != Status::Open && task.status != Status::Active {
            return Err(Error::InvalidState);
        }
        if score < config.pass_threshold {
            return Err(Error::ScoreTooLow);
        }
        // Verify the verdict authority's signature (panics/reverts if invalid).
        let msg = verdict_message(&env, task_id, &winner, score, nonce);
        env.crypto()
            .ed25519_verify(&config.verdict_pubkey, &msg, &signature);

        // Effects before interaction (CEI): mark Completed, then pay out.
        let reward = task.reward;
        task.status = Status::Completed;
        task.winner = Some(winner.clone());
        env.storage().persistent().set(&key, &task);
        token::TokenClient::new(&env, &config.usdc_sac).transfer(
            &env.current_contract_address(),
            &winner,
            &reward,
        );
        SettleEvent { task_id, winner, reward, score }.publish(&env);
        Ok(())
    }

    /// Refund the reward to the poster.
    ///
    /// - **Open** task: before `deadline + settle_grace` this is a
    ///   poster-authorized cancel; after it, permissionless.
    /// - **Active** task (work submitted): locked until `deadline + settle_grace`
    ///   so the platform can settle to a winner without being front-run; after
    ///   the window it is permissionless.
    pub fn refund(env: Env, task_id: u64) -> Result<(), Error> {
        let key = DataKey::Task(task_id);
        let mut task = Self::load(&env, &key)?;
        if task.status != Status::Open && task.status != Status::Active {
            return Err(Error::InvalidState);
        }
        let config = Self::config(&env);
        let grace_end = task.deadline.saturating_add(config.settle_grace);
        if env.ledger().timestamp() <= grace_end {
            // Still inside the settlement window.
            if task.status == Status::Active {
                // Committed work: no refund until the window elapses.
                return Err(Error::RefundLocked);
            }
            // Open task: only the poster may cancel their own task early.
            task.poster.require_auth();
        }
        // Effects before interaction (CEI): mark Refunded, then pay out.
        let poster = task.poster.clone();
        let reward = task.reward;
        task.status = Status::Refunded;
        env.storage().persistent().set(&key, &task);
        token::TokenClient::new(&env, &config.usdc_sac).transfer(
            &env.current_contract_address(),
            &poster,
            &reward,
        );
        RefundEvent { task_id, poster, reward }.publish(&env);
        Ok(())
    }

    /// Flag a completed task as disputed (state stub; full Agent Court
    /// resolution is a later deliverable). Admin-authorized.
    pub fn flag_disputed(env: Env, task_id: u64) -> Result<(), Error> {
        let config = Self::config(&env);
        config.admin.require_auth();
        let key = DataKey::Task(task_id);
        let mut task = Self::load(&env, &key)?;
        if task.status != Status::Completed {
            return Err(Error::InvalidState);
        }
        task.status = Status::Disputed;
        env.storage().persistent().set(&key, &task);
        DisputeEvent { task_id }.publish(&env);
        Ok(())
    }

    /// Emergency stop: block `release_to_winner` and `post_task`. Admin-only.
    /// Refunds remain available so posters can always exit. Intended for a
    /// suspected verdict-key compromise while the key is rotated.
    pub fn pause(env: Env) {
        let mut config = Self::config(&env);
        config.admin.require_auth();
        config.paused = true;
        Self::save_config(&env, &config);
        PauseEvent { paused: true }.publish(&env);
    }

    /// Lift the emergency stop. Admin-only.
    pub fn unpause(env: Env) {
        let mut config = Self::config(&env);
        config.admin.require_auth();
        config.paused = false;
        Self::save_config(&env, &config);
        PauseEvent { paused: false }.publish(&env);
    }

    /// Rotate the verdict-authority public key (e.g. after a key compromise)
    /// without redeploying. Admin-only. Existing signatures over the old key
    /// stop verifying immediately.
    pub fn set_verdict_pubkey(env: Env, new_pubkey: BytesN<32>) {
        let mut config = Self::config(&env);
        config.admin.require_auth();
        config.verdict_pubkey = new_pubkey.clone();
        Self::save_config(&env, &config);
        VerdictKeyEvent { pubkey: new_pubkey }.publish(&env);
    }

    pub fn get_task(env: Env, task_id: u64) -> Option<Task> {
        env.storage().persistent().get(&DataKey::Task(task_id))
    }

    pub fn get_config(env: Env) -> Config {
        Self::config(&env)
    }
}

impl EscrowContract {
    fn config(env: &Env) -> Config {
        env.storage().instance().get(&DataKey::Config).unwrap()
    }

    fn save_config(env: &Env, config: &Config) {
        env.storage().instance().set(&DataKey::Config, config);
    }

    fn load(env: &Env, key: &DataKey) -> Result<Task, Error> {
        env.storage()
            .persistent()
            .get(key)
            .ok_or(Error::TaskNotFound)
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test;
