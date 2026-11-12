import { error } from '@sveltejs/kit';
import { isPlayerId, isWallet, type StateResponse } from '#lib/economy.ts';
import { getPlayer, getState } from '#lib/server/near.ts';
import type { RequestHandler } from './$types';

export const prerender = false;

/** Round, pool and gem price, plus the player's best floor, balance and gems when `?player=` is set. */
export const GET: RequestHandler = async ({ url }) => {
	const id = url.searchParams.get('player');
	if (id !== null && !isPlayerId(id) && !isWallet(id)) error(400, 'Bad player id');
	const [state, player] = await Promise.all([getState(), id ? getPlayer(id) : null]);
	return Response.json({ state, player } satisfies StateResponse);
};
