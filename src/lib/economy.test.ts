import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KeyPair, base64Encode, keyToImplicitAddress } from 'near-api-js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
	formatPcmb,
	isPlausibleRun,
	isWallet,
	linkMessage,
	recoverWallet,
	verifyRequest,
	type SignedPayload
} from './economy.ts';

const key = KeyPair.fromRandom('ed25519');
const player = keyToImplicitAddress(key.getPublicKey());
const now = 1_800_000_000_000;

function sign(payload: object, signer = key) {
	const text = JSON.stringify(payload);
	const { signature } = signer.sign(new TextEncoder().encode(text));
	return { payload: text, signature: base64Encode(signature) };
}

const run = { action: 'run', player, ts: now, floor: 12, durationMs: 30_000 };

test('accepts a request signed by the player key', () => {
	assert.deepEqual(verifyRequest(sign(run), 'run', now), run as SignedPayload);
});

test('rejects a request signed by another key', () => {
	assert.equal(
		verifyRequest(sign(run, KeyPair.fromRandom('ed25519')), 'run', now),
		'Bad signature'
	);
});

test('rejects a payload changed after signing', () => {
	const body = sign(run);
	body.payload = body.payload.replace('"floor":12', '"floor":99');
	assert.equal(verifyRequest(body, 'run', now), 'Bad signature');
});

test('rejects the wrong action, old requests and junk', () => {
	assert.equal(verifyRequest(sign(run), 'revive', now), 'Bad payload');
	assert.equal(verifyRequest(sign(run), 'run', now + 60_001), 'Request expired, check your clock');
	assert.equal(verifyRequest(sign({ ...run, player: 'alice.testnet' }), 'run', now), 'Bad payload');
	assert.equal(verifyRequest({ payload: '{', signature: 'x' }, 'run', now), 'Bad payload');
	assert.equal(
		verifyRequest({ payload: JSON.stringify(run), signature: 'x' }, 'run', now),
		'Bad signature'
	);
	assert.equal(verifyRequest(null, 'run', now), 'Missing signature');
});

test('a floor must be reachable in the run time', () => {
	assert.ok(isPlausibleRun(0, 0));
	assert.ok(isPlausibleRun(12, 30_000));
	assert.ok(isPlausibleRun(31, 30_000));
	assert.ok(!isPlausibleRun(32, 30_000));
	assert.ok(!isPlausibleRun(500, 10_000));
	assert.ok(!isPlausibleRun(-1, 10_000));
	assert.ok(!isPlausibleRun(1.5, 10_000));
});

test('a run is at most an hour, and the floor fits a u32', () => {
	assert.ok(isPlausibleRun(3000, 60 * 60_000));
	assert.ok(!isPlausibleRun(3000, 60 * 60_000 + 1));
	assert.ok(!isPlausibleRun(4_000_000_000, 4_000_000_000_000));
	assert.ok(!isPlausibleRun(2 ** 32, 2 ** 42));
});

test('formats raw $PCMB', () => {
	assert.equal(formatPcmb('10000000000000'), '10,000');
	assert.equal(formatPcmb('10500000000'), '10.5');
	assert.equal(formatPcmb('0'), '0');
});

// Private key 1 is a well-known test key; its Ethereum address is 0x7e5f…5bdf.
const walletKey = new Uint8Array(32);
walletKey[31] = 1;
const walletAddress = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';

/** What MetaMask's personal_sign returns: r, s, then v as 27 or 28. */
function personalSign(message: string) {
	const text = new TextEncoder().encode(message);
	const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${text.length}`);
	const hash = keccak_256(new Uint8Array([...prefix, ...text]));
	const sig = secp256k1.sign(hash, walletKey, { prehash: false, format: 'recovered' });
	return '0x' + bytesToHex(new Uint8Array([...sig.subarray(1), sig[0] + 27]));
}

test('recovers the wallet that signed a link', () => {
	const message = linkMessage(player, walletAddress);
	assert.equal(recoverWallet(message, personalSign(message)), walletAddress);
});

test('a link signed for another browser key gives another address', () => {
	const other = keyToImplicitAddress(KeyPair.fromRandom('ed25519').getPublicKey());
	const sig = personalSign(linkMessage(other, walletAddress));
	assert.notEqual(recoverWallet(linkMessage(player, walletAddress), sig), walletAddress);
});

test('junk signatures recover nothing', () => {
	assert.equal(recoverWallet('hi', '0x1234'), null);
	assert.equal(recoverWallet('hi', 'not hex at all'), null);
});

test('wallets are lowercase 0x addresses', () => {
	assert.ok(isWallet(walletAddress));
	assert.ok(!isWallet(walletAddress.toUpperCase().replace('0X', '0x')));
	assert.ok(!isWallet(player));
});
