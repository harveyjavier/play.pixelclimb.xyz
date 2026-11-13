// Reads NEAR testnet and checks that the deployed $PCMB token and economy contract match this repo.
// No wallet, keys or dependencies needed: `pnpm verify` (Node 22+). Exits 1 if a check fails.

const RPC = process.env.NEAR_RPC_URL ?? 'https://test.rpc.fastnear.com';
const TOKEN = 'pcmb.pixelclimb.testnet';
const ECONOMY = 'economy.pixelclimb.testnet';
const OWNER = 'pixelclimb.testnet';

// What this repo expects to find on testnet. After a redeploy, update the code hash here
// (`cargo near build` prints the new one) and in the "Deployed on testnet" table of
// contracts/economy/README.md, which records the economy hash too.
const EXPECTED = {
	symbol: 'PCMB',
	decimals: 9,
	supply: 5_000_000n * 10n ** 9n,
	tokenCodeHash: 'NGHYs9XTKxQX9fykuyca96N11J1G5RtREQxrJ2CFcE8',
	economyCodeHash: 'BwSqf5J2o6ZZ8ZNgtZEj2TGCk7GUgsYdHVXgqxS4rzm6'
};

async function query(params) {
	const res = await fetch(RPC, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params }),
		signal: AbortSignal.timeout(15_000)
	});
	if (!res.ok) throw new Error(`${RPC} answered HTTP ${res.status}`);
	const body = await res.json();
	if (body.error) throw new Error(body.error.data ?? body.error.message);
	return body.result;
}

async function view(account_id, method_name, args = {}) {
	const result = await query({
		request_type: 'call_function',
		finality: 'final',
		account_id,
		method_name,
		args_base64: Buffer.from(JSON.stringify(args)).toString('base64')
	});
	return JSON.parse(Buffer.from(result.result).toString());
}

const codeHash = async (account_id) =>
	(await query({ request_type: 'view_account', finality: 'final', account_id })).code_hash;

/** Raw 9-decimal units to a readable amount, e.g. 10000000000n -> "10". */
function pcmb(raw) {
	const units = BigInt(raw);
	const whole = (units / 10n ** 9n).toLocaleString('en-US');
	const fraction = (units % 10n ** 9n).toString().padStart(9, '0').replace(/0+$/, '');
	return fraction ? `${whole}.${fraction}` : whole;
}

let failed = 0;
function check(label, ok, detail) {
	if (!ok) failed += 1;
	console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `: ${detail}` : ''}`);
}

const [metadata, supply, tokenHash, economyHash, state, economyHolds, ownerHolds] =
	await Promise.all([
		view(TOKEN, 'ft_metadata'),
		view(TOKEN, 'ft_total_supply'),
		codeHash(TOKEN),
		codeHash(ECONOMY),
		view(ECONOMY, 'get_state'),
		view(TOKEN, 'ft_balance_of', { account_id: ECONOMY }),
		view(TOKEN, 'ft_balance_of', { account_id: OWNER })
	]).catch((e) => {
		// A network failure hides its reason in `cause`; a contract or RPC error has it in `message`.
		const reason = e?.cause?.code ?? e?.cause?.message ?? e?.message ?? e;
		console.error(`Could not read NEAR testnet through ${RPC}: ${reason}`);
		process.exit(1);
	});

const roundEnd = new Date(state.round_ends_at_ms);
const roundOver = roundEnd.getTime() <= Date.now();

console.log(`NEAR testnet via ${RPC}\n`);
console.log(`$PCMB token   ${TOKEN}`);
console.log(`  name          ${metadata.name}`);
console.log(`  total supply  ${pcmb(supply)} ${metadata.symbol}`);
console.log(`  owner holds   ${pcmb(ownerHolds)} ${metadata.symbol}`);
console.log(`\nEconomy       ${ECONOMY}`);
console.log(`  round         ${state.round} (${state.players_this_round} players)`);
console.log(
	`  round end     ${roundEnd.toISOString()}${roundOver ? ' (over; waiting for settle_round)' : ''}`
);
console.log(`  pool          ${pcmb(state.pool)} PCMB`);
console.log(`  next pool     ${pcmb(state.next_pool)} PCMB`);
// Contracts before the per-round pool (#25) have no reserve or round_pool.
const reserve = state.reserve ?? '0';
console.log(
	`  reserve       ${pcmb(reserve)} PCMB, ${pcmb(state.config.round_pool ?? '0')} a round`
);
console.log(`  gem price     ${pcmb(state.gem_price)} PCMB`);
console.log(`  round length  ${state.config.round_minutes} min`);
console.log(`  min floor     ${state.config.min_floor}`);
console.log(`  game server   ${state.server}`);
console.log(`  holds         ${pcmb(economyHolds)} PCMB on the token\n`);

check(
	'token symbol and decimals',
	metadata.symbol === EXPECTED.symbol && metadata.decimals === EXPECTED.decimals,
	`${metadata.symbol}, ${metadata.decimals}`
);
check('token total supply', BigInt(supply) === EXPECTED.supply, pcmb(supply));
check('token code matches contracts/pcmb-token', tokenHash === EXPECTED.tokenCodeHash, tokenHash);
check(
	'economy code matches contracts/economy',
	economyHash === EXPECTED.economyCodeHash,
	economyHash
);
check('economy is paid in $PCMB', state.token === TOKEN, state.token);
check('economy owner', state.owner === OWNER, state.owner);
const owed = BigInt(state.pool) + BigInt(state.next_pool) + BigInt(reserve);
check(
	'economy holds enough $PCMB for both pools and the reserve',
	BigInt(economyHolds) >= owed,
	`${pcmb(economyHolds)} held, ${pcmb(owed)} in pools and reserve`
);
check(
	'gem price is at or above the base price',
	BigInt(state.gem_price) >= BigInt(state.config.gem_base_price),
	pcmb(state.gem_price)
);

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
