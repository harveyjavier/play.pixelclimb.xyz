// The player's browser key. Its public key is the player's NEAR account (an implicit account), so a
// new visitor plays and earns with no wallet and no on-chain account creation.
import { KeyPair, base64Encode, keyToImplicitAddress, type KeyPairString } from 'near-api-js';
import type { SignedPayload, SignedRequest } from '#lib/economy.ts';

const STORAGE_KEY = 'pixelclimb:player-key';

function loadKey(): KeyPair {
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved) return KeyPair.fromString(saved as KeyPairString);
	} catch {
		// blocked storage or a corrupt key: start a fresh one
	}
	const key = KeyPair.fromRandom('ed25519');
	try {
		localStorage.setItem(STORAGE_KEY, key.toString());
	} catch {
		// shortcut: without storage the key lives for this tab only, so earnings stay with that key
	}
	return key;
}

let key: KeyPair | undefined;

/** The player's account id (64 hex characters). Browser only. */
export function playerId(): string {
	key ??= loadKey();
	return keyToImplicitAddress(key.getPublicKey());
}

type Unsigned<T> = T extends unknown ? Omit<T, 'player' | 'ts'> : never;

/** POSTs a payload signed with the player's key. Throws the server's message on failure. */
export async function signedPost<T>(url: string, payload: Unsigned<SignedPayload>): Promise<T> {
	const text = JSON.stringify({ ...payload, player: playerId(), ts: Date.now() });
	const body: SignedRequest = {
		payload: text,
		signature: base64Encode(key!.sign(new TextEncoder().encode(text)).signature)
	};
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data.message ?? `Request failed (${res.status})`);
	return data as T;
}
