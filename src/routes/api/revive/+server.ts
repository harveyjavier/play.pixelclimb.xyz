import { error } from '@sveltejs/kit';
import { verifyRequest } from '#lib/economy.ts';
import { call, getPlayer, useOnce, accountOf } from '#lib/server/near.ts';
import type { RequestHandler } from './$types';

export const prerender = false;

/**
 * Buys one gem from the balance of the linked wallet, or of the browser account when the request
 * names no wallet. The page then tells the game to continue the run.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const req = verifyRequest(body, 'revive');
	if (typeof req === 'string') error(401, req);
	if (req.action !== 'revive' || !Number.isSafeInteger(req.gems)) error(400, 'Bad payload');
	const account = accountOf(req);
	useOnce(body.signature);
	// The page signs the gem count it saw, so a copied request stops working after one purchase.
	// shortcut: copies sent at the same instant to different server instances can still both pass;
	// closing that needs a shared store (or an expected-gems argument on buy_gem).
	if ((await getPlayer(account)).gems !== req.gems) error(409, 'Your balance changed, try again');
	const paid = await call<string>('buy_gem', { player: account }, 30, {
		'Not enough PCMB for a gem': 402
	});
	return Response.json({ paid });
};
