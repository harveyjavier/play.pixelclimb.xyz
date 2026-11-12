# Pixel Climb (web)

The browser version of [Pixel Climb](https://play.google.com/store/apps/details?id=com.harvz.pixelclimb), with a MetaMask wallet that signs for a **NEAR testnet** account.

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

### Economy

The in-game currency is **$PCMB**, a NEP-141 token on NEAR testnet at [`pcmb.pixelclimb.testnet`](https://testnet.nearblocks.io/token/pcmb.pixelclimb.testnet) (5,000,000 supply, 9 decimals). It also serves as the governance token. MetaMask shows it as a normal token at `0x937ca2395d64855e08c74c30947a545eef6c1bf1` on NEAR Protocol Testnet. The contract is in [`contracts/pcmb-token`](contracts/pcmb-token).

The game economy runs in a second contract at [`economy.pixelclimb.testnet`](https://testnet.nearblocks.io/address/economy.pixelclimb.testnet), with the code in [`contracts/economy`](contracts/economy):

- **Earn.** Each round has a prize pool of $PCMB. When the round ends, the pool is split among players by their best floor.
- **Spend.** A gem (a revive) costs $PCMB. The price rises 5% with each purchase and drops 1% a minute when nobody buys.
- **Recycle.** Every $PCMB spent on gems goes into the next round's pool.

The first pool holds 10,000 $PCMB. The play page does not call the economy contract yet: the wallet connects, but no transactions are sent. Wiring runs and revives to it is the next step.

## Try it (judges)

Requirements: Node 22+, [pnpm](https://pnpm.io), and a desktop browser with [MetaMask](https://metamask.io). Brave's built-in wallet can block the game; use Chrome, Chromium or Firefox.

```sh
pnpm install
pnpm dev
```

1. Open the URL Vite prints (usually http://localhost:5173). The game loads in the 2:3 frame.
2. Click **Connect MetaMask** and approve the account request.
3. Approve **Add network** / **Switch network**. MetaMask now shows _NEAR Protocol Testnet_, and the nav shows your `0x…` address.
4. Click the address to open the account on testnet.nearblocks.io.
5. Reload the page. You stay connected.
6. In MetaMask, switch to any other network; the app disconnects. Click **Disconnect** to revoke the site's access.

Checks: `pnpm check` (types) and `pnpm lint`.

## Project layout

- `src/routes/+page.svelte`: the 2:3 game page and wallet nav
- `src/lib/connect-wallet.svelte`: MetaMask to NEAR testnet (chain 398)
- `static/game/`: the game's Solar2D HTML5 build (compiled output, served as-is)
- `contracts/pcmb-token/`: the $PCMB token contract (Rust, NEP-141)
- `contracts/economy/`: the economy contract (Rust): prize pool, runs and gem shop

## Built during the hackathon

- Baseline: tag [`pre-hackathon`](../../tree/pre-hackathon), the empty SvelteKit template.
- Submission: tag `hackathon-submission`, added on the final commit.
- Everything built in the hackathon: [`pre-hackathon...main`](../../compare/pre-hackathon...main).

**Pre-existing work:** the Pixel Climb game itself (the Solar2D build in `static/game/`) existed before 1 Nov 2026. It is committed here as compiled output only. What was built during the hackathon is this web app: the play page and the NEAR testnet wallet integration.

## Credits

- [SvelteKit](https://svelte.dev) and [Svelte 5](https://svelte.dev), scaffolded with `sv` 1.3.0 (minimal template, TypeScript, Prettier, ESLint, Vercel adapter)
- [Solar2D](https://solar2d.com) HTML5 runtime for the game build
- [MetaMask](https://metamask.io) and NEAR's Ethereum RPC for the wallet
- AI tools: parts of the web app code and this README were written with AI coding tools and reviewed by the team.

## License

[MIT](LICENSE)
