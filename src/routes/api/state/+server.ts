import { error } from '@sveltejs/kit';
import { isPlayerId, isWallet, type StateResponse } from '#lib/economy.ts';
import { ECONOMY, getPlayer, getState, view } from '#lib/server/near.ts';
import type { RequestHandler } from './$types';

export const prerender = false;

/**
 * Round, pool and gem price, plus the player's best floor, balance and gems when `?player=` is set.
 * For a wallet, also the $PCMB it holds outside the game, so the page can offer a deposit.
 */
export const GET: RequestHandler = async ({ url }) => {
	const id = url.searchParams.get('player');
	if (id !== null && !isPlayerId(id) && !isWallet(id)) error(400, 'Bad player id');
	const [state, player] = await Promise.all([getState(), id ? getPlayer(id) : null]);
	const tokens = isWallet(id)
		? await view<string>('ft_balance_of', { account_id: id }, state.token)
		: null;
	return Response.json({ state, player, economy: ECONOMY, tokens } satisfies StateResponse);
};
