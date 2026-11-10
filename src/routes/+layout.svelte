<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}

<style>
	/* Browser default 8px body margin pushed the 9:16 frame past the viewport height. */
	:global(body) {
		margin: 0;
	}
</style>
