<script lang="ts">
	import ConnectWallet from '#lib/connect-wallet.svelte';
</script>

<svelte:head>
	<title>Play Pixel Climb in your browser</title>
	<meta
		name="description"
		content="Tap to jump and climb endless floors. The full Pixel Climb game, running in your browser."
	/>
</svelte:head>

<main>
	<nav>
		<span class="title">Pixel Climb</span>
		<ConnectWallet />
	</nav>
	<!-- Solar2D HTML5 build in static/game (from scripts/game-web/build.sh in the landing repo). -->
	<iframe src="/game/index.html" title="Pixel Climb game" allow="autoplay; fullscreen"></iframe>
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
		max-width: min(100%, calc((100dvh - 5.5rem) * 2 / 3));
		align-items: center;
		justify-content: space-between;
		font: 0.75rem/1 monospace;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: #888;
	}
	iframe {
		aspect-ratio: 2 / 3; /* matches the Solar2D canvas (914x1371) */
		width: 100%;
		max-width: min(100%, calc((100dvh - 5.5rem) * 2 / 3));
		border: 0;
		border-radius: 1rem;
		background: #000;
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
		iframe {
			flex: 1;
			min-height: 0;
			aspect-ratio: auto;
			max-width: none;
			border-radius: 0;
		}
	}
</style>
