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
//! Rewards are held as the real Stellar testnet USDC asset through its Stellar
//! Asset Contract (SAC). The contract uses the SEP-41 token interface
//! (`transfer`) for both the lock (poster → contract) and the payout
//! (contract → winner / poster).
//!
//! ## Verdict authority (on-chain ed25519)
//! The three-judge LLM panel runs off-chain. Its averaged verdict is signed by
//! a verdict-authority ed25519 key whose public key is stored in the contract.
//! `release_to_winner` rebuilds the canonical verdict message and verifies the
//! signature on-chain with `env.crypto().ed25519_verify` — funds move only on a
//! genuine, unforgeable verdict, and only when the score clears the threshold.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, xdr::ToXdr,
    Address, Bytes, BytesN, Env,
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
    /// Administrative authority (state transitions like `activate` / `flag_disputed`).
    pub admin: Address,
    /// Stellar Asset Contract (SAC) address for the USDC reward asset.
    pub usdc_sac: Address,
    /// ed25519 public key of the off-chain verdict authority.
    pub verdict_pubkey: BytesN<32>,
    /// Minimum average score (0-100) required to pay a winner.
    pub pass_threshold: u32,
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
    /// key, and the pass threshold.
    pub fn __constructor(
        env: Env,
        admin: Address,
        usdc_sac: Address,
        verdict_pubkey: BytesN<32>,
        pass_threshold: u32,
    ) {
        env.storage().instance().set(
            &DataKey::Config,
            &Config {
                admin,
                usdc_sac,
                verdict_pubkey,
                pass_threshold,
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
        if reward <= 0 {
            return Err(Error::InvalidAmount);
        }
        let key = DataKey::Task(task_id);
        if env.storage().persistent().has(&key) {
            return Err(Error::TaskExists);
        }
        let config = Self::config(&env);
        token::TokenClient::new(&env, &config.usdc_sac).transfer(
            &poster,
            &env.current_contract_address(),
            &reward,
        );
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
        env.events()
            .publish((symbol_short!("post"), task_id), (poster, reward, deadline));
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
        env.events().publish((symbol_short!("activate"), task_id), ());
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
        let key = DataKey::Task(task_id);
        let mut task = Self::load(&env, &key)?;
        if task.status != Status::Open && task.status != Status::Active {
            return Err(Error::InvalidState);
        }
        let config = Self::config(&env);
        if score < config.pass_threshold {
            return Err(Error::ScoreTooLow);
        }
        // Verify the verdict authority's signature (panics/reverts if invalid).
        let msg = verdict_message(&env, task_id, &winner, score, nonce);
        env.crypto()
            .ed25519_verify(&config.verdict_pubkey, &msg, &signature);

        token::TokenClient::new(&env, &config.usdc_sac).transfer(
            &env.current_contract_address(),
            &winner,
            &task.reward,
        );
        task.status = Status::Completed;
        task.winner = Some(winner.clone());
        env.storage().persistent().set(&key, &task);
        env.events()
            .publish((symbol_short!("settle"), task_id), (winner, task.reward, score));
        Ok(())
    }

    /// Refund the reward to the poster. Permissionless after the deadline
    /// (expiry); before the deadline it is a poster-authorized cancel.
    pub fn refund(env: Env, task_id: u64) -> Result<(), Error> {
        let key = DataKey::Task(task_id);
        let mut task = Self::load(&env, &key)?;
        if task.status != Status::Open && task.status != Status::Active {
            return Err(Error::InvalidState);
        }
        if env.ledger().timestamp() <= task.deadline {
            task.poster.require_auth();
        }
        let config = Self::config(&env);
        token::TokenClient::new(&env, &config.usdc_sac).transfer(
            &env.current_contract_address(),
            &task.poster,
            &task.reward,
        );
        task.status = Status::Refunded;
        env.storage().persistent().set(&key, &task);
        env.events().publish(
            (symbol_short!("refund"), task_id),
            (task.poster.clone(), task.reward),
        );
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
        env.events().publish((symbol_short!("dispute"), task_id), ());
        Ok(())
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
