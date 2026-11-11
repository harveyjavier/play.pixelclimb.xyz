# $PCMB token

The Pixel Climb token on NEAR: a NEP-141 fungible token with NEP-148 metadata. It mirrors the [Solana devnet token](https://explorer.solana.com/address/DuZq6LWkvRwLw5t2GqbSx3BeAtSeikDVf1VKraxbMLcs?cluster=devnet).

| Field    | Value                                                                                    |
| -------- | ---------------------------------------------------------------------------------------- |
| Contract | [`pcmb.pixelclimb.testnet`](https://testnet.nearblocks.io/token/pcmb.pixelclimb.testnet) |
| Owner    | `pixelclimb.testnet`                                                                     |
| Name     | Pixel Climb Token - Testnet                                                              |
| Symbol   | PCMB                                                                                     |
| Decimals | 9                                                                                        |
| Supply   | 5,000,000, minted to the owner at deploy                                                 |
| Minting  | The owner can mint more with `mint`                                                      |

## Check it

```sh
near contract call-function as-read-only pcmb.pixelclimb.testnet ft_total_supply json-args '{}' network-config testnet now
near contract call-function as-read-only pcmb.pixelclimb.testnet ft_metadata json-args '{}' network-config testnet now
```

`ft_total_supply` returns `"5000000000000000"` (5,000,000 with 9 decimals).

## Build and test

Needs [Rust](https://rustup.rs) (the version is pinned in `rust-toolchain.toml`) and [cargo-near](https://github.com/near/cargo-near).

```sh
cargo test
cargo near build non-reproducible-wasm --no-abi
```

`--no-abi` is needed on Windows, where the ABI step fails to link.

## Deploy

`new` takes the owner, the token name, the icon as a data URL (`icon.txt`), and a metadata link with its SHA-256 hash in base64.

```sh
near contract deploy <token-account> use-file target/near/pcmb_token.wasm \
  with-init-call new json-args '{"owner_id":"<owner>","name":"Pixel Climb Token - Testnet","icon":"<contents of icon.txt>","reference":"https://pixelclimb.xyz/token_metadata.json","reference_hash":"<base64 sha256 of that file>"}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-legacy-keychain send
```

Keys stay in `~/.near-credentials`, never in this repo.
