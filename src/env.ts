import { defineEnvVars } from '@sveltejs/kit/env';

// Server-only, read when the app starts. Set them in Vercel (or .env locally), never in the repo.
// The server pair is optional so the page still serves without it; the /api POST routes then return 503.
export const variables = defineEnvVars({
	ECONOMY_CONTRACT: {
		description: 'Economy contract account (default economy.pixelclimb.testnet)',
		schema: (value) => value || 'economy.pixelclimb.testnet'
	},
	NEAR_RPC_URL: {
		description:
			'NEAR testnet RPC (default FastNear; rpc.testnet.near.org is deprecated and rate-limited)',
		schema: (value) => value || 'https://test.rpc.fastnear.com'
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
