// Shared by the page and the /api routes: what the economy contract returns, how a run is checked,
// and how the page signs its requests with the player's browser key.
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { KeyType, PublicKey, base64Decode } from 'near-api-js';

/** `get_state` on the economy contract. Amounts are raw $PCMB (9 decimals). */
export type EconomyState = {
	round: number;
	round_ends_at_ms: number;
	pool: string;
	next_pool: string;
	gem_price: string;
	players_this_round: number;
	config: { round_minutes: number; gem_base_price: string; min_floor: number };
};

/** `get_player` on the economy contract. */
export type PlayerState = { best_floor: number; balance: string; gems: number };

/** Response of `GET /api/state`. */
export type StateResponse = { state: EconomyState; player: PlayerState | null };

/**
 * What the page signs. `ts` is the page's clock in ms, so a captured request stops working soon.
 * `player` is the browser key's account. `wallet` and `link` (the wallet's signature of
 * `linkMessage`) say which wallet that key plays for. Without them the browser account plays and
 * earns for itself; linking and withdrawing need them.
 */
type Signed = { player: string; ts: number; wallet?: string; link?: string };
export type SignedPayload = Signed &
	(
		| { action: 'run'; floor: number; durationMs: number }
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

const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16));

/** Raw $PCMB to a short display string: 10500000000 -> "10.5". */
export const formatPcmb = (raw: string) =>
	(Number(BigInt(raw) / 10_000_000n) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
