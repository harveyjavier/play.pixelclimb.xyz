<script lang="ts" module>
	import { KeyType, PublicKey } from 'near-api-js';
	import { encodeAddKey, encodeFunctionCall, ethAddressOf, hexToBytes } from '#lib/economy.ts';
	import { NETWORKS, type Chain, type Network } from '#lib/network.ts';

	type Eth = {
		request(args: { method: string; params?: unknown }): Promise<unknown>;
		on?(event: string, cb: (value: unknown) => void): void;
		removeListener?(event: string, cb: (value: unknown) => void): void;
	};
	const ethereum = () => (window as unknown as { ethereum?: Eth }).ethereum;

	async function rpc(url: string, method: string, params: unknown = []) {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
		});
		const body = (await res.json()) as {
			result?: unknown;
			error?: { message?: string; data?: unknown };
		};
		if (body.error)
			throw new Error(`${body.error.message ?? 'RPC error'}: ${JSON.stringify(body.error.data)}`);
		const result = body.result as Record<string, unknown>;
		// NEAR reports some query failures (e.g. a missing access key) inside the result.
		if (typeof result?.error === 'string') throw new Error(result.error);
		return result;
	}

	/**
	 * The relayer only sends a wallet's NEP-518 transactions once its key is on the wallet's NEAR
	 * account ("onboarding"). Adds it if missing: an `addKey` limited to `rlp_execute` on the
	 * wallet's own account, sponsored by the relayer (gas price 1), then waits until NEAR has it.
	 */
	async function onboard(eth: Eth, wallet: string, network: Network) {
		const { rpc: nearRpc, chain } = NETWORKS[network];
		const relayer = (await rpc(chain.rpcUrls[0], 'near_getPublicKey')).public_key as string;
		if (!/^[0-9a-f]{64}$/i.test(relayer)) throw new Error('The NEAR relayer returned a bad key');
		const key = new PublicKey({ keyType: KeyType.ED25519, data: hexToBytes(relayer) }).toString();
		const hasKey = () =>
			rpc(nearRpc, 'query', {
				request_type: 'view_access_key',
				finality: 'final',
				account_id: wallet,
				public_key: key
			}).then(
				() => true,
				(e: Error) => {
					// Only a missing account or key means "not onboarded"; anything else is a real error.
					if (
						/UNKNOWN_ACCOUNT|UNKNOWN_ACCESS_KEY|does not exist|doesn't exist|never been observed/.test(
							e.message
						)
					)
						return false;
					throw e;
				}
			);
		if (await hasKey()) return;
		await eth.request({
			method: 'eth_sendTransaction',
			params: [
				{
					from: wallet,
					to: ethAddressOf(wallet),
					value: '0x0',
					gasPrice: '0x1',
					data: encodeAddKey(relayer, wallet, ['rlp_execute'])
				}
			]
		});
		for (let i = 0; i < 30; i++) {
			await new Promise((r) => setTimeout(r, 2000));
			if (await hasKey()) return;
		}
		throw new Error('NEAR account setup is taking long. Try the deposit again in a minute.');
	}

	/**
	 * Moves `amount` raw $PCMB from the wallet into its game balance: MetaMask signs an
	 * `ft_transfer_call` to the economy with msg "", which credits the sender (NEP-518 functionCall).
	 * Resolves with the transaction hash once it is sent.
	 */
	export async function deposit(
		network: Network,
		wallet: string,
		token: string,
		economy: string,
		amount: string
	) {
		const eth = ethereum();
		if (!eth) throw new Error('Install MetaMask first.');
		// The wallet's own NEAR pays the deposit's gas (about 0.009 NEAR); check before any prompt.
		const near = await rpc(NETWORKS[network].rpc, 'query', {
			request_type: 'view_account',
			finality: 'final',
			account_id: wallet
		}).then(
			(account) => BigInt(account.amount as string),
			() => 0n // no account on NEAR yet
		);
		if (near < 10n ** 22n)
			throw new Error(
				`Deposit needs about 0.01 NEAR in your wallet for gas (${NETWORKS[network].label}).`
			);
		await onboard(eth, wallet, network);
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

	/**
	 * `account`: the linked wallet (lowercase), or null. Runs and payouts go to this account.
	 * `network`: the server's network, from `/api/state`. Connecting waits until it is known.
	 */
	let { account = $bindable(null), network }: { account?: string | null; network?: Network } =
		$props();
	const net = $derived(network && NETWORKS[network]);
	// The scheme stays literal in the link, so the linter sees it is an external URL.
	const explorerHost = $derived((net ?? NETWORKS.testnet).explorer.replace('https://', ''));
	let busy = $state(false);
	let error = $state<string | null>(null);

	// MetaMask fires chainChanged for our own switch after connect() resolves, so only a move off the game's network drops the session.
	$effect(() => {
		const eth = ethereum();
		const chain = net?.chain;
		if (!chain) return;
		const onChain = (id: unknown) => {
			if (id !== chain.chainId) drop();
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
				if (first && (await eth.request({ method: 'eth_chainId' })) === chain.chainId)
					await adopt(eth, first, false);
			})
			.catch(() => {}); // no session to restore
		return () => {
			eth?.removeListener?.('chainChanged', onChain);
			eth?.removeListener?.('accountsChanged', onAccounts);
		};
	});

	async function useNetwork(eth: Eth, chain: Chain) {
		try {
			await eth.request({
				method: 'wallet_switchEthereumChain',
				params: [{ chainId: chain.chainId }]
			});
		} catch (e) {
			// 4902: MetaMask doesn't know the chain yet; adding it also switches to it.
			if ((e as { code?: number }).code !== 4902) throw e;
			await eth.request({ method: 'wallet_addEthereumChain', params: [chain] });
		}
		if ((await eth.request({ method: 'eth_chainId' })) !== chain.chainId)
			throw new Error(`Switch MetaMask to ${chain.chainName}.`);
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
		if (!net) return; // the button stays disabled until the network is known
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
			await useNetwork(eth, net.chain);
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
			href={`https://${explorerHost}/address/${account}`}
			target="_blank"
			rel="noopener noreferrer"
			title={`${account} on ${net?.chain.chainName ?? 'NEAR'}`}
			class="account">{account.slice(0, 6)}…{account.slice(-4)}</a
		>
		<button type="button" onclick={disconnect}>Disconnect</button>
	{:else}
		<button type="button" onclick={connect} disabled={busy || !net}>
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
