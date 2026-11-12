// Shared by the page and the /api routes: what the economy contract returns, how a run is checked,
// and how the page signs its requests with the player's browser key.
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

/** What the page signs. `ts` is the page's clock in ms, so a captured request stops working soon. */
export type SignedPayload =
	| { action: 'run'; player: string; ts: number; floor: number; durationMs: number }
	| { action: 'revive'; player: string; ts: number; gems: number };

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
