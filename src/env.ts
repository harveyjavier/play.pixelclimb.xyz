import { defineEnvVars } from '@sveltejs/kit/env';
import { isNetwork } from '#lib/network.ts';

// Server-only, read when the app starts. Set them in Vercel (or .env locally), never in the repo.
// The server pair is optional so the page still serves without it; the /api POST routes then return 503.
export const variables = defineEnvVars({
	NEAR_NETWORK: {
		description:
			'testnet (default) or mainnet: picks the contracts, RPC, MetaMask network and explorer',
		schema: (value) => {
			if (value && !isNetwork(value)) throw new Error('NEAR_NETWORK must be testnet or mainnet');
			return value || 'testnet';
		}
	},
	ECONOMY_CONTRACT: {
		description:
			"Economy contract account (default: the network's, economy.pixelclimb.testnet or .near)",
		schema: (value) => value || undefined
	},
	NEAR_RPC_URL: {
		description: "NEAR RPC (default: the network's FastNear RPC)",
		schema: (value) => value || undefined
	},
	NEAR_SERVER_ACCOUNT: {
		description: 'Game server account: the `server` set on the economy contract',
		schema: (value) => value || undefined
	},
	NEAR_SERVER_KEY: {
		description: 'A key of NEAR_SERVER_ACCOUNT, as ed25519:…',
		schema: (value) => {
			if (value && !/^ed25519:[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value))
				throw new Error('NEAR_SERVER_KEY must look like ed25519:<base58 secret key>');
			return value || undefined;
		}
	}
});
