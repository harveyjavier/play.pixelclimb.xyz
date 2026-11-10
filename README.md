# PixelClimb

A browser game served in a 2:3 frame (full screen on phones), with a MetaMask wallet that signs for a **NEAR testnet** account.

Built for [NEAR HACKATHON](https://nearhackathon.com/) (1–14 Nov 2026), track **Games With Real Economies**.

> TODO before submitting: one paragraph on the game, the problem it solves, and the in-game economy.

## How NEAR fits in

The player connects MetaMask, and the app switches it to **NEAR Protocol Testnet** through NEAR's Ethereum-compatible RPC ([NEP-518](https://github.com/near/NEPs/issues/518)):

| Setting  | Value                              |
| -------- | ---------------------------------- |
| Chain ID | `398` (`0x18e`)                    |
| RPC      | `https://eth-rpc.testnet.near.org` |
| Currency | NEAR (18 decimals)                 |
| Explorer | `https://testnet.nearblocks.io`    |

The player's `0x…` address is their NEAR account, so players use the wallet they already have and need no new NEAR account. The code is in [`src/lib/connect-wallet.svelte`](src/lib/connect-wallet.svelte).

> TODO: describe the on-chain game economy (contract, methods, what the game writes) once it exists.

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
5. In MetaMask, switch to any other network; the app disconnects. Click **Disconnect** to revoke the site's access.

Checks: `pnpm check` (types) and `pnpm lint`.

## Project layout

- `src/routes/+page.svelte`: the 2:3 game page and wallet nav
- `src/lib/connect-wallet.svelte`: MetaMask to NEAR testnet (chain 398)
- `static/game/`: the game's Solar2D HTML5 build (compiled output, served as-is)

## Built during the hackathon

- Baseline: tag [`pre-hackathon`](../../tree/pre-hackathon), the empty SvelteKit template.
- Submission: tag `hackathon-submission`.
- Everything built in the hackathon: [`pre-hackathon...hackathon-submission`](../../compare/pre-hackathon...hackathon-submission).

> TODO: say whether the Solar2D game in `static/game/` existed before 1 Nov 2026. If it did, list it as pre-existing; only the NEAR integration is judged.

## Credits

- [SvelteKit](https://svelte.dev) and [Svelte 5](https://svelte.dev), scaffolded with `sv` 1.3.0 (minimal template, TypeScript, Prettier, ESLint, Vercel adapter)
- [Solar2D](https://solar2d.com) HTML5 runtime for the game build
- [MetaMask](https://metamask.io) and NEAR's Ethereum RPC for the wallet
- AI-generated code: the wallet integration and this README were written with Claude Code (Anthropic) and reviewed by the team.

## License

[MIT](LICENSE)
