//! $PCMB, the Pixel Climb token: a NEP-141 fungible token with NEP-148 metadata.
//! Mirrors the Solana devnet token: 9 decimals, 5,000,000 initial supply, owner can mint more.

use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::collections::LazyOption;
use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue,
};

pub const DECIMALS: u8 = 9;
/// 5,000,000 PCMB in raw units (9 decimals).
pub const INITIAL_SUPPLY: u128 = 5_000_000 * 10u128.pow(DECIMALS as u32);

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Token,
    Metadata,
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Contract {
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
    owner_id: AccountId,
}

#[near]
impl Contract {
    /// Creates the token and mints the initial supply to `owner_id`.
    /// `icon` is a data URL (NEP-148 stores the icon inline).
    /// `reference` is a link to extra metadata; NEP-148 requires its SHA-256 as `reference_hash`.
    #[init]
    pub fn new(
        owner_id: AccountId,
        name: String,
        icon: Option<String>,
        reference: Option<String>,
        reference_hash: Option<Base64VecU8>,
    ) -> Self {
        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name,
            symbol: "PCMB".to_string(),
            icon,
            reference,
            reference_hash,
            decimals: DECIMALS,
        };
        metadata.assert_valid();

        let mut this = Self {
            token: FungibleToken::new(StorageKey::Token),
            metadata: LazyOption::new(StorageKey::Metadata, Some(&metadata)),
            owner_id: owner_id.clone(),
        };
        this.token.internal_register_account(&owner_id);
        this.token.internal_deposit(&owner_id, INITIAL_SUPPLY);
        FtMint {
            owner_id: &owner_id,
            amount: U128(INITIAL_SUPPLY),
            memo: Some("initial supply"),
        }
        .emit();
        this
    }

    /// Owner-only: mints `amount` more tokens to `account_id`, like the devnet mint authority.
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Only the owner can mint"
        );
        require!(amount.0 > 0, "Amount must be positive");
        if !self.token.accounts.contains_key(&account_id) {
            self.token.internal_register_account(&account_id);
        }
        self.token.internal_deposit(&account_id, amount.0);
        FtMint {
            owner_id: &account_id,
            amount,
            memo: None,
        }
        .emit();
    }

    pub fn owner(&self) -> AccountId {
        self.owner_id.clone()
    }
}

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used_amount, _burned) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used_amount.into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn owner() -> AccountId {
        "pixelclimb.testnet".parse().unwrap()
    }

    fn player() -> AccountId {
        "player.testnet".parse().unwrap()
    }

    fn as_caller(id: AccountId) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(id).build());
    }

    fn deploy() -> Contract {
        as_caller(owner());
        Contract::new(
            owner(),
            "Pixel Climb Token - Testnet".to_string(),
            None,
            None,
            None,
        )
    }

    #[test]
    fn initial_supply_goes_to_owner() {
        let contract = deploy();
        assert_eq!(contract.ft_total_supply().0, 5_000_000_000_000_000);
        assert_eq!(contract.ft_balance_of(owner()).0, 5_000_000_000_000_000);
        let metadata = contract.ft_metadata();
        assert_eq!(metadata.symbol, "PCMB");
        assert_eq!(metadata.decimals, 9);
    }

    #[test]
    fn owner_can_mint_more() {
        let mut contract = deploy();
        contract.mint(player(), U128(1_000_000_000));
        assert_eq!(contract.ft_balance_of(player()).0, 1_000_000_000);
        assert_eq!(contract.ft_total_supply().0, 5_000_001_000_000_000);
    }

    #[test]
    #[should_panic(expected = "Only the owner can mint")]
    fn others_cannot_mint() {
        let mut contract = deploy();
        as_caller(player());
        contract.mint(player(), U128(1));
    }
}
