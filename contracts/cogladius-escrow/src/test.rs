#![cfg(test)]

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env,
};

const THRESHOLD: u32 = 70;
const GRACE: u64 = 300; // post-deadline settlement window (seconds)
const REWARD: i128 = 100_0000000; // 100 USDC at 7 decimals

struct Harness<'a> {
    env: Env,
    client: EscrowContractClient<'a>,
    usdc: TokenClient<'a>,
    usdc_admin: StellarAssetClient<'a>,
    poster: Address,
    signing_key: SigningKey,
}

fn setup<'a>() -> Harness<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let sac_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(sac_admin);
    let usdc_addr = sac.address();
    let usdc = TokenClient::new(&env, &usdc_addr);
    let usdc_admin = StellarAssetClient::new(&env, &usdc_addr);

    // Deterministic verdict-authority ed25519 key.
    let signing_key = SigningKey::from_bytes(&[7u8; 32]);
    let verdict_pubkey = BytesN::from_array(&env, &signing_key.verifying_key().to_bytes());

    let admin = Address::generate(&env);
    let contract_id = env.register(
        EscrowContract,
        (admin, usdc_addr.clone(), verdict_pubkey, THRESHOLD, GRACE),
    );
    let client = EscrowContractClient::new(&env, &contract_id);

    let poster = Address::generate(&env);
    usdc_admin.mint(&poster, &(REWARD * 5));

    Harness {
        env,
        client,
        usdc,
        usdc_admin,
        poster,
        signing_key,
    }
}

impl<'a> Harness<'a> {
    fn sign_verdict(&self, task_id: u64, winner: &Address, score: u32, nonce: u64) -> BytesN<64> {
        let msg = verdict_message(&self.env, task_id, winner, score, nonce);
        let buf: std::vec::Vec<u8> = msg.iter().collect();
        let sig = self.signing_key.sign(&buf);
        BytesN::from_array(&self.env, &sig.to_bytes())
    }

    fn contract_balance(&self) -> i128 {
        self.usdc.balance(&self.client.address)
    }
}

#[test]
fn post_task_locks_usdc_in_escrow() {
    let h = setup();
    h.client.post_task(&h.poster, &1, &REWARD, &9999999999);

    assert_eq!(h.contract_balance(), REWARD);
    assert_eq!(h.usdc.balance(&h.poster), REWARD * 4);

    let task = h.client.get_task(&1).unwrap();
    assert_eq!(task.status, Status::Open);
    assert_eq!(task.reward, REWARD);
    assert_eq!(task.winner, None);
}

#[test]
fn release_pays_winner_on_valid_verdict() {
    let h = setup();
    h.client.post_task(&h.poster, &1, &REWARD, &9999999999);

    let winner = Address::generate(&h.env);
    let sig = h.sign_verdict(1, &winner, 88, 1);
    h.client.release_to_winner(&1, &winner, &88, &1, &sig);

    assert_eq!(h.usdc.balance(&winner), REWARD);
    assert_eq!(h.contract_balance(), 0);

    let task = h.client.get_task(&1).unwrap();
    assert_eq!(task.status, Status::Completed);
    assert_eq!(task.winner, Some(winner));
}

#[test]
#[should_panic]
fn release_with_bad_signature_reverts() {
    let h = setup();
    h.client.post_task(&h.poster, &1, &REWARD, &9999999999);

    let winner = Address::generate(&h.env);
    // Sign for a DIFFERENT winner — signature will not verify for `winner`.
    let other = Address::generate(&h.env);
    let bad_sig = h.sign_verdict(1, &other, 88, 1);
    h.client.release_to_winner(&1, &winner, &88, &1, &bad_sig);
}

#[test]
fn release_below_threshold_is_rejected() {
    let h = setup();
    h.client.post_task(&h.poster, &1, &REWARD, &9999999999);

    let winner = Address::generate(&h.env);
    let sig = h.sign_verdict(1, &winner, 50, 1);
    let res = h.client.try_release_to_winner(&1, &winner, &50, &1, &sig);
    assert_eq!(res, Err(Ok(Error::ScoreTooLow)));

    // Funds remain locked.
    assert_eq!(h.contract_balance(), REWARD);
}

#[test]
fn double_settle_is_blocked() {
    let h = setup();
    h.client.post_task(&h.poster, &1, &REWARD, &9999999999);

    let winner = Address::generate(&h.env);
    let sig = h.sign_verdict(1, &winner, 90, 1);
    h.client.release_to_winner(&1, &winner, &90, &1, &sig);

    let sig2 = h.sign_verdict(1, &winner, 90, 2);
    let res = h.client.try_release_to_winner(&1, &winner, &90, &2, &sig2);
    assert_eq!(res, Err(Ok(Error::InvalidState)));
}

#[test]
fn duplicate_task_id_is_blocked() {
    let h = setup();
    h.client.post_task(&h.poster, &1, &REWARD, &9999999999);
    let res = h.client.try_post_task(&h.poster, &1, &REWARD, &9999999999);
    assert_eq!(res, Err(Ok(Error::TaskExists)));
}

#[test]
fn refund_after_expiry_returns_funds_to_poster() {
    let h = setup();
    let deadline = 1000u64;
    h.client.post_task(&h.poster, &1, &REWARD, &deadline);
    assert_eq!(h.usdc.balance(&h.poster), REWARD * 4);

    // Past the deadline + settlement grace: permissionless refund.
    h.env.ledger().set_timestamp(deadline + GRACE + 1);
    h.client.refund(&1);

    assert_eq!(h.usdc.balance(&h.poster), REWARD * 5);
    assert_eq!(h.contract_balance(), 0);
    assert_eq!(h.client.get_task(&1).unwrap().status, Status::Refunded);
}

#[test]
fn poster_can_cancel_before_deadline() {
    let h = setup();
    h.client.post_task(&h.poster, &1, &REWARD, &9999999999);
    h.client.refund(&1);
    assert_eq!(h.usdc.balance(&h.poster), REWARD * 5);
    assert_eq!(h.client.get_task(&1).unwrap().status, Status::Refunded);
}

#[test]
fn activate_transitions_open_to_active() {
    let h = setup();
    h.client.post_task(&h.poster, &1, &REWARD, &9999999999);
    h.client.activate(&1);
    assert_eq!(h.client.get_task(&1).unwrap().status, Status::Active);
}

#[test]
fn post_task_rejects_zero_reward() {
    let h = setup();
    let res = h.client.try_post_task(&h.poster, &1, &0, &9999999999);
    assert_eq!(res, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn config_is_stored() {
    let h = setup();
    let cfg = h.client.get_config();
    assert_eq!(cfg.pass_threshold, THRESHOLD);
    assert_eq!(cfg.settle_grace, GRACE);
    assert!(!cfg.paused);
    // silence unused warning on the SAC admin client
    let _ = &h.usdc_admin;
}

// ── H2: an Active task cannot be refunded during the settlement window ──
#[test]
fn active_task_refund_locked_until_grace_then_permissionless() {
    let h = setup();
    let deadline = 1000u64;
    h.client.post_task(&h.poster, &1, &REWARD, &deadline);
    h.client.activate(&1);

    // After the deadline but inside the grace window: refund is locked so the
    // platform can settle to a winner without being front-run.
    h.env.ledger().set_timestamp(deadline + 1);
    let res = h.client.try_refund(&1);
    assert_eq!(res, Err(Ok(Error::RefundLocked)));
    assert_eq!(h.contract_balance(), REWARD);

    // Past the grace window: permissionless refund returns the funds.
    h.env.ledger().set_timestamp(deadline + GRACE + 1);
    h.client.refund(&1);
    assert_eq!(h.usdc.balance(&h.poster), REWARD * 5);
    assert_eq!(h.client.get_task(&1).unwrap().status, Status::Refunded);
}

// A winner can still be settled after the deadline while inside the grace window.
#[test]
fn release_still_works_after_deadline_within_grace() {
    let h = setup();
    let deadline = 1000u64;
    h.client.post_task(&h.poster, &1, &REWARD, &deadline);
    h.client.activate(&1);

    h.env.ledger().set_timestamp(deadline + 1);
    let winner = Address::generate(&h.env);
    let sig = h.sign_verdict(1, &winner, 90, 1);
    h.client.release_to_winner(&1, &winner, &90, &1, &sig);

    assert_eq!(h.usdc.balance(&winner), REWARD);
    assert_eq!(h.client.get_task(&1).unwrap().status, Status::Completed);
}

// ── H1: emergency pause blocks release + post, never refund ──
#[test]
fn pause_blocks_release_and_post_but_not_refund() {
    let h = setup();
    h.client.post_task(&h.poster, &1, &REWARD, &9999999999);

    h.client.pause();
    assert!(h.client.get_config().paused);

    // release is blocked while paused
    let winner = Address::generate(&h.env);
    let sig = h.sign_verdict(1, &winner, 90, 1);
    let rel = h.client.try_release_to_winner(&1, &winner, &90, &1, &sig);
    assert_eq!(rel, Err(Ok(Error::Paused)));

    // new posts are blocked while paused
    let post = h.client.try_post_task(&h.poster, &2, &REWARD, &9999999999);
    assert_eq!(post, Err(Ok(Error::Paused)));

    // refund is the always-available exit, even while paused
    h.client.refund(&1);
    assert_eq!(h.client.get_task(&1).unwrap().status, Status::Refunded);

    // unpause restores settlement
    h.client.unpause();
    assert!(!h.client.get_config().paused);
}

// ── H1: verdict key rotation invalidates old signatures ──
#[test]
fn verdict_key_rotation_invalidates_old_and_accepts_new() {
    let h = setup();
    h.client.post_task(&h.poster, &1, &REWARD, &9999999999);

    // Rotate to a fresh authority key.
    let new_key = SigningKey::from_bytes(&[9u8; 32]);
    let new_pubkey = BytesN::from_array(&h.env, &new_key.verifying_key().to_bytes());
    h.client.set_verdict_pubkey(&new_pubkey);
    assert_eq!(
        h.client.get_config().verdict_pubkey,
        new_pubkey
    );

    let winner = Address::generate(&h.env);

    // A signature from the OLD key no longer verifies.
    let old_sig = h.sign_verdict(1, &winner, 90, 1);
    let old = h.client.try_release_to_winner(&1, &winner, &90, &1, &old_sig);
    assert!(old.is_err());

    // A signature from the NEW key settles the task.
    let msg = verdict_message(&h.env, 1, &winner, 90, 2);
    let buf: std::vec::Vec<u8> = msg.iter().collect();
    let new_sig = BytesN::from_array(&h.env, &new_key.sign(&buf).to_bytes());
    h.client.release_to_winner(&1, &winner, &90, &2, &new_sig);
    assert_eq!(h.usdc.balance(&winner), REWARD);
}

// ── M3: constructor rejects an out-of-range pass threshold ──
#[test]
#[should_panic]
fn constructor_rejects_threshold_above_100() {
    let env = Env::default();
    env.mock_all_auths();
    let sac_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(sac_admin);
    let signing_key = SigningKey::from_bytes(&[7u8; 32]);
    let verdict_pubkey = BytesN::from_array(&env, &signing_key.verifying_key().to_bytes());
    let admin = Address::generate(&env);
    // 101 is invalid — construction must panic.
    env.register(
        EscrowContract,
        (admin, sac.address(), verdict_pubkey, 101u32, GRACE),
    );
}
