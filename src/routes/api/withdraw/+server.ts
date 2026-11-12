import { error } from '@sveltejs/kit';
import { verifyRequest } from '#lib/economy.ts';
import { call, getPlayer, useOnce, walletOf } from '#lib/server/near.ts';
import type { RequestHandler } from './$types';

export const prerender = false;

/** Sends the wallet's whole $PCMB balance from the game to the wallet itself. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const req = verifyRequest(body, 'withdraw');
	if (typeof req === 'string') error(401, req);
	const wallet = walletOf(req);
	useOnce(body.signature);
	const { balance } = await getPlayer(wallet);
	if (balance === '0') error(402, 'Nothing to withdraw');
	// storage_deposit, ft_transfer and the callback: 10 + 10 + 5 Tgas, plus this call's own work.
	await call('withdraw_for', { player: wallet, amount: balance }, 50);
	return Response.json({ withdrawn: balance });
};
