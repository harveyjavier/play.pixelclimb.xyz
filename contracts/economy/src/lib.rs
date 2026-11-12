//! Pixel Climb economy on NEAR: each round has a fixed $PCMB pool that is split by best floor,
//! players spend $PCMB on gems to revive, and every gem payment funds the next round's pool.
//!
//! $PCMB enters through `ft_transfer_call` on the token (msg `""` credits the sender, msg `"pool"`
//! adds to the current pool) and leaves through `withdraw`. Between the two it is an internal balance,
//! so payouts and gem purchases never need a cross-contract call.

use near_contract_standards::fungible_token::core::ext_ft_core;
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    env, log, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError, PromiseOrValue,
};

const NS_PER_MINUTE: u64 = 60_000_000_000;
const BPS: u128 = 10_000;
const MAX_ROUND_MINUTES: u64 = 366 * 24 * 60;
/// Caps the decay loop so a bad config can't make `gem_price` (and so `set_config`) run out of gas.
const MAX_DECAY_STEPS: u64 = 10_000;

/// Gem price after `minutes` without a purchase: it drops `decay_bps` per minute and never goes below `base`.
pub fn decayed_price(last: u128, base: u128, decay_bps: u32, minutes: u64) -> u128 {
    let mut price = last;
    for _ in 0..minutes.min(MAX_DECAY_STEPS) {
        if price <= base || decay_bps == 0 {
            break;
        }
        price = price * (BPS - decay_bps as u128) / BPS;
    }
    price.max(base)
}

/// Owner-tunable settings. Amounts are raw $PCMB units (9 decimals).
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    /// Round length: 1440 in production, 5 for the demo. A change applies from the next round.
    pub round_minutes: u64,
    pub gem_base_price: U128,
    /// Price rise per gem bought, in basis points (500 = +5%).
    pub price_step_bps: u32,
    /// Price drop per minute without a purchase, in basis points (100 = -1%).
    pub price_decay_bps: u32,
    /// Best floor a player needs to share the pool.
    pub min_floor: u32,
}

impl Config {
    fn assert_valid(&self) {
        require!(
            self.round_minutes > 0 && self.round_minutes <= MAX_ROUND_MINUTES,
            "round_minutes must be between 1 and a year"
        );
        require!(self.gem_base_price.0 > 0, "gem_base_price must be above 0");
        require!(
            self.price_step_bps as u128 <= BPS,
            "price_step_bps must be at most 10000"
        );
        require!(
            self.price_decay_bps as u128 <= BPS,
            "price_decay_bps must be at most 10000"
        );
    }
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Default)]
pub struct Player {
    pub balance: U128,
    /// Gems bought (revives) over all rounds.
    pub gems: u32,
}

#[near(serializers = [json])]
pub struct PlayerView {
    /// Best floor in the current round (0 if no run yet).
    pub best_floor: u32,
    pub balance: U128,
    pub gems: u32,
}

#[near(serializers = [json])]
pub struct StateView {
    pub round: u64,
    pub round_ends_at_ms: u64,
    pub pool: U128,
    pub next_pool: U128,
    pub gem_price: U128,
    pub players_this_round: u32,
    pub token: AccountId,
    pub server: AccountId,
    pub owner: AccountId,
    pub config: Config,
}

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum Key {
    Best,
    Players,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Economy {
    owner: AccountId,
    /// Game server key: the only caller of `record_run`.
    server: AccountId,
    /// The $PCMB NEP-141 contract.
    token: AccountId,
    config: Config,
    round: u64,
    round_ends_at: u64,
    pool: u128,
    next_pool: u128,
    /// Price right after the last purchase (or config change), and when that was.
    last_price: u128,
    last_price_at: u64,
    // shortcut: settle_round walks every player of the round in one call; fine for the demo, shard or paginate it past a few thousand players a round.
    best: IterableMap<AccountId, u32>,
    players: LookupMap<AccountId, Player>,
}

#[near]
impl Economy {
    #[init]
    pub fn new(owner: AccountId, server: AccountId, token: AccountId, config: Config) -> Self {
        config.assert_valid();
        let now = env::block_timestamp();
        Self {
            owner,
            server,
            token,
            round: 1,
            round_ends_at: now + config.round_minutes * NS_PER_MINUTE,
            pool: 0,
            next_pool: 0,
            last_price: config.gem_base_price.0,
            last_price_at: now,
            config,
            best: IterableMap::new(Key::Best),
            players: LookupMap::new(Key::Players),
        }
    }

    /// Game server only: keep the player's best floor for the current round.
    pub fn record_run(&mut self, player: AccountId, floor: u32) {
        require!(
            env::predecessor_account_id() == self.server,
            "Only the game server can record runs"
        );
        require!(
            env::block_timestamp() < self.round_ends_at,
            "Round is over: call settle_round first"
        );
        if floor > self.best.get(&player).copied().unwrap_or(0) {
            self.best.insert(player, floor);
        }
    }

    /// Buy one gem (a revive) at the current price from the player's balance. The payment goes into the
    /// next round's pool and raises the price. Callable by the player, or by the game server for them.
    pub fn buy_gem(&mut self, player: AccountId) -> U128 {
        let caller = env::predecessor_account_id();
        require!(
            caller == player || caller == self.server,
            "Only the player or the game server can buy a gem"
        );
        let price = self.gem_price();
        let mut account = self.players.get(&player).cloned().unwrap_or_default();
        require!(account.balance.0 >= price, "Not enough PCMB for a gem");
        account.balance = U128(account.balance.0 - price);
        account.gems += 1;
        self.players.insert(player.clone(), account);
        self.next_pool += price;
        self.last_price = price * (BPS + self.config.price_step_bps as u128) / BPS;
        self.last_price_at = env::block_timestamp();
        log!("{player} bought a gem for {price}");
        U128(price)
    }

    /// Anyone, once the round is over: split the pool by best floor among players at or above the
    /// minimum floor, then start the next round with the gem payments plus any rounding leftover.
    pub fn settle_round(&mut self) {
        let now = env::block_timestamp();
        require!(now >= self.round_ends_at, "Round is still running");
        let min_floor = self.config.min_floor;
        let winners: Vec<(AccountId, u32)> = self
            .best
            .iter()
            .filter(|(_, floor)| **floor >= min_floor && **floor > 0)
            .map(|(player, floor)| (player.clone(), *floor))
            .collect();
        let total_floors: u128 = winners.iter().map(|(_, floor)| *floor as u128).sum();
        let mut paid = 0;
        for (player, floor) in winners {
            let share = self.pool * floor as u128 / total_floors;
            self.credit(&player, share);
            paid += share;
        }
        log!("Round {} settled: paid {paid} of {}", self.round, self.pool);
        self.pool = self.pool - paid + self.next_pool;
        self.next_pool = 0;
        self.best.clear();
        self.round += 1;
        self.round_ends_at = now + self.config.round_minutes * NS_PER_MINUTE;
    }

    /// Send `amount` of the caller's balance to their $PCMB wallet. Needs the caller registered on the
    /// token (storage_deposit); if the transfer fails the balance is restored.
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        let player = env::predecessor_account_id();
        let mut account = self.players.get(&player).cloned().unwrap_or_default();
        require!(
            amount.0 > 0 && account.balance.0 >= amount.0,
            "Not enough PCMB to withdraw"
        );
        account.balance = U128(account.balance.0 - amount.0);
        self.players.insert(player.clone(), account);
        ext_ft_core::ext(self.token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(Gas::from_tgas(10))
            .ft_transfer(
                player.clone(),
                amount,
                Some("Pixel Climb withdrawal".into()),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(5))
                    .on_withdraw(player, amount),
            )
    }

    #[private]
    pub fn on_withdraw(&mut self, player: AccountId, amount: U128) -> bool {
        // ft_transfer returns nothing; only a failed transfer counts, never the return value's size.
        let ok = !matches!(env::promise_result_checked(0, 0), Err(PromiseError::Failed));
        if !ok {
            self.credit(&player, amount.0);
            log!(
                "Withdrawal of {} to {player} failed; balance restored",
                amount.0
            );
        }
        ok
    }

    pub fn set_config(&mut self, config: Config) {
        self.assert_owner();
        config.assert_valid();
        // Lock in the price under the old rule so the new one applies from now on.
        self.last_price = self.gem_price().max(config.gem_base_price.0);
        self.last_price_at = env::block_timestamp();
        self.config = config;
    }

    pub fn set_server(&mut self, server: AccountId) {
        self.assert_owner();
        self.server = server;
    }

    pub fn get_state(&self) -> StateView {
        StateView {
            round: self.round,
            round_ends_at_ms: self.round_ends_at / 1_000_000,
            pool: U128(self.pool),
            next_pool: U128(self.next_pool),
            gem_price: U128(self.gem_price()),
            players_this_round: self.best.len(),
            token: self.token.clone(),
            server: self.server.clone(),
            owner: self.owner.clone(),
            config: self.config.clone(),
        }
    }

    pub fn get_player(&self, player: AccountId) -> PlayerView {
        let account = self.players.get(&player).cloned().unwrap_or_default();
        PlayerView {
            best_floor: self.best.get(&player).copied().unwrap_or(0),
            balance: account.balance,
            gems: account.gems,
        }
    }
}

impl Economy {
    fn gem_price(&self) -> u128 {
        let minutes = (env::block_timestamp() - self.last_price_at) / NS_PER_MINUTE;
        decayed_price(
            self.last_price,
            self.config.gem_base_price.0,
            self.config.price_decay_bps,
            minutes,
        )
    }

    fn credit(&mut self, player: &AccountId, amount: u128) {
        let mut account = self.players.get(player).cloned().unwrap_or_default();
        account.balance = U128(account.balance.0 + amount);
        self.players.insert(player.clone(), account);
    }

    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner,
            "Only the owner can change settings"
        );
    }
}

#[near]
impl FungibleTokenReceiver for Economy {
    /// $PCMB sent with `ft_transfer_call`: msg `""` credits the sender's balance, `"pool"` adds to the
    /// current round's pool. Any other msg is refunded.
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(
            env::predecessor_account_id() == self.token,
            "Only PCMB is accepted"
        );
        match msg.as_str() {
            "" => self.credit(&sender_id, amount.0),
            "pool" => self.pool += amount.0,
            _ => return PromiseOrValue::Value(amount),
        }
        PromiseOrValue::Value(U128(0))
    }
}

#[cfg(test)]
mod tests;
