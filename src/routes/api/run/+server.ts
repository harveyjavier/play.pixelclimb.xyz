import { error } from '@sveltejs/kit';
import { isPlausibleRun, verifyRequest } from '#lib/economy.ts';
import { call, getPlayer, getState, settle, settleIfOver, useOnce } from '#lib/server/near.ts';
import type { RequestHandler } from './$types';

export const prerender = false;

/** A finished run: checked, then recorded as the player's floor for this round. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const req = verifyRequest(body, 'run');
	if (typeof req === 'string') error(401, req);
	if (req.action !== 'run') error(400, 'Bad payload');
	// shortcut: the duration comes from the page, so this stops impossible runs, not a cheater who
	// sends a plausible one; a server-side start time per run needs a run-start message from the game.
	if (!isPlausibleRun(req.floor, req.durationMs))
		error(422, 'That floor is not reachable in that time');
	useOnce(body.signature);

	const state = await settleIfOver(await getState());
	const best = (await getPlayer(req.player)).best_floor;
	// Below the minimum earns nothing, and the contract only keeps the best floor: skip the gas.
	if (req.floor < state.config.min_floor)
		return Response.json({ recorded: false, round: state.round });
	if (req.floor <= best) return Response.json({ recorded: true, round: state.round });
	const record = () => call('record_run', { player: req.player, floor: req.floor }, 30, over);
	// Our clock said the round was still on, the chain's says it ended: pay it out and try again.
	await record().catch(async (e) => {
		if (e?.status !== 409) throw e;
		await settle();
		await record();
	});
	return Response.json({ recorded: true, round: state.round });
};

const over = { 'Round is over': 409 };
