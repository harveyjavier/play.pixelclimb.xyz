<script lang="ts" module>
	import { encodeFunctionCall, ethAddressOf } from '#lib/economy.ts';

	type Eth = {
		request(args: { method: string; params?: unknown }): Promise<unknown>;
		on?(event: string, cb: (value: unknown) => void): void;
		removeListener?(event: string, cb: (value: unknown) => void): void;
	};
	const ethereum = () => (window as unknown as { ethereum?: Eth }).ethereum;

	/**
	 * Moves `amount` raw $PCMB from the wallet into its game balance: MetaMask signs an
	 * `ft_transfer_call` to the economy with msg "", which credits the sender (NEP-518 functionCall).
	 * Resolves with the transaction hash once it is sent.
	 */
	export async function deposit(wallet: string, token: string, economy: string, amount: string) {
		const eth = ethereum();
		if (!eth) throw new Error('Install MetaMask first.');
		const args = JSON.stringify({ receiver_id: economy, amount, msg: '' });
		// 50 Tgas covers ft_transfer_call, the economy's ft_on_transfer and the token's resolve step.
		const data = encodeFunctionCall(token, 'ft_transfer_call', args, 50n * 10n ** 12n, 1);
		return eth.request({
			method: 'eth_sendTransaction',
			params: [{ from: wallet, to: ethAddressOf(token), value: '0x0', data }]
		}) as Promise<string>;
	}
</script>

<script lang="ts">
	import { linkMessage } from '#lib/economy.ts';
	import { playerId, savedLink, saveLink, signedPost, useWallet } from '#lib/player.ts';

	// NEAR testnet's Ethereum-compatible RPC (NEP-518): MetaMask signs for a NEAR account named by its 0x address.
	const CHAIN = {
		chainId: '0x18e', // 398
		chainName: 'NEAR Protocol Testnet',
		nativeCurrency: { name: 'NEAR', symbol: 'NEAR', decimals: 18 },
		rpcUrls: ['https://eth-rpc.testnet.near.org'],
		blockExplorerUrls: ['https://testnet.nearblocks.io'] // eth-explorer-testnet.near.org is down (404)
	};

	/** The linked wallet (lowercase), or null. Runs and payouts go to this account. */
	let { account = $bindable(null) }: { account?: string | null } = $props();
	let busy = $state(false);
	let error = $state<string | null>(null);

	// MetaMask fires chainChanged for our own switch after connect() resolves, so only a move off NEAR testnet drops the session.
	$effect(() => {
		const eth = ethereum();
		const onChain = (id: unknown) => {
			if (id !== CHAIN.chainId) drop();
		};
		const onAccounts = (accounts: unknown) => {
			const [next] = accounts as string[];
			if (account) {
				if (next) adopt(eth!, next, false);
				else drop();
			}
		};
		eth?.on?.('chainChanged', onChain);
		eth?.on?.('accountsChanged', onAccounts);
		// eth_accounts never prompts; it restores the session after a reload if the site still has permission.
		eth
			?.request({ method: 'eth_accounts' })
			.then(async (accounts) => {
				const [first] = accounts as string[];
				if (first && (await eth.request({ method: 'eth_chainId' })) === CHAIN.chainId)
					await adopt(eth, first, false);
			})
			.catch(() => {}); // no session to restore
		return () => {
			eth?.removeListener?.('chainChanged', onChain);
			eth?.removeListener?.('accountsChanged', onAccounts);
		};
	});

	async function useNearTestnet(eth: Eth) {
		try {
			await eth.request({
				method: 'wallet_switchEthereumChain',
				params: [{ chainId: CHAIN.chainId }]
			});
		} catch (e) {
			// 4902: MetaMask doesn't know the chain yet; adding it also switches to it.
			if ((e as { code?: number }).code !== 4902) throw e;
			await eth.request({ method: 'wallet_addEthereumChain', params: [CHAIN] });
		}
		if ((await eth.request({ method: 'eth_chainId' })) !== CHAIN.chainId)
			throw new Error('Switch MetaMask to NEAR Protocol Testnet.');
	}

	function drop() {
		account = null;
		useWallet(null);
	}

	/**
	 * Plays and earns as `address`. The wallet signs a link to this browser's key once (MetaMask only
	 * asks when `ask` is set, so a reload never pops up), then earlier browser earnings move to it.
	 */
	async function adopt(eth: Eth, address: string, ask: boolean) {
		const wallet = address.toLowerCase();
		let link = savedLink(wallet);
		if (!link) {
			if (!ask) return drop();
			link = (await eth.request({
				method: 'personal_sign',
				params: [linkMessage(playerId(), wallet), address]
			})) as string;
			saveLink(wallet, link);
		}
		useWallet({ address: wallet, link });
		await signedPost('/api/link', { action: 'link' }).catch((e) => (error = (e as Error).message));
		account = wallet; // after the move, so the page's first read already shows it
	}

	async function disconnect() {
		const eth = ethereum();
		drop();
		if (eth)
			await eth
				.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] })
				.catch(() => {}); // already revoked
	}

	async function connect() {
		const eth = ethereum();
		if (!eth) {
			// Mobile browsers never get window.ethereum; reopen this page in MetaMask's in-app browser (docs.metamask.io deeplinks).
			if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
				location.href = `https://link.metamask.io/dapp/${location.host}${location.pathname}${location.search}`;
				return;
			}
			error = 'Install MetaMask first.';
			return;
		}
		busy = true;
		error = null;
		try {
			const [first] = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
			await useNearTestnet(eth);
			await adopt(eth, first, true);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not connect MetaMask.';
		} finally {
			busy = false;
		}
	}
</script>

<div class="wallet">
	{#if error}
		<span role="alert" class="error" title={error}>{error}</span>
	{/if}
	{#if account}
		<a
			href={`https://testnet.nearblocks.io/address/${account}`}
			target="_blank"
			rel="noopener noreferrer"
			title={`${account} on ${CHAIN.chainName}`}
			class="account">{account.slice(0, 6)}…{account.slice(-4)}</a
		>
		<button type="button" onclick={disconnect}>Disconnect</button>
	{:else}
		<button type="button" onclick={connect} disabled={busy}>
			{busy ? 'Connecting…' : 'Connect Wallet'}
		</button>
	{/if}
</div>

<style>
	.wallet {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font: 0.75rem/1 monospace;
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}
	button {
		cursor: pointer;
		border: 1px solid #444;
		border-radius: 0.5rem;
		background: none;
		color: inherit;
		padding: 0.5rem 0.75rem;
		font: inherit;
	}
	button:disabled {
		cursor: wait;
		opacity: 0.6;
	}
	.account {
		white-space: nowrap;
		text-transform: none; /* keep 0x lowercase, as in the issue's example */
		color: inherit;
	}
	.error {
		max-width: 10rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: #e5484d;
	}
</style>
