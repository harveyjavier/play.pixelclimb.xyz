# Pixel Climb economy contract

One NEAR contract that runs the $PCMB game economy (issue #8): it records runs, sells gems (revives) and pays out each round's pool.

## Deployed on testnet

| Field                 | Value                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| Contract              | [`economy.pixelclimb.testnet`](https://testnet.nearblocks.io/address/economy.pixelclimb.testnet) |
| Built from            | `1e66dc7`, code hash `3iiFVoCJMiMQinDPsvp2SYnQMRCHh98jhkonf6A8uD8X`                              |
| Owner and game server | `pixelclimb.testnet` (the server changes with `set_server` once the play page has its own key)   |
| Token                 | `pcmb.pixelclimb.testnet`                                                                        |
| Settings              | The demo column below                                                                            |
| First pool            | 10,000 $PCMB                                                                                     |

```sh
near contract call-function as-read-only economy.pixelclimb.testnet get_state json-args '{}' network-config testnet now
```

## How it works

- **Earn.** Each round has a pool. When the round ends, `settle_round` splits it among players whose best floor is at or above `min_floor`, in proportion to that floor. Rounding leftovers, and the whole pool if nobody qualifies, carry over to the next round. Then the next pool is topped up from the reserve to `round_pool`, so every round has a prize while the reserve lasts. A pool that carried over takes nothing more from the reserve.
- **Spend.** `buy_gem` takes the current gem price from the player's balance. Each gem raises the price by `price_step_bps`, and the price drops by `price_decay_bps` for every full minute without a purchase, never below `gem_base_price`. The rule is in `decayed_price` in [`src/lib.rs`](src/lib.rs).
- **Recycle.** Every gem payment goes into `next_pool`, which becomes the pool of the next round.

$PCMB comes in through the token's `ft_transfer_call`:

- msg `""` credits the sender's in-game balance.
- msg `"pool"` adds to the current round's pool, once.
- msg `"reserve"` adds to the reserve that tops up every round. The owner funds it.

`withdraw` sends a balance back to the player's wallet. In between, $PCMB is an internal balance, so payouts and gem purchases never need a cross-contract call.

## Methods

| Method                                      | Who can call                            | What it does                                                                 |
| ------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------- |
| `new(owner, server, token, config)`         | Deployer (init)                         | Sets accounts and settings, and starts round 1                               |
| `migrate(round_pool)`                       | The contract itself (init, once)        | Upgrades state from the version before the reserve; see **Upgrade**          |
| `record_run(player, floor)`                 | Game server only                        | Keeps the player's best floor for the current round                          |
| `buy_gem(player)`                           | The player, or the game server for them | Pays the current price from the balance into the next pool, raises the price |
| `settle_round()`                            | Anyone, after the round ends            | Pays the pool by best floor and starts the next round                        |
| `withdraw(amount)`                          | Player                                  | Sends $PCMB to the player's wallet (restored if the transfer fails)          |
| `withdraw_for(player, amount)`              | Game server only                        | Same as `withdraw`, for the player, and only to the player's own account     |
| `merge_player(from, to)`                    | Game server only                        | Moves balance, gems and this round's best floor from `from` to `to`          |
| `ft_on_transfer(sender_id, amount, msg)`    | The $PCMB token only                    | Deposit (`""`), pool (`"pool"`) or reserve (`"reserve"`); others refunded    |
| `set_config(config)` / `set_server(server)` | Owner                                   | Tunes settings without redeploying                                           |
| `get_state()`                               | Anyone (view)                           | Round, end time (ms), pool, next pool, reserve, gem price, settings          |
| `get_player(player)`                        | Anyone (view)                           | Best floor this round, balance, gems bought                                  |

Runs can't be recorded after the round ends. The game server calls `settle_round` first.

## Settings

Amounts are raw units (9 decimals, so `10000000000` = 10 $PCMB).

| Setting           | Demo                    | Production      |
| ----------------- | ----------------------- | --------------- |
| `round_minutes`   | `5`                     | `1440`          |
| `gem_base_price`  | `10000000000`           | `10000000000`   |
| `price_step_bps`  | `500` (+5%)             | `500`           |
| `price_decay_bps` | `100` (-1%/min)         | `100`           |
| `min_floor`       | `10`                    | `10`            |
| `round_pool`      | `1000000000000` (1,000) | `1000000000000` |

Reserve: 100,000 $PCMB (`100000000000000`), funded by the owner. At 1,000 a round that's 100 paid rounds, about 8 hours of 5-minute rounds if every round has a winner.

## Upgrade to the per-round pool

The version before the reserve stores its state without `reserve` and `round_pool`. Deploy this version with a one-time `migrate` call (signed by the economy account, which the deploy already is), then fund the reserve:

```sh
cargo near build non-reproducible-wasm
near contract deploy $ECONOMY use-file target/near/pixelclimb_economy.wasm with-init-call migrate json-args '{"round_pool":"1000000000000"}' prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send
near contract call-function as-transaction $TOKEN ft_transfer_call json-args "{\"receiver_id\":\"$ECONOMY\",\"amount\":\"100000000000000\",\"msg\":\"reserve\"}" prepaid-gas '100.0 Tgas' attached-deposit '1 yoctoNEAR' sign-as $OWNER network-config testnet sign-with-legacy-keychain send
```

The first top-up happens when the current round settles. Then update `economyCodeHash` in `scripts/verify.mjs` and the code hash above to the deployed one.

## Test and build

Requirements: [rustup](https://rustup.rs) and [cargo-near](https://github.com/near/cargo-near). `rust-toolchain.toml` pins Rust 1.95 and the wasm target, and rustup installs them on first build. Install cargo-near from its [prebuilt releases](https://github.com/near/cargo-near/releases); `cargo install cargo-near` can fail to link its bundled wasm-opt on newer GCC.

```sh
cargo test                                  # unit tests
cargo near build non-reproducible-wasm      # target/near/pixelclimb_economy.wasm
```

On Windows, add `--no-abi` to the build (the ABI step fails to link there). `.cargo/config.toml` sets `AWS_LC_SYS_PREBUILT_NASM` so tests build there without NASM.

## Deploy to testnet

Requirements: [near-cli-rs](https://github.com/near/near-cli-rs). The commands use the legacy keychain (`~/.near-credentials/testnet/`), where the `pixelclimb.testnet` keys are. If your keys are in the system keychain, use `sign-with-keychain` and `save-to-keychain` instead. Keys never go in this repo.
Set these first:

```sh
OWNER=pixelclimb.testnet      # owns the contract and holds the $PCMB supply
ECONOMY=economy.$OWNER
SERVER=$OWNER                 # until the play page's server key exists (#9); then `set_server`
TOKEN=pcmb.pixelclimb.testnet # the $PCMB contract (contracts/pcmb-token)
```

1. Create the contract account. The wasm is about 160 KB, which locks about 1.6 NEAR for storage:

   ```sh
   near account create-account fund-myself $ECONOMY '3 NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as $OWNER network-config testnet sign-with-legacy-keychain send
   ```

2. Deploy and initialize with the demo settings:

   ```sh
   cargo near deploy build-non-reproducible-wasm $ECONOMY with-init-call new json-args "{\"owner\":\"$OWNER\",\"server\":\"$SERVER\",\"token\":\"$TOKEN\",\"config\":{\"round_minutes\":5,\"gem_base_price\":\"10000000000\",\"price_step_bps\":500,\"price_decay_bps\":100,\"min_floor\":10,\"round_pool\":\"1000000000000\"}}" prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send
   ```

   If the ABI step fails on Windows, build with `cargo near build non-reproducible-wasm --no-abi`, then deploy the file with `near contract deploy $ECONOMY use-file target/near/pixelclimb_economy.wasm with-init-call new json-args …` and the same arguments.

3. Register the contract on the token so it can hold $PCMB. The token refunds any deposit above what it needs:

   ```sh
   near contract call-function as-transaction $TOKEN storage_deposit json-args "{\"account_id\":\"$ECONOMY\"}" prepaid-gas '30.0 Tgas' attached-deposit '0.01 NEAR' sign-as $OWNER network-config testnet sign-with-legacy-keychain send
   ```

4. Seed the first pool with 10,000 $PCMB:

   ```sh
   near contract call-function as-transaction $TOKEN ft_transfer_call json-args "{\"receiver_id\":\"$ECONOMY\",\"amount\":\"10000000000000\",\"msg\":\"pool\"}" prepaid-gas '100.0 Tgas' attached-deposit '1 yoctoNEAR' sign-as $OWNER network-config testnet sign-with-legacy-keychain send
   ```

5. Check it:

   ```sh
   near contract call-function as-read-only $ECONOMY get_state json-args '{}' network-config testnet now
   ```

`withdraw` and `withdraw_for` register the player on the token first (`storage_deposit`, 0.00125 NEAR from this contract's balance, refunded when already registered). The play page withdraws with `withdraw_for` and links a browser account to a wallet with `merge_player`. The game server account and its key are set up as described in the [root README](../../README.md#game-server-setup).
