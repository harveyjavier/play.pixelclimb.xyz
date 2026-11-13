// The two NEAR networks the game runs on. The server picks one with NEAR_NETWORK, and `/api/state`
// tells the page, so MetaMask, RPC calls and explorer links follow it.

export type Network = 'testnet' | 'mainnet';

export const NETWORKS = {
	testnet: {
		label: 'NEAR testnet',
		economy: 'economy.pixelclimb.testnet',
		// rpc.testnet.near.org is deprecated and rate-limited
		rpc: 'https://test.rpc.fastnear.com',
		explorer: 'https://testnet.nearblocks.io',
		// NEAR's Ethereum-compatible RPC (NEP-518): MetaMask signs for a NEAR account named by its 0x address.
		chain: {
			chainId: '0x18e', // 398
			chainName: 'NEAR Protocol Testnet',
			nativeCurrency: { name: 'NEAR', symbol: 'NEAR', decimals: 18 },
			rpcUrls: ['https://eth-rpc.testnet.near.org'],
			blockExplorerUrls: ['https://testnet.nearblocks.io'] // eth-explorer-testnet.near.org is down (404)
		}
	},
	mainnet: {
		label: 'NEAR',
		economy: 'economy.pixelclimb.near',
		rpc: 'https://rpc.mainnet.fastnear.com',
		explorer: 'https://nearblocks.io',
		chain: {
			chainId: '0x18d', // 397
			chainName: 'NEAR Protocol',
			nativeCurrency: { name: 'NEAR', symbol: 'NEAR', decimals: 18 },
			rpcUrls: ['https://eth-rpc.mainnet.near.org'],
			blockExplorerUrls: ['https://nearblocks.io']
		}
	}
} as const;

export type Chain = (typeof NETWORKS)[Network]['chain'];

export const isNetwork = (value: unknown): value is Network =>
	value === 'testnet' || value === 'mainnet';
