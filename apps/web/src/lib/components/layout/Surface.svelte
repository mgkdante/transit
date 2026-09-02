<!--
  Surface — the page content shell (A1: full-bleed law).

  A1 dropped the boxed max-width variants (content|wide|bleed). Surface now
  ALWAYS fills its rail-inset <main> box edge-to-edge; content lanes are formed
  by the gutter (`padding-inline: var(--space-page-x)`), not by a centred
  max-width cap. Consumers own any narrower prose measures locally; the Masthead
  head family carries its own capped lede lane.
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	interface SurfaceProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
		children?: Snippet;
		gutter?: boolean;
		pad?: 'surface' | 'none';
		as?: 'section' | 'div' | 'article';
		class?: string;
	}
	let {
		children,
		gutter = true,
		pad = 'surface',
		as = 'section',
		class: className,
		...rest
	}: SurfaceProps = $props();
</script>

<svelte:element
	this={as}
	class={cn('surface-shell', `surface-shell--${pad}`, gutter && 'surface-shell--gutter', className)}
	data-slot="surface"
	{...rest}
>
	{@render children?.()}
</svelte:element>

<style>
	/* A1 full-bleed: the shell always fills the rail-inset <main> width. No
	   max-width cap, no centring — content lanes come from the gutter below. */
	.surface-shell {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: clamp(1.75rem, 4vw, 2.75rem);
	}
	.surface-shell--gutter {
		padding-inline: var(--space-page-x);
	}
	.surface-shell--surface {
		padding-block: clamp(1.5rem, 4vw, 2.5rem);
	}
	.surface-shell--none {
		padding-block: 0;
	}

	/* A child opts into full-bleed by escaping the Surface gutter out to the
	   content-column edges (the rail-inset <main> box). It does NOT escape the
	   rail offset — that lives on AppShell's <main> padding-left and is the
	   "never behind the rail" boundary. Negative margin = the live gutter, so
	   the band's edges land exactly on the page padding line (no JS, no 100vw —
	   reacts live as the rail is dragged because <main>'s padding moves the box). */
	:global(.surface-bleed) {
		margin-inline: calc(-1 * var(--space-page-x));
	}
</style>
