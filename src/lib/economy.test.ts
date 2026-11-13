import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KeyPair, base64Encode, keyToImplicitAddress } from 'near-api-js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
	encodeAddKey,
	encodeFunctionCall,
	ethAddressOf,
	formatPcmb,
	isPlausibleRun,
	isWallet,
	linkMessage,
	linkedWallet,
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

test('a request names no wallet, its own wallet, or an invalid one', () => {
	const base = { ...run } as SignedPayload;
	const link = personalSign(linkMessage(player, walletAddress));
	// No wallet: the browser account plays for itself.
	assert.equal(linkedWallet(base), null);
	// The wallet signed the link for this browser key.
	assert.equal(linkedWallet({ ...base, wallet: walletAddress, link }), walletAddress);
	// A link the wallet signed for another browser key does not count for this one.
	const other = keyToImplicitAddress(KeyPair.fromRandom('ed25519').getPublicKey());
	const otherLink = personalSign(linkMessage(other, walletAddress));
	assert.equal(linkedWallet({ ...base, wallet: walletAddress, link: otherLink }), 'invalid');
	// Half a link, or another address, is refused instead of falling back to the browser account.
	assert.equal(linkedWallet({ ...base, wallet: walletAddress }), 'invalid');
	assert.equal(linkedWallet({ ...base, link }), 'invalid');
	assert.equal(linkedWallet({ ...base, wallet: `0x${'1'.repeat(40)}`, link }), 'invalid');
});

test('the token address matches the one MetaMask shows (README)', () => {
	assert.equal(
		ethAddressOf('pcmb.pixelclimb.testnet'),
		'0x937ca2395d64855e08c74c30947a545eef6c1bf1'
	);
});

test('encodes a NEP-518 functionCall in the ABI layout', () => {
	const w = (hex: string) => hex.padStart(64, '0');
	const text = (hex: string) => hex.padEnd(64, '0');
	const expected =
		'0x6179b707' +
		w('a0') + // receiver at byte 160, after the five head words
		w('e0') + // method at 224
		w('120') + // args at 288
		w('1') + // gas
		w('2') + // yoctoNear
		w('1') +
		text('61') + // "a"
		w('1') +
		text('62') + // "b"
		w('2') +
		text('7b7d'); // "{}"
	assert.equal(encodeFunctionCall('a', 'b', '{}', 1n, 2), expected);
});

test('long arguments take as many words as they need', () => {
	const args = 'x'.repeat(33);
	const data = encodeFunctionCall('a', 'b', args, 1n, 0);
	// selector + 5 head words + 2 short tails (2 words each) + 1 length word + 2 data words
	assert.equal((data.length - 10) / 64, 5 + 4 + 3);
});

test('encodeAddKey matches viem for the NEP-518 addKey call', () => {
	// Expected from viem encodeFunctionData with the NEP-518 wallet ABI (as in gagdiez/eth-wallet).
	const expected =
		'0x753ce5ab000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000001a0000000000000000000000000000000000000000000000000000000000000002021dea25fbd244dca1f835a95f02a2e368f5a0dc9a935abd22462c4e9f8e5ecb0000000000000000000000000000000000000000000000000000000000000002a3078313233343536373839306162636465663132333435363738393061626364656631323334353637380000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000b726c705f65786563757465000000000000000000000000000000000000000000';
	const key = '21dea25fbd244dca1f835a95f02a2e368f5a0dc9a935abd22462c4e9f8e5ecb0';
	const wallet = '0x1234567890abcdef1234567890abcdef12345678';
	assert.equal(encodeAddKey(key, wallet, ['rlp_execute']), expected);
});
