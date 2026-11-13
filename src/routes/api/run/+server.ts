import { error } from '@sveltejs/kit';
import {
	MAX_COUNTED_FLOOR,
	isPlausibleRun,
	isReachableSince,
	verifyRequest
} from '#lib/economy.ts';
import {
	call,
	getPlayer,
	getState,
	settle,
	settleIfOver,
	useOnce,
	accountOf,
	ticketAgeOf
} from '#lib/server/near.ts';
import type { RequestHandler } from './$types';

export const prerender = false;

/**
 * A finished run: checked, then recorded for this round as the floor of the linked wallet, or of
 * the browser account when the request names no wallet.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const req = verifyRequest(body, 'run');
	if (typeof req === 'string') error(401, req);
	if (req.action !== 'run') error(400, 'Bad payload');
	// Two clocks: the page's run time, and the server's time since it issued the run ticket, which a
	// script can't shorten. A script that waits can still send a believable run, so a floor above
	// MAX_COUNTED_FLOOR counts as that floor: one fake run can at best tie the top players.
	if (!isPlausibleRun(req.floor, req.durationMs) || !isReachableSince(req.floor, ticketAgeOf(req)))
		error(422, 'That floor is not reachable in that time');
	const floor = Math.min(req.floor, MAX_COUNTED_FLOOR);
	const account = accountOf(req);
	useOnce(body.signature);

	const state = await settleIfOver(await getState());
	const best = (await getPlayer(account)).best_floor;
	// Below the minimum earns nothing, and the contract only keeps the best floor: skip the gas.
	if (floor < state.config.min_floor) return Response.json({ recorded: false, round: state.round });
	if (floor <= best) return Response.json({ recorded: true, round: state.round });
	const record = () => call('record_run', { player: account, floor }, 30, over);
	// Our clock said the round was still on, the chain's says it ended: pay it out and try again.
	await record().catch(async (e) => {
		if (e?.status !== 409) throw e;
		await settle();
		await record();
	});
	return Response.json({ recorded: true, round: state.round });
};

const over = { 'Round is over': 409 };
