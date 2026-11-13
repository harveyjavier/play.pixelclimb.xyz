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

### Deployed on mainnet

The same code (code hash `NGHYs9XTKxQX9fykuyca96N11J1G5RtREQxrJ2CFcE8`, as on testnet) also runs on mainnet:

| Field         | Value                                                                      |
| ------------- | -------------------------------------------------------------------------- |
| Contract      | [`pcmb.pixelclimb.near`](https://nearblocks.io/token/pcmb.pixelclimb.near) |
| Owner         | `pixelclimb.near`                                                          |
| Name          | Pixel Climb Token                                                          |
| Metadata link | None: the icon is stored on-chain, and there is no `reference` file        |
| Supply        | 5,000,000, minted to the owner at deploy                                   |
| Deploy        | Transaction `9PQQ8BD74maVMF9WYKYfwGuqmcHX4cA84Q6myw5TC1Yu`                 |

Not done yet on mainnet: registering the token in `address-map.near` (see below), so MetaMask can show it.

## Use it in MetaMask

The play page connects MetaMask to NEAR testnet (chain 398). NEAR shows NEP-141 tokens to MetaMask as ERC-20 tokens, so PCMB works there like any other token.

| Field            | Value                                        |
| ---------------- | -------------------------------------------- |
| Network          | NEAR Protocol Testnet, chain ID `398`        |
| RPC              | `https://eth-rpc.testnet.near.org`           |
| Token address    | `0x937ca2395d64855e08c74c30947a545eef6c1bf1` |
| Symbol, decimals | PCMB, 9                                      |

In MetaMask, on NEAR Protocol Testnet, choose **Import tokens** and paste the token address.

The address is the last 20 bytes of `keccak256("pcmb.pixelclimb.testnet")`. It only resolves because the token is registered in NEAR's address registry (`address-map.near` on testnet). A new token account needs the same one-time call:

```sh
near contract call-function as-transaction address-map.near register json-args '{"account_id":"<token-account>"}'   prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as <any-account> network-config testnet sign-with-legacy-keychain send
```

MetaMask can show balances and send PCMB. It cannot call `mint`; that needs the owner's NEAR key.

## Receivers must be registered

An account can only receive PCMB after it is registered with the token. Otherwise `ft_transfer` and `mint` fail with "not registered". A new `0x…` account is not registered.

```sh
near contract call-function as-transaction pcmb.pixelclimb.testnet storage_deposit json-args '{"account_id":"<receiver>","registration_only":true}' prepaid-gas '30 Tgas' attached-deposit '0.00125 NEAR' sign-as <payer> network-config testnet sign-with-legacy-keychain send
```

Per NEP-518, a send from MetaMask checks this and pays the receiver's registration itself. We have not tested that path yet.

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
