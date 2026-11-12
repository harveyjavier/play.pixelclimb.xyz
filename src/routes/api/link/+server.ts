import { error } from '@sveltejs/kit';
import { verifyRequest } from '#lib/economy.ts';
import { call, getPlayer, useOnce, walletOf } from '#lib/server/near.ts';
import type { RequestHandler } from './$types';

export const prerender = false;

/**
 * The page linked its browser key to a wallet. Anything the browser account earned before (balance,
 * gems, this round's best floor) moves to the wallet, which is where the player expects it.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const req = verifyRequest(body, 'link');
	if (typeof req === 'string') error(401, req);
	const wallet = walletOf(req);
	useOnce(body.signature);
	const old = await getPlayer(req.player);
	// Nothing to move costs no gas; that is every reconnect after the first.
	if (old.balance === '0' && old.gems === 0 && old.best_floor === 0)
		return Response.json({ moved: false });
	await call('merge_player', { from: req.player, to: wallet });
	return Response.json({ moved: true });
};
