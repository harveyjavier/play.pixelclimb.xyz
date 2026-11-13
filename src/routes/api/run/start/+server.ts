import { error } from '@sveltejs/kit';
import { isPlayerId } from '#lib/economy.ts';
import { issueTicket } from '#lib/server/near.ts';
import type { RequestHandler } from './$types';

export const prerender = false;

/**
 * A run ticket for `?player=`: the server's signed start time. `/api/run` checks the floor against
 * the time since, so a run can't claim a floor faster than the game allows by the server's clock.
 */
export const GET: RequestHandler = ({ url }) => {
	const player = url.searchParams.get('player');
	if (!isPlayerId(player)) error(400, 'Bad player');
	return Response.json(
		{ ticket: issueTicket(player) },
		{ headers: { 'cache-control': 'no-store' } }
	);
};
