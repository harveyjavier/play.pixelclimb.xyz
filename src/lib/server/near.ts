// The game server's side of the economy contract: reads, and calls signed with the server key.
// The contract lets this account record runs and buy gems for any player, so players never sign.
import {
	ECONOMY_CONTRACT,
	NEAR_RPC_URL,
	NEAR_SERVER_ACCOUNT,
	NEAR_SERVER_KEY
} from '$app/env/private';
import { error } from '@sveltejs/kit';
import {
	Account,
	JsonRpcProvider,
	KeyPairSigner,
	teraToGas,
	type KeyPairString
} from 'near-api-js';
import {
	MAX_REQUEST_AGE_MS,
	isWallet,
	linkMessage,
	recoverWallet,
	type EconomyState,
	type PlayerState,
	type SignedPayload
} from '#lib/economy.ts';

const ECONOMY = ECONOMY_CONTRACT;
const provider = new JsonRpcProvider({ url: NEAR_RPC_URL });

export async function view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
	try {
		return (await provider.callFunction<T & object>({ contractId: ECONOMY, method, args })) as T;
	} catch (e) {
		console.error(`[economy] ${method} view failed`, e);
		error(502, 'Could not reach NEAR testnet');
	}
}

export const getState = () => view<EconomyState>('get_state');
export const getPlayer = (player: string) => view<PlayerState>('get_player', { player });

let server: Account | undefined;

// One key for every call. near-api-js tracks its nonce and retries a clash (up to 10 times), which
// covers several server instances sending at once.
function serverAccount(): Account {
	if (!server) {
		if (!NEAR_SERVER_ACCOUNT || !NEAR_SERVER_KEY) error(503, 'The game server key is not set');
		const signer = KeyPairSigner.fromSecretKey(NEAR_SERVER_KEY as KeyPairString);
		server = new Account(NEAR_SERVER_ACCOUNT, provider, signer);
	}
	return server;
}

/** Calls the contract as the game server. A contract panic is thrown as `error(status, message)`. */
export async function call<T>(
	methodName: string,
	args: Record<string, unknown>,
	tgas = 30,
	panics: Record<string, number> = {}
): Promise<T> {
	const account = serverAccount();
	try {
		return await account.callFunction<T & object>({
			contractId: ECONOMY,
			methodName,
			args,
			gas: teraToGas(tgas)
		});
	} catch (e) {
		const message = String((e as Error)?.message ?? e);
		for (const [panic, status] of Object.entries(panics))
			if (message.includes(panic)) error(status, panic);
		console.error(`[economy] ${methodName} failed`, e);
		error(502, `${methodName} failed on NEAR testnet`);
	}
}

/** Pays out the round. False if it was already paid (or the chain's clock says it is still on). */
export const settle = () =>
	call('settle_round', {}, 300, { 'Round is still running': 409 }).then(
		() => true,
		(e) => {
			if (e?.status !== 409) throw e;
			return false;
		}
	);

/** Pays out a finished round so the next one starts. Returns the state after. */
export async function settleIfOver(state: EconomyState): Promise<EconomyState> {
	if (Date.now() < state.round_ends_at_ms) return state;
	const settled = await settle();
	// The RPC can answer from a node a block behind, so wait (briefly) until it shows the new round.
	for (let i = 0; settled && i < 5; i++) {
		const next = await getState();
		if (next.round > state.round) return next;
		await new Promise((r) => setTimeout(r, 1000));
	}
	return getState();
}

const used = new Map<string, number>();

/** Rejects a signed request this server instance has already handled (they expire after a minute). */
export function useOnce(signature: string) {
	const now = Date.now();
	for (const [sig, at] of used) if (now - at > MAX_REQUEST_AGE_MS) used.delete(sig);
	if (used.has(signature)) error(409, 'This request was already used');
	used.set(signature, now);
}

/** The wallet a request plays for. Only a link that the wallet itself signed counts. */
export function walletOf({ player, wallet, link }: SignedPayload): string {
	if (!isWallet(wallet) || typeof link !== 'string') error(403, 'Connect a wallet to earn');
	if (recoverWallet(linkMessage(player, wallet), link) !== wallet)
		error(403, 'Wallet link is not valid, connect again');
	return wallet;
}
