# Pixel Climb (web)

The browser version of [Pixel Climb](https://play.google.com/store/apps/details?id=com.harvz.pixelclimb), where players earn and spend **$PCMB** on **NEAR testnet** without a wallet popup. MetaMask can also connect an existing wallet.

Built for [NEAR HACKATHON](https://nearhackathon.com/) (1–14 Nov 2026), track **Games With Real Economies**.

Pixel Climb is a one-tap climbing game. You tap to jump between walls, collect gems on the way up and try to beat your best floor. It is already live on Google Play. This repo puts the same game in the browser so players can try it without installing anything, and connects their wallet on NEAR.

The landing site lives in a separate repo, [hsjtechnologies/pixelclimb.xyz](https://github.com/hsjtechnologies/pixelclimb.xyz). Both repos are the same entry.

## How NEAR fits in

The player connects MetaMask, and the app switches it to **NEAR Protocol Testnet** through NEAR's Ethereum-compatible RPC ([NEP-518](https://github.com/near/NEPs/issues/518)):

| Setting  | Value                              |
| -------- | ---------------------------------- |
| Chain ID | `398` (`0x18e`)                    |
| RPC      | `https://eth-rpc.testnet.near.org` |
| Currency | NEAR (18 decimals)                 |
| Explorer | `https://testnet.nearblocks.io`    |

The player's `0x…` address is their NEAR account, so players use the wallet they already have and need no new NEAR account. The code is in [`src/lib/connect-wallet.svelte`](src/lib/connect-wallet.svelte).

### Check it without a wallet

```sh
pnpm verify
```

This reads NEAR testnet and prints the $PCMB supply, the prize pool, the gem price and the round end. It also checks that the token and economy contracts on testnet are the same code as [`contracts/`](contracts) in this repo. It needs no wallet or keys. `pnpm verify` needs the same Node as the rest of the repo (22.22.2 or newer). Without pnpm, `node scripts/verify.mjs` does the same on Node 22 and needs no install.

### Economy

The in-game currency is **$PCMB**, a NEP-141 token on NEAR testnet at [`pcmb.pixelclimb.testnet`](https://testnet.nearblocks.io/token/pcmb.pixelclimb.testnet) (5,000,000 supply, 9 decimals). It also serves as the governance token. MetaMask shows it as a normal token at `0x937ca2395d64855e08c74c30947a545eef6c1bf1` on NEAR Protocol Testnet. The contract is in [`contracts/pcmb-token`](contracts/pcmb-token).

The game economy runs in a second contract at [`economy.pixelclimb.testnet`](https://testnet.nearblocks.io/address/economy.pixelclimb.testnet), with the code in [`contracts/economy`](contracts/economy):

- **Earn.** Each round has a prize pool of $PCMB. When the round ends, the pool is split among players by their best floor.
- **Spend.** A gem (a revive) costs $PCMB. The price rises 5% with each purchase and drops 1% a minute when nobody buys.
- **Recycle.** Every $PCMB spent on gems goes into the next round's pool.

The first pool holds 10,000 $PCMB.

### Your wallet is your account

The connected MetaMask address is the player's account: runs, payouts and revives all go to it. NEAR takes the lowercase `0x…` address as an account id ([NEP-518](https://github.com/near/NEPs/issues/518)). Without a wallet you can play, but runs aren't saved and nothing is earned.

MetaMask only asks once. On a player's first visit the page makes an ed25519 key in the browser (`localStorage`), and on connect the wallet signs a message that lets this key play for it (`personal_sign`). After that the page signs each request with the browser key and sends the wallet's signature along, so a run or a revive never opens MetaMask. The code is in [`src/lib/player.ts`](src/lib/player.ts) and [`src/lib/connect-wallet.svelte`](src/lib/connect-wallet.svelte).

The game server sends every transaction and pays the fees. The economy contract lets the `server` account record runs, buy gems, move a browser account's earnings to its wallet and withdraw to a player's own wallet, so players never sign a NEAR transaction. Before relaying, the server checks the browser key's signature and that the wallet itself signed the link. A signed request expires after a minute and can be used once.

| Endpoint             | What it does                                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/state`     | Round, pool, time left and gem price. With `?player=` (a wallet), also that player's best floor, balance and gems                                                                                                                                |
| `POST /api/link`     | Signed, after the wallet signs the link. Calls `merge_player` to move anything the browser account earned before (balance, gems, this round's best floor) to the wallet; skipped when there is nothing to move                                   |
| `POST /api/withdraw` | Signed. Calls `withdraw_for` to send the wallet's whole balance to the wallet, so it shows in MetaMask and on NearBlocks. The contract registers the wallet on the token first (0.00125 NEAR from the economy account)                           |
| `POST /api/run`      | Signed. Rejects a floor that can't be reached in the run's time (more than 1 floor a second, runs up to an hour). Pays out the round if it has ended, then calls `record_run` when the floor is at least the minimum and beats the player's best |
| `POST /api/revive`   | Signed, with the gem count the page saw, so a copied request stops working after one purchase. Calls `buy_gem`; the page then tells the game to continue the run                                                                                 |
| `POST /api/settle`   | Pays out the round if it has ended. Each open page calls it at a random moment in the 10 seconds after the countdown ends, so winnings show without waiting for someone's next run                                                               |

When a run ends, the game sends `pc:gameover` with an `id`, the floor, gems and duration ([pixel-climb#1](https://github.com/hsjtechnologies/pixel-climb/pull/1)). The page saves the run and offers **Revive for N $PCMB** or **End run**, then replies `pc:revive` or `pc:end` with the same `id`.

Known limits:

- The run's duration comes from the browser, so the check stops impossible runs, not someone who sends a made-up but possible one. Nothing stops one person from playing with several wallets either, and each saved run costs the server gas.
- Copies of one request sent at the same moment to different server instances can both get through; a shared store would close that.
- Winnings stay in the economy contract as an in-game balance until the player clicks **Withdraw**, so revives can be paid without a popup.
- The link signature is saved per browser. A new browser or device asks MetaMask to sign once more; the balance stays with the wallet.
- Each first withdrawal to a new wallet costs the economy account 0.00125 NEAR for token storage. Keep it topped up.

### Rebuilding the game

`static/game/` is built from the Solar2D project at [hsjtechnologies/pixel-climb](https://github.com/hsjtechnologies/pixel-climb) with:

```sh
scripts/game-web/build.sh /path/to/pixel-climb
```

It needs Docker, `gh`, `unzip`, `zip` and Node, and works on Linux. Solar2D's command-line builder can't target HTML5, so the script builds the game for Linux with the last Solar2D release that has a Linux builder (2024.3711, run in a container with no network), then packs the compiled game into Solar2D's HTML5 template ([`pack.mjs`](scripts/game-web/pack.mjs), which follows Solar2D's own `webPackageApp.lua`). On the way it:

- marks the game's Android/iOS plugins (Google Play Games, review popup, Twitter) as mobile-only, so the builder skips them;
- replaces the template's `alert()` calls, which would block the whole play page from inside the iframe, with a message in the game frame;
- patches two engine bugs: text with a zero line height, and a resize loop at some screen scales (a laptop at 125% to 180%) that left the game white after the intro.

### Game server setup

The server needs its own account with a key that can only call the economy contract, so a leaked key can't move NEAR. Run these once with the owner's key (near-cli-rs, legacy keychain):

```sh
OWNER=pixelclimb.testnet
ECONOMY=economy.$OWNER
SERVER=server.$OWNER

near account create-account fund-myself $SERVER '1 NEAR' autogenerate-new-keypair save-to-legacy-keychain sign-as $OWNER network-config testnet sign-with-legacy-keychain send
near account add-key $SERVER grant-function-call-access --allowance unlimited --contract-account-id $ECONOMY --function-names 'record_run, buy_gem, settle_round, merge_player, withdraw_for' autogenerate-new-keypair save-to-legacy-keychain network-config testnet sign-with-legacy-keychain send
near contract call-function as-transaction $ECONOMY set_server json-args "{\"server\":\"$SERVER\"}" prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as $OWNER network-config testnet sign-with-legacy-keychain send
```

The second command prints the path of the new key file. Its `private_key` goes in `NEAR_SERVER_KEY`, and `$SERVER` in `NEAR_SERVER_ACCOUNT`, as Vercel environment variables. See [`.env.example`](.env.example). The 1 NEAR pays for gas; top it up when it runs low.

## Try it (judges)

Requirements: Node 22.22.2 or newer, [pnpm](https://pnpm.io), and a desktop browser with [MetaMask](https://metamask.io). Brave's built-in wallet can block the game; use Chrome, Chromium or Firefox.

```sh
pnpm install
cp .env.example .env   # fill in NEAR_SERVER_ACCOUNT and NEAR_SERVER_KEY to save runs and buy revives
pnpm dev
```

1. Open the URL Vite prints (usually http://localhost:5173). The game loads in the 2:3 frame.
2. Click **Connect Wallet** and approve the account request.
3. Approve **Add network** / **Switch network**, then sign the message that lets this browser play for your wallet. MetaMask now shows _NEAR Protocol Testnet_, and the nav shows your `0x…` address.
4. Play past the minimum floor. When the round ends your share shows next to the round, under your address. Click **Withdraw** to send it to your wallet; it then shows in MetaMask and on NearBlocks.
5. Click the address to open the account on testnet.nearblocks.io.
6. Reload the page. You stay connected, and MetaMask doesn't ask again.
7. In MetaMask, switch to any other network; the app disconnects. Click **Disconnect** to revoke the site's access.

Checks: `pnpm check` (types), `pnpm lint` and `pnpm test` (request signing, the wallet link and the run check).

## Project layout

- `src/routes/+page.svelte`: the 2:3 game page, wallet nav, round and balance bar, and the game-over panel
- `src/routes/api/`: the game server endpoints (`state`, `run`, `revive`, `settle`, `link`, `withdraw`)
- `src/lib/economy.ts`: shared by page and server: contract types, the run check and request signing
- `src/lib/player.ts`: the browser key, the wallet link, and signed requests
- `src/lib/server/near.ts`: contract reads and server-signed calls
- `src/env.ts`: environment variables
- `src/lib/connect-wallet.svelte`: MetaMask to NEAR testnet (chain 398)
- `static/game/`: the game's Solar2D HTML5 build (compiled output, served as-is)
- `scripts/game-web/`: builds `static/game/` from the pixel-climb repo
- `static/fonts/`: the game's pixel font, used by the game-over panel
- `contracts/pcmb-token/`: the $PCMB token contract (Rust, NEP-141)
- `contracts/economy/`: the economy contract (Rust): prize pool, runs and gem shop

## Built during the hackathon

- Baseline: tag [`pre-hackathon`](../../tree/pre-hackathon), the empty SvelteKit template.
- Submission: tag `hackathon-submission`, added on the final commit.
- Everything built in the hackathon: [`pre-hackathon...main`](../../compare/pre-hackathon...main).

**Pre-existing work:** the Pixel Climb game itself (the Solar2D build in `static/game/`) existed before 1 Nov 2026. It is committed here as compiled output only. What was built during the hackathon is this web app (the play page, the wallet integration and the economy endpoints), the contracts in `contracts/`, the web build script in `scripts/game-web/`, and the game's web bridge and HTML5 changes in the pixel-climb repo ([pixel-climb#1](https://github.com/hsjtechnologies/pixel-climb/pull/1) and later).

## Credits

- [SvelteKit](https://svelte.dev) and [Svelte 5](https://svelte.dev), scaffolded with `sv` 1.3.0 (minimal template, TypeScript, Prettier, ESLint, Vercel adapter)
- [Solar2D](https://solar2d.com) HTML5 runtime for the game build
- [Silkscreen](https://kottke.org/plus/type/silkscreen/) pixel font by Jason Kottke, from the game, used in the game-over panel
- [MetaMask](https://metamask.io) and NEAR's Ethereum RPC for the wallet
- [near-api-js](https://github.com/near/near-api-js) and [FastNear](https://fastnear.com) RPC for the game server
- AI tools: parts of the web app code and this README were written with AI coding tools and reviewed by the team.

## License

[MIT](LICENSE)
