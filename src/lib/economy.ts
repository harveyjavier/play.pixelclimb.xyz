// Shared by the page and the /api routes: what the economy contract returns, how a run is checked,
// and how the page signs its requests with the player's browser key.
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { KeyType, PublicKey, base64Decode, base64Encode, type KeyPair } from 'near-api-js';
import type { Network } from '#lib/network.ts';

/** `get_state` on the economy contract. Amounts are raw $PCMB (9 decimals). */
export type EconomyState = {
	round: number;
	round_ends_at_ms: number;
	pool: string;
	next_pool: string;
	gem_price: string;
	players_this_round: number;
	/** The $PCMB token contract. */
	token: string;
	config: { round_minutes: number; gem_base_price: string; min_floor: number };
};

/** `get_player` on the economy contract. */
export type PlayerState = { best_floor: number; balance: string; gems: number };

/**
 * Response of `GET /api/state`. With a wallet as `?player=`, `tokens` is the $PCMB the wallet itself
 * holds (outside the game), which the page offers to deposit into `economy`.
 */
export type StateResponse = {
	/** The NEAR network the server plays on. */
	network: Network;
	state: EconomyState;
	player: PlayerState | null;
	economy: string;
	tokens: string | null;
};

/**
 * What the page signs. `ts` is the page's clock in ms, so a captured request stops working soon.
 * `player` is the browser key's account. `wallet` and `link` (the wallet's signature of
 * `linkMessage`) say which wallet that key plays for. Without them the browser account plays and
 * earns for itself; linking and withdrawing need them.
 */
type Signed = { player: string; ts: number; wallet?: string; link?: string };
export type SignedPayload = Signed &
	(
		| { action: 'run'; floor: number; durationMs: number; ticket: string }
		| { action: 'revive'; gems: number }
		| { action: 'link' }
		| { action: 'withdraw' }
	);

/** Body of `POST /api/run` and `POST /api/revive`: the payload as signed text, and its base64 signature. */
export type SignedRequest = { payload: string; signature: string };

/** How old (or how far ahead) a signed request may be. */
export const MAX_REQUEST_AGE_MS = 60_000;

/**
 * One floor is 1.5 screen heights (`common.levelHeight` in the game), and the fastest climb, a tap
 * every frame, covers about 0.5 floors a second. 1 a second leaves room for frame drops and timer
 * drift, and still rejects anything faster.
 */
const MAX_FLOORS_PER_SECOND = 1;
/** The duration comes from the page, so it is capped too: no run is longer than an hour. */
const MAX_RUN_MS = 60 * 60_000;
/** `record_run` takes the floor as a u32. */
const MAX_FLOOR = 2 ** 32 - 1;
/**
 * The same top speed, checked against the server's clock (`ticketAge`) instead of the page's: a tap
 * every frame. The server's time also covers the menu, so a real run never comes close.
 */
const SERVER_FLOORS_PER_SECOND = 0.5;
/** A higher floor counts as this one. Real testnet runs reached floors 10 to 24. */
export const MAX_COUNTED_FLOOR = 100;

/** A player's account is the hex of their browser key's public key (a NEAR implicit account). */
export const isPlayerId = (id: unknown): id is string =>
	typeof id === 'string' && /^[0-9a-f]{64}$/.test(id);

/** A MetaMask address in lowercase, which NEAR also takes as an account id (NEP-518). */
export const isWallet = (id: unknown): id is string =>
	typeof id === 'string' && /^0x[0-9a-f]{40}$/.test(id);

/** The text a wallet signs (personal_sign) once, to let a browser key play and earn for it. */
export const linkMessage = (player: string, wallet: string) =>
	`Pixel Climb: let this browser (${player}) play and earn for ${wallet}.`;

/** The address that made `signature` (0x hex, r s v) over `message` with personal_sign (EIP-191). */
export function recoverWallet(message: string, signature: string): string | null {
	try {
		const text = new TextEncoder().encode(message);
		const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${text.length}`);
		const hash = keccak_256(new Uint8Array([...prefix, ...text]));
		const sig = hexToBytes(signature.replace(/^0x/, ''));
		if (sig.length !== 65) return null;
		const v = sig[64] >= 27 ? sig[64] - 27 : sig[64];
		// noble's 'recovered' format puts the recovery byte first; Ethereum puts it last.
		const recovered = new Uint8Array([v, ...sig.subarray(0, 64)]);
		const pub = secp256k1.recoverPublicKey(recovered, hash, { prehash: false });
		const point = secp256k1.Point.fromBytes(pub).toBytes(false).subarray(1);
		return '0x' + bytesToHex(keccak_256(point).subarray(12));
	} catch {
		return null;
	}
}

/**
 * The wallet a signed request plays for. `null` when it names none (the browser account plays for
 * itself), and `'invalid'` when the link is not that wallet's signature for this browser key.
 */
export function linkedWallet({ player, wallet, link }: SignedPayload): string | null | 'invalid' {
	if (wallet === undefined && link === undefined) return null;
	if (!isWallet(wallet) || typeof link !== 'string') return 'invalid';
	return recoverWallet(linkMessage(player, wallet), link) === wallet ? wallet : 'invalid';
}

const isCount = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

/** False for a floor no one could reach in `durationMs`, or a run longer than an hour. */
export const isPlausibleRun = (floor: number, durationMs: number) =>
	isCount(floor) &&
	isCount(durationMs) &&
	floor <= MAX_FLOOR &&
	durationMs <= MAX_RUN_MS &&
	floor <= 1 + (durationMs / 1000) * MAX_FLOORS_PER_SECOND;

/** True when `floor` can be reached in `sinceMs` of the server's time. */
export const isReachableSince = (floor: number, sinceMs: number) =>
	floor <= 1 + (sinceMs / 1000) * SERVER_FLOORS_PER_SECOND;

const ticketMessage = (player: string, issuedAt: number) => `pixelclimb-run:${player}:${issuedAt}`;

/**
 * A run ticket: the server's signed note that it saw `player` at `issuedAt` (ms). The page gets one
 * before playing and sends it with each run, so the server times the run with its own clock.
 */
export function makeTicket(serverKey: KeyPair, player: string, issuedAt: number): string {
	const message = new TextEncoder().encode(ticketMessage(player, issuedAt));
	return `${issuedAt}:${base64Encode(serverKey.sign(message).signature)}`;
}

/** How long ago (ms) the server issued `ticket` to `player`, or an error message. */
export function ticketAge(
	ticket: unknown,
	player: string,
	serverKey: PublicKey,
	now = Date.now()
): number | string {
	if (typeof ticket !== 'string') return 'Missing run ticket, reload the page';
	const [at, signature] = ticket.split(':');
	const issuedAt = Number(at);
	if (!Number.isSafeInteger(issuedAt) || issuedAt > now || !signature) return 'Bad run ticket';
	let valid = false;
	try {
		const message = new TextEncoder().encode(ticketMessage(player, issuedAt));
		valid = serverKey.verify(message, base64Decode(signature));
	} catch {
		// malformed signature
	}
	return valid ? now - issuedAt : 'Bad run ticket';
}

/**
 * Checks a signed request and returns its payload, or an error message. The signature must come
 * from the key behind `payload.player`, so nobody can spend another player's balance.
 */
export function verifyRequest(
	body: unknown,
	action: SignedPayload['action'],
	now = Date.now()
): SignedPayload | string {
	const { payload, signature } = (body ?? {}) as Partial<SignedRequest>;
	if (typeof payload !== 'string' || typeof signature !== 'string') return 'Missing signature';
	let data: SignedPayload;
	try {
		data = JSON.parse(payload);
	} catch {
		return 'Bad payload';
	}
	if (data?.action !== action || !isPlayerId(data.player)) return 'Bad payload';
	if (!Number.isFinite(data.ts) || Math.abs(now - data.ts) > MAX_REQUEST_AGE_MS)
		return 'Request expired, check your clock';
	const key = new PublicKey({ keyType: KeyType.ED25519, data: hexToBytes(data.player) });
	let valid = false;
	try {
		valid = key.verify(new TextEncoder().encode(payload), base64Decode(signature));
	} catch {
		// malformed signature
	}
	return valid ? data : 'Bad signature';
}

/** The address MetaMask sends to for a NEAR account: keccak256(account id), last 20 bytes (NEP-518). */
export const ethAddressOf = (accountId: string) =>
	'0x' + bytesToHex(keccak_256(new TextEncoder().encode(accountId)).subarray(12));

const word = (n: bigint) => n.toString(16).padStart(64, '0');
const bytes = (hex: string) =>
	word(BigInt(hex.length / 2)) + hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
const dynamic = (text: string) => bytes(bytesToHex(new TextEncoder().encode(text)));
/** ABI-encodes a tuple: a bigint is a static word, a string is an already-encoded dynamic value. */
const tuple = (parts: (bigint | string)[]) => {
	let offset = parts.length * 32;
	const tails: string[] = [];
	const heads = parts.map((part) => {
		if (typeof part === 'bigint') return word(part);
		tails.push(part);
		offset += part.length / 2;
		return word(BigInt(offset - part.length / 2));
	});
	return heads.join('') + tails.join('');
};

/**
 * Ethereum transaction data that makes a NEP-518 wallet call a NEAR method:
 * `functionCall(string receiver, string method, bytes args, uint64 gas, uint32 yoctoNear)`, ABI
 * encoded. `gas` is in NEAR gas units; `yoctoNear` is the deposit below 10^6 yocto (the rest would go
 * in the transaction's value).
 */
export function encodeFunctionCall(
	receiver: string,
	method: string,
	args: string,
	gas: bigint,
	yoctoNear: number
): string {
	const tail = [receiver, method, args].map(dynamic);
	return '0x6179b707' + tuple([...tail, gas, BigInt(yoctoNear)]);
}

/**
 * Ethereum transaction data that makes a NEP-518 wallet add a function-call key for `receiver`
 * limited to `methods`: `addKey(uint8 kind, bytes key, uint64 nonce, bool fullAccess,
 * bool limitedAllowance, uint128 allowance, string receiver, string[] methods)`, ABI encoded.
 * `publicKey` is the raw ed25519 key in hex.
 */
export function encodeAddKey(publicKey: string, receiver: string, methods: string[]): string {
	const names = word(BigInt(methods.length)) + tuple(methods.map(dynamic));
	return '0x753ce5ab' + tuple([0n, bytes(publicKey), 0n, 0n, 0n, 0n, dynamic(receiver), names]);
}

export const hexToBytes = (hex: string) =>
	Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16));

/** Raw $PCMB to a short display string: 10500000000 -> "10.5". */
export const formatPcmb = (raw: string) =>
	(Number(BigInt(raw) / 10_000_000n) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
