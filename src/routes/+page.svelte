<script lang="ts">
	import ConnectWallet from '#lib/connect-wallet.svelte';
	import logo from '#lib/assets/logo.png';
	import { formatPcmb, type StateResponse } from '#lib/economy.ts';
	import { playerId, signedPost } from '#lib/player.ts';

	let game = $state<HTMLIFrameElement>();
	let economy = $state.raw<StateResponse>();
	let now = $state(Date.now());
	type Panel = {
		id?: number;
		floor: number;
		note: string;
		saving: boolean;
		busy: boolean;
		error: string;
	};
	/** The open game-over panel: the run, whether it is saved, and the revive status. */
	let over = $state<Panel>();
	let settledRound = 0;
	let latest = 0; // the newest refresh; older responses are dropped

	const leftMs = $derived(economy ? economy.state.round_ends_at_ms - now : 0);
	const canRevive = $derived(
		!!economy?.player && BigInt(economy.player.balance) >= BigInt(economy.state.gem_price)
	);

	// The game ignores a reply whose id is not its latest game over (pcbridge.js).
	// Focus goes back to the game too, so the space bar keeps working after a panel button.
	const tell = (type: 'pc:revive' | 'pc:end', id?: number) => {
		game?.contentWindow?.postMessage({ type, id }, location.origin);
		game?.focus();
	};

	async function refresh() {
		const seq = ++latest;
		const res = await fetch(`/api/state?player=${playerId()}`).catch(() => null);
		const data = res?.ok ? await res.json() : undefined;
		if (data && seq === latest) economy = data;
	}

	function tick() {
		now = Date.now();
		// Round over: pay it out now so winnings show without waiting for someone's next run.
		const round = economy?.state.round;
		if (round && leftMs <= 0 && settledRound !== round) {
			settledRound = round;
			// A random delay spreads the open pages out, so one settles and the rest just read.
			setTimeout(
				() =>
					fetch('/api/settle', { method: 'POST' })
						.catch(() => {})
						.finally(refresh),
				Math.random() * 10_000
			);
		}
	}

	$effect(() => {
		refresh();
		const poll = setInterval(refresh, 20_000);
		const clock = setInterval(tick, 1000);
		return () => {
			clearInterval(poll);
			clearInterval(clock);
		};
	});

	async function submitRun(panel: Panel, durationMs: number) {
		try {
			const { recorded } = await signedPost<{ recorded: boolean }>('/api/run', {
				action: 'run',
				floor: panel.floor,
				durationMs
			});
			const min = economy?.state.config.min_floor ?? 0;
			panel.note = recorded ? 'Run saved for this round' : `Reach floor ${min} to earn`;
		} catch (e) {
			panel.note = (e as Error).message;
		}
		panel.saving = false;
		refresh();
	}

	async function revive() {
		const panel = over;
		if (!panel) return;
		panel.busy = true;
		panel.error = '';
		try {
			await signedPost('/api/revive', { action: 'revive', gems: economy?.player?.gems ?? 0 });
			if (over === panel) over = undefined;
			tell('pc:revive', panel.id);
		} catch (e) {
			panel.error = (e as Error).message;
			panel.busy = false;
		}
		refresh();
	}

	function end() {
		const id = over?.id;
		over = undefined;
		tell('pc:end', id);
	}

	// Game over from the Solar2D build (pcbridge.js in the pixel-climb repo). The page answers
	// { type: 'pc:revive', id } to continue the run or { type: 'pc:end', id } to end it.
	function onmessage(e: MessageEvent) {
		if (e.origin !== location.origin || e.source !== game?.contentWindow) return;
		const { type, id, floor, gems, durationMs } = e.data ?? {};
		const counts = [floor, gems, durationMs];
		if (type !== 'pc:gameover' || !counts.every((n) => Number.isSafeInteger(n) && n >= 0)) return;
		if (id !== undefined && !Number.isSafeInteger(id)) return; // builds before pixel-climb#1 send no id
		over = { id, floor, note: 'Saving run…', saving: true, busy: false, error: '' };
		submitRun(over, durationMs);
	}

	const clock = (ms: number) => {
		const s = Math.max(0, Math.ceil(ms / 1000));
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	};
</script>

<svelte:window {onmessage} />

<svelte:head>
	<title>Play Pixel Climb in your browser</title>
	<meta
		name="description"
		content="Tap to jump and climb endless floors. The full Pixel Climb game, running in your browser."
	/>
</svelte:head>

<main>
	<nav>
		<span class="title"
			><img src={logo} alt="" width="26" height="26" /><span class="name">Pixel Climb</span></span
		>
		<ConnectWallet />
	</nav>
	<div class="stats">
		{#if economy}
			{@const { state, player } = economy}
			{@const gems = player?.gems ?? 0}
			<span>
				Round {state.round} · Pool {formatPcmb(state.pool)} $PCMB · {leftMs > 0
					? `${clock(leftMs)} left`
					: 'Paying out…'} · Best {player?.best_floor ?? 0}
			</span>
			<span class="balance"
				>{formatPcmb(player?.balance ?? '0')} $PCMB · {gems} {gems === 1 ? 'gem' : 'gems'}</span
			>
		{:else}
			<span>Loading round…</span>
		{/if}
	</div>
	<div class="stage">
		<!-- Solar2D HTML5 build in static/game, made by scripts/game-web/build.sh. -->
		<iframe
			bind:this={game}
			src="/game/index.html"
			title="Pixel Climb game"
			allow="autoplay; fullscreen"
			onload={() => game?.focus()}
		></iframe>
		{#if over}
			<div
				class="over"
				role="dialog"
				aria-modal="true"
				aria-labelledby="over-title"
				tabindex="-1"
				{@attach (node) => node.focus()}
			>
				<h2 id="over-title">Floor {over.floor}</h2>
				<p aria-live="polite">{over.note}</p>
				<button type="button" onclick={revive} disabled={over.saving || over.busy || !canRevive}>
					{over.busy
						? 'Reviving…'
						: `Revive for ${formatPcmb(economy?.state.gem_price ?? '0')} $PCMB`}
				</button>
				{#if !canRevive && !over.busy && !over.saving}
					<p class="hint">Not enough $PCMB yet. Earn it by placing in a round.</p>
				{/if}
				{#if over.error}
					<p role="alert" class="error">{over.error}</p>
				{/if}
				<button type="button" onclick={end} disabled={over.busy}>End run</button>
			</div>
		{/if}
	</div>
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		min-height: 100dvh;
		padding: 1rem;
		background: #0a0a0a;
		color: #eee;
		box-sizing: border-box;
	}
	nav {
		display: flex;
		width: 100%;
		height: 2.5rem;
		max-width: min(100%, calc((100dvh - 8.5rem) * 2 / 3));
		min-width: 15.5rem; /* logo, short address and Disconnect; very short windows let it pass the frame a little */
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		container-type: inline-size; /* its width follows the frame, which narrows on short windows */
		font: 0.75rem/1 monospace;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: #888;
	}
	.title {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		white-space: nowrap;
	}
	.title img {
		image-rendering: pixelated; /* keep the pixel-art edges sharp when scaled down */
	}
	.stats {
		display: flex;
		flex-wrap: wrap;
		align-content: center;
		column-gap: 1rem;
		width: 100%;
		height: 2rem;
		max-width: min(100%, calc((100dvh - 8.5rem) * 2 / 3));
		justify-content: space-between;
		font: 0.6875rem/1rem monospace;
		letter-spacing: 0.05em;
		color: #aaa;
		white-space: nowrap;
	}
	.balance {
		color: #eee;
	}
	.stage {
		position: relative;
		aspect-ratio: 2 / 3; /* matches the Solar2D canvas (914x1371) */
		width: 100%;
		max-width: min(100%, calc((100dvh - 8.5rem) * 2 / 3));
		border-radius: 1rem;
		overflow: hidden;
		background: #000;
	}
	iframe {
		display: block;
		width: 100%;
		height: 100%;
		border: 0;
	}
	/* The game's own font (pixel-climb/fonts/slkscr.ttf), so the game-over panel looks like the game. */
	@font-face {
		font-family: Silkscreen;
		src: url('/fonts/silkscreen.ttf') format('truetype');
		font-display: swap;
	}
	/* Game-over panel in the game's look: white, pixel font, square edges, and the game's slate gray
	   (common.gray, #708090) darkened so text passes 4.5:1 contrast even over a dark frame. */
	.over {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.875rem;
		padding: 1.5rem;
		background: rgb(255 255 255 / 0.92);
		color: #5a6978;
		font:
			0.875rem/1.4 Silkscreen,
			monospace;
		text-align: center;
		text-transform: uppercase;
	}
	.over h2 {
		margin: 0 0 0.5rem;
		font-size: 2rem;
		font-weight: normal;
		letter-spacing: 0.05em;
	}
	.over:focus {
		outline: none;
	}
	.over p {
		margin: 0;
	}
	.over .error {
		color: #d00000;
	}
	.over button {
		min-width: 15rem;
		cursor: pointer;
		border: 3px solid #5a6978;
		border-radius: 0;
		background: #fff;
		color: #5a6978;
		padding: 0.75rem 1rem;
		font: inherit;
		text-transform: inherit;
	}
	.over button:first-of-type {
		background: #5a6978;
		color: #fff;
	}
	.over button:disabled {
		cursor: default;
		opacity: 0.4;
	}
	/* Phones: drop the framed card, nav on top, game fills the rest edge to edge. */
	@media (max-width: 600px) {
		main {
			height: 100dvh;
			padding: 0;
			gap: 0;
		}
		nav {
			max-width: none;
			padding: 0 0.75rem;
			box-sizing: border-box;
		}
	}
	/* A nav under 350px can't fit the name beside the short address: logo only, screen readers still get the name. */
	@container (max-width: 349px) {
		.name {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}
	@media (max-width: 600px) {
		.stats {
			height: auto;
			max-width: none;
			padding: 0.25rem 0.75rem;
			box-sizing: border-box;
		}
		.stage {
			flex: 1;
			min-height: 0;
			aspect-ratio: auto;
			max-width: none;
			border-radius: 0;
		}
	}
</style>
