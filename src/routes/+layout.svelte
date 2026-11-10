<script lang="ts">
	import logo from '#lib/assets/logo.png';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href="/favicon.ico" sizes="16x16 32x32" />
	<link rel="apple-touch-icon" href={logo} />
</svelte:head>

{@render children()}

<style>
	/* Browser default 8px body margin pushed the 9:16 frame past the viewport height. */
	:global(body) {
		margin: 0;
	}
</style>
