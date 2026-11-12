use super::*;
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::{test_vm_config, testing_env, PromiseResult, RuntimeFeesConfig};

const PCMB: u128 = 1_000_000_000; // 9 decimals
const START: u64 = 1_000 * NS_PER_MINUTE;

fn owner() -> AccountId {
    accounts(0)
}
fn server() -> AccountId {
    accounts(1)
}
fn token() -> AccountId {
    "pcmb.testnet".parse().unwrap()
}
fn alice() -> AccountId {
    accounts(2)
}
fn bob() -> AccountId {
    accounts(3)
}
fn carol() -> AccountId {
    accounts(4)
}

fn config() -> Config {
    Config {
        round_minutes: 5,
        gem_base_price: U128(10 * PCMB),
        price_step_bps: 500,
        price_decay_bps: 100,
        min_floor: 10,
    }
}

/// Sets the caller and the block time (minutes after START) for the next contract call.
fn at(minutes: u64, caller: AccountId) {
    testing_env!(VMContextBuilder::new()
        .current_account_id("economy.testnet".parse().unwrap())
        .predecessor_account_id(caller)
        .block_timestamp(START + minutes * NS_PER_MINUTE)
        .build());
}

fn setup() -> Economy {
    at(0, owner());
    Economy::new(owner(), server(), token(), config())
}

/// Calls ft_on_transfer as the token contract, at the current mocked block time.
fn transfer_in(c: &mut Economy, sender: AccountId, amount: u128, msg: &str) {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(token())
        .block_timestamp(env::block_timestamp())
        .build());
    let _ = c.ft_on_transfer(sender, U128(amount), msg.into());
}

fn deposit(c: &mut Economy, player: AccountId, amount: u128) {
    transfer_in(c, player, amount, "");
}

fn seed_pool(c: &mut Economy, amount: u128) {
    transfer_in(c, owner(), amount, "pool");
}

// ---------- price rule ----------

#[test]
fn decayed_price_drops_one_percent_a_minute() {
    assert_eq!(decayed_price(1000, 100, 100, 0), 1000);
    assert_eq!(decayed_price(1000, 100, 100, 1), 990);
    assert_eq!(decayed_price(1000, 100, 100, 2), 980); // 990 * 0.99 = 980.1, rounded down
}

#[test]
fn decayed_price_never_below_base() {
    assert_eq!(decayed_price(1000, 950, 100, 60), 950);
    assert_eq!(decayed_price(1000, 950, 100, u64::MAX), 950); // stops at base, no huge loop
    assert_eq!(decayed_price(1000, 1, 10_000, 1), 1); // 100% decay lands on base
}

#[test]
fn decayed_price_loop_is_capped() {
    // 1 bps a minute for a year would loop 525,600 times; the cap stops at 10,000 steps.
    let after_cap = decayed_price(10u128.pow(30), 1, 1, 10_000);
    assert_eq!(decayed_price(10u128.pow(30), 1, 1, 525_600), after_cap);
    assert!(after_cap > 1 && after_cap < 10u128.pow(30));
}

#[test]
fn decayed_price_without_decay_stays() {
    assert_eq!(decayed_price(1000, 100, 0, u64::MAX), 1000);
}

#[test]
fn price_starts_at_base() {
    let c = setup();
    assert_eq!(c.get_state().gem_price, U128(10 * PCMB));
}

#[test]
fn price_rises_five_percent_per_gem_then_decays_to_base() {
    let mut c = setup();
    deposit(&mut c, alice(), 100 * PCMB);
    at(0, alice());
    assert_eq!(c.buy_gem(alice()), U128(10 * PCMB));
    assert_eq!(c.get_state().gem_price, U128(10_500_000_000));
    assert_eq!(c.buy_gem(alice()), U128(10_500_000_000));
    assert_eq!(c.get_state().gem_price, U128(11_025_000_000));

    at(1, alice()); // one minute without a purchase: -1%
    assert_eq!(c.get_state().gem_price, U128(10_914_750_000));
    at(2, alice());
    assert_eq!(c.get_state().gem_price, U128(10_805_602_500));
    at(600, alice()); // long quiet spell: back to base, not below
    assert_eq!(c.get_state().gem_price, U128(10 * PCMB));
}

#[test]
fn partial_minute_does_not_decay() {
    let mut c = setup();
    deposit(&mut c, alice(), 100 * PCMB);
    at(0, alice());
    c.buy_gem(alice());
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(alice())
        .block_timestamp(START + NS_PER_MINUTE - 1)
        .build());
    assert_eq!(c.get_state().gem_price, U128(10_500_000_000));
}

// ---------- gem shop ----------

#[test]
fn buy_gem_moves_payment_into_next_pool() {
    let mut c = setup();
    seed_pool(&mut c, 10_000 * PCMB);
    deposit(&mut c, alice(), 25 * PCMB);
    at(1, alice());
    c.buy_gem(alice());
    let p = c.get_player(alice());
    assert_eq!(p.balance, U128(15 * PCMB));
    assert_eq!(p.gems, 1);
    let s = c.get_state();
    assert_eq!(s.pool, U128(10_000 * PCMB)); // current pool is fixed
    assert_eq!(s.next_pool, U128(10 * PCMB));
}

#[test]
fn server_can_buy_for_player() {
    let mut c = setup();
    deposit(&mut c, alice(), 10 * PCMB);
    at(0, server());
    c.buy_gem(alice());
    assert_eq!(c.get_player(alice()).gems, 1);
}

#[test]
#[should_panic(expected = "Only the player or the game server can buy a gem")]
fn stranger_cannot_spend_someone_elses_balance() {
    let mut c = setup();
    deposit(&mut c, alice(), 10 * PCMB);
    at(0, bob());
    c.buy_gem(alice());
}

#[test]
#[should_panic(expected = "Not enough PCMB for a gem")]
fn buy_gem_needs_balance() {
    let mut c = setup();
    deposit(&mut c, alice(), 10 * PCMB - 1);
    at(0, alice());
    c.buy_gem(alice());
}

// ---------- runs ----------

#[test]
fn record_run_keeps_best_floor() {
    let mut c = setup();
    at(1, server());
    c.record_run(alice(), 12);
    c.record_run(alice(), 8);
    assert_eq!(c.get_player(alice()).best_floor, 12);
    c.record_run(alice(), 20);
    assert_eq!(c.get_player(alice()).best_floor, 20);
    assert_eq!(c.get_state().players_this_round, 1);
}

#[test]
#[should_panic(expected = "Only the game server can record runs")]
fn record_run_is_server_only() {
    let mut c = setup();
    at(1, alice());
    c.record_run(alice(), 99);
}

#[test]
#[should_panic(expected = "Round is over: call settle_round first")]
fn record_run_rejected_after_round_end() {
    let mut c = setup();
    at(5, server());
    c.record_run(alice(), 12);
}

// ---------- settlement ----------

#[test]
fn settle_splits_pool_by_best_floor() {
    let mut c = setup();
    seed_pool(&mut c, 10_000 * PCMB);
    at(1, server());
    c.record_run(alice(), 30);
    c.record_run(bob(), 10);
    c.record_run(alice(), 15); // lower run does not count
    at(5, carol()); // anyone can settle once the round is over
    c.settle_round();
    assert_eq!(c.get_player(alice()).balance, U128(7_500 * PCMB));
    assert_eq!(c.get_player(bob()).balance, U128(2_500 * PCMB));
    let s = c.get_state();
    assert_eq!(s.round, 2);
    assert_eq!(s.pool, U128(0));
    assert_eq!(s.players_this_round, 0);
    assert_eq!(s.round_ends_at_ms, (START + 10 * NS_PER_MINUTE) / 1_000_000);
    assert_eq!(c.get_player(alice()).best_floor, 0); // best floors reset each round
}

#[test]
fn players_below_min_floor_earn_nothing() {
    let mut c = setup();
    seed_pool(&mut c, 1_000 * PCMB);
    at(1, server());
    c.record_run(alice(), 10); // exactly the minimum counts
    c.record_run(bob(), 9);
    at(5, owner());
    c.settle_round();
    assert_eq!(c.get_player(alice()).balance, U128(1_000 * PCMB));
    assert_eq!(c.get_player(bob()).balance, U128(0));
}

#[test]
fn unpaid_pool_and_rounding_dust_roll_into_next_round() {
    let mut c = setup();
    seed_pool(&mut c, 100);
    at(1, server());
    c.record_run(alice(), 10);
    c.record_run(bob(), 10);
    c.record_run(carol(), 10);
    at(5, owner());
    c.settle_round();
    for p in [alice(), bob(), carol()] {
        assert_eq!(c.get_player(p).balance, U128(33));
    }
    assert_eq!(c.get_state().pool, U128(1)); // 100 - 3 * 33

    // No one qualifies: the whole pool carries over.
    at(6, server());
    c.record_run(alice(), 3);
    at(10, owner());
    c.settle_round();
    assert_eq!(c.get_state().pool, U128(1));
    assert_eq!(c.get_player(alice()).balance, U128(33));
}

#[test]
fn gem_payments_fund_the_next_round() {
    let mut c = setup();
    seed_pool(&mut c, 10_000 * PCMB);
    deposit(&mut c, carol(), 10 * PCMB);
    at(1, server());
    c.record_run(alice(), 20);
    at(2, carol());
    c.buy_gem(carol());
    at(5, owner());
    c.settle_round();
    assert_eq!(c.get_player(alice()).balance, U128(10_000 * PCMB));
    let s = c.get_state();
    assert_eq!(s.pool, U128(10 * PCMB));
    assert_eq!(s.next_pool, U128(0));

    // Round 2: alice earns the gem money and spends it on a gem.
    at(6, server());
    c.record_run(alice(), 11);
    at(10, owner());
    c.settle_round();
    assert_eq!(c.get_player(alice()).balance, U128(10_010 * PCMB));
}

#[test]
fn full_cycle_conserves_tokens() {
    let mut c = setup();
    seed_pool(&mut c, 10_000 * PCMB);
    deposit(&mut c, bob(), 50 * PCMB);
    at(1, server());
    c.record_run(alice(), 17);
    c.record_run(bob(), 23);
    c.record_run(carol(), 41);
    at(2, bob());
    c.buy_gem(bob());
    c.buy_gem(bob());
    at(5, owner());
    c.settle_round();
    let held: u128 = [alice(), bob(), carol()]
        .iter()
        .map(|p| c.get_player(p.clone()).balance.0)
        .sum();
    let s = c.get_state();
    assert_eq!(held + s.pool.0 + s.next_pool.0, 10_050 * PCMB);
}

#[test]
#[should_panic(expected = "Round is still running")]
fn settle_waits_for_round_end() {
    let mut c = setup();
    at(4, owner());
    c.settle_round();
}

// ---------- token in and out ----------

#[test]
#[should_panic(expected = "Only PCMB is accepted")]
fn only_pcmb_is_accepted() {
    let mut c = setup();
    at(0, "fake-token.testnet".parse().unwrap());
    let _ = c.ft_on_transfer(alice(), U128(1_000 * PCMB), "".into());
}

#[test]
fn unknown_transfer_msg_is_refunded() {
    let mut c = setup();
    at(0, token());
    match c.ft_on_transfer(alice(), U128(5), "huh".into()) {
        PromiseOrValue::Value(unused) => assert_eq!(unused, U128(5)),
        _ => panic!("expected a value"),
    }
    assert_eq!(c.get_player(alice()).balance, U128(0));
    assert_eq!(c.get_state().pool, U128(0));
}

#[test]
fn withdraw_debits_and_failed_transfer_restores() {
    let mut c = setup();
    deposit(&mut c, alice(), 30 * PCMB);
    at(0, alice());
    let _ = c.withdraw(U128(20 * PCMB));
    assert_eq!(c.get_player(alice()).balance, U128(10 * PCMB));

    let ctx = VMContextBuilder::new()
        .current_account_id("economy.testnet".parse().unwrap())
        .predecessor_account_id("economy.testnet".parse().unwrap())
        .build();
    testing_env!(
        ctx.clone(),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Failed]
    );
    assert!(!c.on_withdraw(alice(), U128(20 * PCMB)));
    assert_eq!(c.get_player(alice()).balance, U128(30 * PCMB));

    testing_env!(
        ctx,
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(vec![])]
    );
    assert!(c.on_withdraw(alice(), U128(20 * PCMB)));
    assert_eq!(c.get_player(alice()).balance, U128(30 * PCMB)); // success leaves the debit in place
}

#[test]
#[should_panic(expected = "Not enough PCMB to withdraw")]
fn withdraw_needs_balance() {
    let mut c = setup();
    at(0, alice());
    let _ = c.withdraw(U128(1));
}

#[test]
#[should_panic(expected = "Not enough PCMB to withdraw")]
fn withdraw_zero_rejected() {
    let mut c = setup();
    deposit(&mut c, alice(), 1);
    at(0, alice());
    let _ = c.withdraw(U128(0));
}

// ---------- owner settings ----------

#[test]
fn owner_can_tune_settings() {
    let mut c = setup();
    let mut new = config();
    new.round_minutes = 1440;
    new.gem_base_price = U128(20 * PCMB);
    new.min_floor = 5;
    at(1, owner());
    c.set_config(new.clone());
    let s = c.get_state();
    assert_eq!(s.config, new);
    assert_eq!(s.gem_price, U128(20 * PCMB));
    c.set_server(carol());
    assert_eq!(c.get_state().server, carol());
}

#[test]
#[should_panic(expected = "Only the owner can change settings")]
fn only_owner_tunes_settings() {
    let mut c = setup();
    at(1, server());
    c.set_config(config());
}

#[test]
#[should_panic(expected = "Only the owner can change settings")]
fn only_owner_sets_server() {
    let mut c = setup();
    at(1, alice());
    c.set_server(alice());
}

#[test]
#[should_panic(expected = "price_decay_bps must be at most 10000")]
fn rejects_bad_config() {
    let mut c = setup();
    let mut bad = config();
    bad.price_decay_bps = 10_001;
    at(1, owner());
    c.set_config(bad);
}

#[test]
#[should_panic(expected = "price_step_bps must be at most 10000")]
fn rejects_huge_price_step() {
    let mut c = setup();
    let mut bad = config();
    bad.price_step_bps = 10_001;
    at(1, owner());
    c.set_config(bad);
}
