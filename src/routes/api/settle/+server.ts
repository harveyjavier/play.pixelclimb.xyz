import { getState, settleIfOver } from '#lib/server/near.ts';
import type { RequestHandler } from './$types';

export const prerender = false;

/**
 * Pays out the round if it is over. The page calls this when its countdown hits zero, so winnings
 * show without waiting for the next run. Before the round ends it only reads the state.
 */
export const POST: RequestHandler = async () =>
	Response.json({ state: await settleIfOver(await getState()) });
