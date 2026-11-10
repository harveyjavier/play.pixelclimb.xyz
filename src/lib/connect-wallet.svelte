<script lang="ts">
	// NEAR testnet's Ethereum-compatible RPC (NEP-518): MetaMask signs for a NEAR account named by its 0x address.
	const CHAIN = {
		chainId: '0x18e', // 398
		chainName: 'NEAR Protocol Testnet',
		nativeCurrency: { name: 'NEAR', symbol: 'NEAR', decimals: 18 },
		rpcUrls: ['https://eth-rpc.testnet.near.org'],
		blockExplorerUrls: ['https://testnet.nearblocks.io'] // eth-explorer-testnet.near.org is down (404)
	};

	type Eth = {
		request(args: { method: string; params?: unknown }): Promise<unknown>;
		on?(event: string, cb: (value: unknown) => void): void;
		removeListener?(event: string, cb: (value: unknown) => void): void;
	};
	const ethereum = () => (window as unknown as { ethereum?: Eth }).ethereum;

	let account = $state<string | null>(null);
	let busy = $state(false);
	let error = $state<string | null>(null);

	// MetaMask fires chainChanged for our own switch after connect() resolves, so only a move off NEAR testnet drops the session.
	$effect(() => {
		const eth = ethereum();
		const onChain = (id: unknown) => {
			if (id !== CHAIN.chainId) account = null;
		};
		const onAccounts = (accounts: unknown) => {
			if (account) account = (accounts as string[])[0] ?? null;
		};
		eth?.on?.('chainChanged', onChain);
		eth?.on?.('accountsChanged', onAccounts);
		// eth_accounts never prompts; it restores the session after a reload if the site still has permission.
		eth
			?.request({ method: 'eth_accounts' })
			.then(async (accounts) => {
				const [first] = accounts as string[];
				if (first && (await eth.request({ method: 'eth_chainId' })) === CHAIN.chainId)
					account = first;
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

	async function disconnect() {
		const eth = ethereum();
		account = null;
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
			account = first;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not connect MetaMask.';
		} finally {
			busy = false;
		}
	}
</script>

<div class="wallet">
	{#if account}
		<a
			href={`https://testnet.nearblocks.io/address/${account}`}
			target="_blank"
			rel="noopener noreferrer"
			title={`${account} on ${CHAIN.chainName}`}
			class="account">{account}</a
		>
		<button type="button" onclick={disconnect}>Disconnect</button>
	{:else}
		{#if error}
			<span role="alert" class="error" title={error}>{error}</span>
		{/if}
		<button type="button" onclick={connect} disabled={busy}>
			{busy ? 'Connecting…' : 'Connect MetaMask'}
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
		max-width: 9rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
