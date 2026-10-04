#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, Ledger as _},
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env, IntoVal, Symbol,
};

const REWARD: i128 = 100_0000000; // 100 units at 7 decimals
const FEE_BPS: u32 = 300; // 3%
const STAKE_BPS: u32 = 1_000; // 10%
const MIN_STAKE: i128 = 5_000000; // 0.5 units
const DAY: u64 = 86_400;
const START: u64 = 1_000_000;
const DEADLINE: u64 = START + DAY;

struct H<'a> {
    env: Env,
    c: EscrowContractClient<'a>,
    token: TokenClient<'a>,
    admin: Address,
    verdict: Address,
    court: Address,
    fee_to: Address,
    poster: Address,
    a1: Address,
    a2: Address,
}

fn config(env: &Env, token: &Address) -> (Config, Address, Address, Address, Address) {
    let admin = Address::generate(env);
    let verdict = Address::generate(env);
    let court = Address::generate(env);
    let fee_to = Address::generate(env);
    (
        Config {
            admin: admin.clone(),
            token: token.clone(),
            verdict_authority: verdict.clone(),
            court_authority: court.clone(),
            fee_recipient: fee_to.clone(),
            fee_bps: FEE_BPS,
            pass_threshold: 70,
            dispute_window: DAY,
            adjudication_sla: DAY,
            court_sla: 3 * DAY,
            dispute_stake_bps: STAKE_BPS,
            min_dispute_stake: MIN_STAKE,
            paused: false,
        },
        admin,
        verdict,
        court,
        fee_to,
    )
}

fn setup<'a>() -> H<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(START);
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let token = TokenClient::new(&env, &sac.address());
    let mint = StellarAssetClient::new(&env, &sac.address());
    let (cfg, admin, verdict, court, fee_to) = config(&env, &sac.address());
    let id = env.register(EscrowContract, (cfg,));
    let c = EscrowContractClient::new(&env, &id);
    let poster = Address::generate(&env);
    let a1 = Address::generate(&env);
    let a2 = Address::generate(&env);
    for who in [&poster, &a1, &a2] {
        mint.mint(who, &(REWARD * 5));
    }
    H { env, c, token, admin, verdict, court, fee_to, poster, a1, a2 }
}

fn h32(env: &Env, b: u8) -> BytesN<32> {
    BytesN::from_array(env, &[b; 32])
}

impl<'a> H<'a> {
    fn post(&self, id: u64) {
        self.c.post_task(&self.poster, &id, &REWARD, &DEADLINE, &h32(&self.env, 1));
    }
    fn post_and_submit(&self, id: u64) {
        self.post(id);
        self.c.submit(&id, &self.a1, &h32(&self.env, 11));
        self.c.submit(&id, &self.a2, &h32(&self.env, 22));
    }
    fn verdict_for(&self, id: u64, winner: &Address, score: u32) {
        self.c.release_to_winner(&id, winner, &score, &h32(&self.env, 99));
    }
    fn at(&self, t: u64) {
        self.env.ledger().set_timestamp(t);
    }
    fn held(&self) -> i128 {
        self.token.balance(&self.c.address)
    }
    fn bal(&self, who: &Address) -> i128 {
        self.token.balance(who)
    }
    fn fee(&self) -> i128 {
        REWARD * FEE_BPS as i128 / 10_000
    }
}

// ── posting and submissions ──

#[test]
fn post_locks_reward_and_pins_task_hash() {
    let h = setup();
    h.post(1);
    assert_eq!(h.held(), REWARD);
    let t = h.c.get_task(&1).unwrap();
    assert_eq!(t.status, Status::Open);
    assert_eq!(t.task_hash, h32(&h.env, 1));
    assert_eq!(t.submissions, 0);
}

#[test]
fn post_rejects_bad_input_and_duplicates() {
    let h = setup();
    assert_eq!(h.c.try_post_task(&h.poster, &1, &0, &DEADLINE, &h32(&h.env, 1)), Err(Ok(Error::InvalidAmount)));
    assert_eq!(h.c.try_post_task(&h.poster, &1, &REWARD, &START, &h32(&h.env, 1)), Err(Ok(Error::InvalidDeadline)));
    h.post(1);
    assert_eq!(h.c.try_post_task(&h.poster, &1, &REWARD, &DEADLINE, &h32(&h.env, 1)), Err(Ok(Error::TaskExists)));
}

#[test]
fn submit_records_hash_and_activates() {
    let h = setup();
    h.post(1);
    h.c.submit(&1, &h.a1, &h32(&h.env, 11));
    let t = h.c.get_task(&1).unwrap();
    assert_eq!(t.status, Status::Active);
    assert_eq!(t.submissions, 1);
    assert_eq!(h.c.get_submission(&1, &h.a1), Some(h32(&h.env, 11)));
    assert_eq!(h.c.get_submission(&1, &h.a2), None);
}

#[test]
fn submit_is_authorized_by_the_agent() {
    let h = setup();
    h.post(1);
    h.c.submit(&1, &h.a1, &h32(&h.env, 11));
    let auths = h.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, h.a1);
}

#[test]
fn submit_rules() {
    let h = setup();
    h.post(1);
    assert_eq!(h.c.try_submit(&1, &h.poster, &h32(&h.env, 5)), Err(Ok(Error::PosterCannotSubmit)));
    h.c.submit(&1, &h.a1, &h32(&h.env, 11));
    assert_eq!(h.c.try_submit(&1, &h.a1, &h32(&h.env, 12)), Err(Ok(Error::AlreadySubmitted)));
    h.at(DEADLINE + 1);
    assert_eq!(h.c.try_submit(&1, &h.a2, &h32(&h.env, 22)), Err(Ok(Error::DeadlinePassed)));
}

// ── verdict, Settling and finalize ──

#[test]
fn verdict_holds_funds_in_settling() {
    let h = setup();
    h.post_and_submit(1);
    h.verdict_for(1, &h.a1, 88);
    let t = h.c.get_task(&1).unwrap();
    assert_eq!(t.status, Status::Settling);
    assert_eq!(t.winner, Some(h.a1.clone()));
    assert_eq!(t.score, 88);
    assert_eq!(t.commitment, Some(h32(&h.env, 99)));
    assert_eq!(t.dispute_until, START + DAY);
    // Nothing has moved yet.
    assert_eq!(h.held(), REWARD);
}

#[test]
fn verdict_requires_the_verdict_authority_over_the_exact_arguments() {
    let h = setup();
    h.post_and_submit(1);
    h.verdict_for(1, &h.a1, 88);
    assert_eq!(
        h.env.auths(),
        std::vec![(
            h.verdict.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    h.c.address.clone(),
                    Symbol::new(&h.env, "release_to_winner"),
                    (1u64, h.a1.clone(), 88u32, h32(&h.env, 99)).into_val(&h.env),
                )),
                sub_invocations: std::vec![],
            }
        )]
    );
}

#[test]
#[should_panic]
fn verdict_without_authorization_reverts() {
    let h = setup();
    h.post_and_submit(1);
    h.env.set_auths(&[]);
    h.verdict_for(1, &h.a1, 88);
}

#[test]
fn verdict_rules() {
    let h = setup();
    h.post(1);
    // No submissions yet: the task is Open, not Active.
    assert_eq!(h.c.try_release_to_winner(&1, &h.a1, &88, &h32(&h.env, 99)), Err(Ok(Error::InvalidState)));
    h.c.submit(&1, &h.a1, &h32(&h.env, 11));
    let stranger = Address::generate(&h.env);
    assert_eq!(h.c.try_release_to_winner(&1, &stranger, &88, &h32(&h.env, 99)), Err(Ok(Error::NotASubmitter)));
    assert_eq!(h.c.try_release_to_winner(&1, &h.a1, &69, &h32(&h.env, 99)), Err(Ok(Error::ScoreTooLow)));
    assert_eq!(h.c.try_release_to_winner(&1, &h.a1, &101, &h32(&h.env, 99)), Err(Ok(Error::InvalidScore)));
    h.verdict_for(1, &h.a1, 88);
    assert_eq!(h.c.try_release_to_winner(&1, &h.a1, &90, &h32(&h.env, 98)), Err(Ok(Error::InvalidState)));
}

#[test]
fn finalize_waits_for_the_window_then_pays_winner_and_fee() {
    let h = setup();
    h.post_and_submit(1);
    h.verdict_for(1, &h.a1, 88);
    assert_eq!(h.c.try_finalize(&1), Err(Ok(Error::DisputeWindowOpen)));
    let before = h.bal(&h.a1);
    h.at(START + DAY + 1);
    h.c.finalize(&1);
    assert_eq!(h.bal(&h.a1) - before, REWARD - h.fee());
    assert_eq!(h.bal(&h.fee_to), h.fee());
    assert_eq!(h.held(), 0);
    assert_eq!(h.c.get_task(&1).unwrap().status, Status::Completed);
    assert_eq!(h.c.try_finalize(&1), Err(Ok(Error::InvalidState)));
}

// ── disputes and rulings ──

fn disputed<'a>() -> H<'a> {
    let h = setup();
    h.post_and_submit(1);
    h.verdict_for(1, &h.a1, 88);
    h.c.dispute(&1, &h.a2);
    h
}

#[test]
fn dispute_takes_a_stake_and_blocks_finalize() {
    let h = setup();
    h.post_and_submit(1);
    h.verdict_for(1, &h.a1, 88);
    let before = h.bal(&h.a2);
    h.c.dispute(&1, &h.a2);
    let stake = REWARD * STAKE_BPS as i128 / 10_000;
    assert_eq!(h.c.dispute_stake(&REWARD), stake);
    assert_eq!(before - h.bal(&h.a2), stake);
    assert_eq!(h.held(), REWARD + stake);
    let t = h.c.get_task(&1).unwrap();
    assert_eq!(t.status, Status::Disputed);
    assert_eq!(t.disputer, Some(h.a2.clone()));
    h.at(START + DAY + 1);
    assert_eq!(h.c.try_finalize(&1), Err(Ok(Error::InvalidState)));
}

#[test]
fn small_rewards_use_the_minimum_stake() {
    let h = setup();
    assert_eq!(h.c.dispute_stake(&10_000000), MIN_STAKE);
}

#[test]
fn only_parties_can_dispute_and_only_inside_the_window() {
    let h = setup();
    h.post_and_submit(1);
    h.verdict_for(1, &h.a1, 88);
    let stranger = Address::generate(&h.env);
    assert_eq!(h.c.try_dispute(&1, &stranger), Err(Ok(Error::NotAParty)));
    // The winner cannot dispute its own win.
    assert_eq!(h.c.try_dispute(&1, &h.a1), Err(Ok(Error::NotAParty)));
    h.at(START + DAY + 1);
    assert_eq!(h.c.try_dispute(&1, &h.poster), Err(Ok(Error::DisputeWindowClosed)));
}

#[test]
fn poster_can_dispute() {
    let h = setup();
    h.post_and_submit(1);
    h.verdict_for(1, &h.a1, 88);
    h.c.dispute(&1, &h.poster);
    assert_eq!(h.c.get_task(&1).unwrap().disputer, Some(h.poster.clone()));
}

#[test]
fn only_one_dispute_per_task() {
    let h = disputed();
    assert_eq!(h.c.try_dispute(&1, &h.poster), Err(Ok(Error::InvalidState)));
}

#[test]
fn uphold_pays_the_winner_and_forfeits_the_stake_to_them() {
    let h = disputed();
    let stake = REWARD * STAKE_BPS as i128 / 10_000;
    let before = h.bal(&h.a1);
    h.c.rule(&1, &Ruling::Uphold, &h32(&h.env, 77));
    assert_eq!(h.bal(&h.a1) - before, REWARD - h.fee() + stake);
    assert_eq!(h.bal(&h.fee_to), h.fee());
    assert_eq!(h.held(), 0);
    assert_eq!(h.c.get_task(&1).unwrap().status, Status::Completed);
}

#[test]
fn award_re_settles_to_another_submitter_and_returns_the_stake() {
    let h = disputed();
    let a1_before = h.bal(&h.a1);
    let a2_before = h.bal(&h.a2);
    let stake = REWARD * STAKE_BPS as i128 / 10_000;
    h.c.rule(&1, &Ruling::Award(h.a2.clone(), 91), &h32(&h.env, 77));
    assert_eq!(h.bal(&h.a1), a1_before); // the overturned winner gets nothing
    assert_eq!(h.bal(&h.a2) - a2_before, REWARD - h.fee() + stake);
    let t = h.c.get_task(&1).unwrap();
    assert_eq!(t.winner, Some(h.a2.clone()));
    assert_eq!(t.score, 91);
    assert_eq!(t.status, Status::Completed);
    assert_eq!(h.held(), 0);
}

#[test]
fn refund_ruling_returns_reward_and_stake_without_fee() {
    let h = disputed();
    let poster_before = h.bal(&h.poster);
    let a2_before = h.bal(&h.a2);
    let stake = REWARD * STAKE_BPS as i128 / 10_000;
    h.c.rule(&1, &Ruling::Refund, &h32(&h.env, 77));
    assert_eq!(h.bal(&h.poster) - poster_before, REWARD);
    assert_eq!(h.bal(&h.a2) - a2_before, stake);
    assert_eq!(h.bal(&h.fee_to), 0);
    assert_eq!(h.c.get_task(&1).unwrap().status, Status::Refunded);
    assert_eq!(h.held(), 0);
}

#[test]
fn ruling_requires_the_court_authority_not_the_verdict_authority() {
    let h = disputed();
    h.c.rule(&1, &Ruling::Uphold, &h32(&h.env, 77));
    let auths = h.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, h.court);
    assert_ne!(auths[0].0, h.verdict);
}

#[test]
#[should_panic]
fn ruling_without_authorization_reverts() {
    let h = disputed();
    h.env.set_auths(&[]);
    h.c.rule(&1, &Ruling::Refund, &h32(&h.env, 77));
}

#[test]
fn award_must_name_a_passing_submitter() {
    let h = disputed();
    let stranger = Address::generate(&h.env);
    assert_eq!(h.c.try_rule(&1, &Ruling::Award(stranger, 90), &h32(&h.env, 77)), Err(Ok(Error::NotASubmitter)));
    assert_eq!(h.c.try_rule(&1, &Ruling::Award(h.a2.clone(), 50), &h32(&h.env, 77)), Err(Ok(Error::ScoreTooLow)));
}

#[test]
fn expired_court_pays_the_standing_verdict_and_returns_the_stake() {
    let h = disputed();
    assert_eq!(h.c.try_resolve_expired_dispute(&1), Err(Ok(Error::CourtWindowOpen)));
    let a1_before = h.bal(&h.a1);
    let a2_before = h.bal(&h.a2);
    let stake = REWARD * STAKE_BPS as i128 / 10_000;
    h.at(START + 3 * DAY + 1);
    h.c.resolve_expired_dispute(&1);
    assert_eq!(h.bal(&h.a1) - a1_before, REWARD - h.fee());
    assert_eq!(h.bal(&h.a2) - a2_before, stake);
    assert_eq!(h.c.get_task(&1).unwrap().status, Status::Completed);
    assert_eq!(h.held(), 0);
}

// ── refunds, the adjudication SLA and escalation ──

#[test]
fn poster_cancels_an_open_task_and_anyone_refunds_after_the_deadline() {
    let h = setup();
    h.post(1);
    let before = h.bal(&h.poster);
    h.c.refund(&1);
    assert_eq!(h.bal(&h.poster) - before, REWARD);
    assert_eq!(h.c.get_task(&1).unwrap().status, Status::Refunded);

    h.post(2);
    h.at(DEADLINE + 1);
    h.env.set_auths(&[]); // no signature from anyone
    h.c.refund(&2);
    assert_eq!(h.c.get_task(&2).unwrap().status, Status::Refunded);
}

#[test]
#[should_panic]
fn only_the_poster_can_cancel_before_the_deadline() {
    let h = setup();
    h.post(1);
    h.env.set_auths(&[]);
    h.c.refund(&1);
}

#[test]
fn work_in_progress_cannot_be_refunded_until_sla_and_escalation_pass() {
    let h = setup();
    h.post_and_submit(1);
    h.at(DEADLINE + DAY + DAY); // deadline + sla + window, still inside
    assert_eq!(h.c.try_refund(&1), Err(Ok(Error::RefundLocked)));
    h.at(DEADLINE + 2 * DAY + 1);
    h.c.refund(&1);
    assert_eq!(h.c.get_task(&1).unwrap().status, Status::Refunded);
    assert_eq!(h.held(), 0);
}

#[test]
fn settling_and_disputed_tasks_cannot_be_refunded() {
    let h = setup();
    h.post_and_submit(1);
    h.verdict_for(1, &h.a1, 88);
    h.at(DEADLINE + 30 * DAY);
    assert_eq!(h.c.try_refund(&1), Err(Ok(Error::InvalidState)));
}

#[test]
fn a_missed_sla_can_be_escalated_by_a_submitter() {
    let h = setup();
    h.post_and_submit(1);
    h.at(DEADLINE + DAY); // SLA not yet missed
    assert_eq!(h.c.try_escalate(&1, &h.a1), Err(Ok(Error::EscalationNotOpen)));
    h.at(DEADLINE + DAY + 1);
    let stranger = Address::generate(&h.env);
    assert_eq!(h.c.try_escalate(&1, &stranger), Err(Ok(Error::NotASubmitter)));
    h.c.escalate(&1, &h.a1);
    let t = h.c.get_task(&1).unwrap();
    assert_eq!(t.status, Status::Disputed);
    assert_eq!(t.stake, 0);
    assert_eq!(t.winner, None);
    // With no verdict there is nothing to uphold; the court awards or refunds.
    assert_eq!(h.c.try_rule(&1, &Ruling::Uphold, &h32(&h.env, 77)), Err(Ok(Error::NothingToUphold)));
    h.c.rule(&1, &Ruling::Award(h.a1.clone(), 80), &h32(&h.env, 77));
    assert_eq!(h.c.get_task(&1).unwrap().status, Status::Completed);
    assert_eq!(h.held(), 0);
}

#[test]
fn escalation_closes_with_the_refund_lock() {
    let h = setup();
    h.post_and_submit(1);
    h.at(DEADLINE + 2 * DAY + 1);
    assert_eq!(h.c.try_escalate(&1, &h.a1), Err(Ok(Error::EscalationNotOpen)));
}

#[test]
fn an_escalated_task_the_court_ignores_goes_back_to_the_poster() {
    let h = setup();
    h.post_and_submit(1);
    h.at(DEADLINE + DAY + 1);
    h.c.escalate(&1, &h.a1);
    let before = h.bal(&h.poster);
    h.at(DEADLINE + DAY + 1 + 3 * DAY + 1);
    h.c.resolve_expired_dispute(&1);
    assert_eq!(h.bal(&h.poster) - before, REWARD);
    assert_eq!(h.c.get_task(&1).unwrap().status, Status::Refunded);
}

// ── pause ──

#[test]
fn pause_stops_work_and_payouts_but_never_exits() {
    let h = setup();
    h.post_and_submit(1);
    h.verdict_for(1, &h.a1, 88);
    h.post(2);
    h.c.pause();
    assert_eq!(h.c.try_post_task(&h.poster, &3, &REWARD, &DEADLINE, &h32(&h.env, 1)), Err(Ok(Error::Paused)));
    assert_eq!(h.c.try_submit(&2, &h.a1, &h32(&h.env, 11)), Err(Ok(Error::Paused)));
    h.at(START + DAY + 1);
    assert_eq!(h.c.try_finalize(&1), Err(Ok(Error::Paused)));
    // Exits stay open while paused.
    h.c.refund(&2);
    h.c.unpause();
    h.c.finalize(&1);
    assert_eq!(h.c.get_task(&1).unwrap().status, Status::Completed);
}

#[test]
fn disputes_stay_open_while_paused() {
    let h = setup();
    h.post_and_submit(1);
    h.verdict_for(1, &h.a1, 88);
    h.c.pause();
    h.c.dispute(&1, &h.a2);
    assert_eq!(h.c.get_task(&1).unwrap().status, Status::Disputed);
}

// ── timelocked rotation ──

#[test]
fn rotation_waits_48_hours_and_then_takes_effect() {
    let h = setup();
    let new_verdict = Address::generate(&h.env);
    h.c.propose_rotation(&Some(new_verdict.clone()), &None, &None);
    assert_eq!(h.c.try_apply_rotation(), Err(Ok(Error::RotationNotReady)));
    assert_eq!(h.c.get_config().verdict_authority, h.verdict);
    h.at(START + ROTATION_DELAY);
    h.c.apply_rotation();
    assert_eq!(h.c.get_config().verdict_authority, new_verdict);
    assert_eq!(h.c.get_rotation(), None);
}

#[test]
fn rotation_can_be_cancelled_and_cannot_merge_the_two_authorities() {
    let h = setup();
    assert_eq!(h.c.try_propose_rotation(&None, &None, &None), Err(Ok(Error::InvalidConfig)));
    assert_eq!(h.c.try_propose_rotation(&Some(h.court.clone()), &None, &None), Err(Ok(Error::InvalidConfig)));
    h.c.propose_rotation(&None, &None, &Some(Address::generate(&h.env)));
    h.c.cancel_rotation();
    h.at(START + ROTATION_DELAY);
    assert_eq!(h.c.try_apply_rotation(), Err(Ok(Error::NoRotation)));
    assert_eq!(h.c.get_config().admin, h.admin);
}

#[test]
#[should_panic]
fn only_the_admin_proposes_rotations() {
    let h = setup();
    h.env.set_auths(&[]);
    h.c.propose_rotation(&Some(Address::generate(&h.env)), &None, &None);
}

// ── configuration ──

#[test]
#[should_panic]
fn fee_above_the_cap_is_rejected_at_deployment() {
    let env = Env::default();
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let (mut cfg, ..) = config(&env, &sac.address());
    cfg.fee_bps = MAX_FEE_BPS + 1;
    env.register(EscrowContract, (cfg,));
}

#[test]
#[should_panic]
fn a_dispute_window_under_24_hours_is_rejected() {
    let env = Env::default();
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let (mut cfg, ..) = config(&env, &sac.address());
    cfg.dispute_window = MIN_WINDOW - 1;
    env.register(EscrowContract, (cfg,));
}

#[test]
#[should_panic]
fn verdict_and_court_authorities_must_differ() {
    let env = Env::default();
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let (mut cfg, ..) = config(&env, &sac.address());
    cfg.court_authority = cfg.verdict_authority.clone();
    env.register(EscrowContract, (cfg,));
}

#[test]
fn zero_fee_deployment_pays_the_full_reward() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(START);
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let token = TokenClient::new(&env, &sac.address());
    let (mut cfg, ..) = config(&env, &sac.address());
    cfg.fee_bps = 0;
    let fee_to = cfg.fee_recipient.clone();
    let c = EscrowContractClient::new(&env, &env.register(EscrowContract, (cfg,)));
    let poster = Address::generate(&env);
    let agent = Address::generate(&env);
    StellarAssetClient::new(&env, &sac.address()).mint(&poster, &REWARD);
    c.post_task(&poster, &1, &REWARD, &DEADLINE, &h32(&env, 1));
    c.submit(&1, &agent, &h32(&env, 2));
    c.release_to_winner(&1, &agent, &80, &h32(&env, 3));
    env.ledger().set_timestamp(START + DAY + 1);
    c.finalize(&1);
    assert_eq!(token.balance(&agent), REWARD);
    assert_eq!(token.balance(&fee_to), 0);
}
