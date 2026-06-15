<!--
  SurfaceHeader — the canonical surface head block.

  Mirrors the hub landing head (src/routes/[[lang=locale]]/+page.svelte): a
  station-voice kicker over a display heading (+ optional mono subheading) with
  an optional lede paragraph and an optional anchors/actions row. Every data
  surface composes this so the head reads identically across the app.

  Brand primitives only (SectionLabel + SectionHeading). Tokens, no hex.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';

	interface SurfaceHeaderProps {
		/** Mono station-voice overline (e.g. "NETWORK · LIVE"). */
		kicker: string;
		/** The display heading text. */
		heading: string;
		/** Optional mono subheading under the heading (e.g. "// MESURE"). */
		subheading?: string;
		/** Optional lede paragraph (muted, ~52ch). */
		lede?: string;
		/** Heading level (1–6). Default 1 — surfaces are page-level. */
		level?: 1 | 2 | 3 | 4 | 5 | 6;
		/** Optional anchors / actions row rendered below the lede. */
		children?: Snippet;
		/** Optional extra classes on the header root. */
		class?: string;
	}

	let {
		kicker,
		heading,
		subheading,
		lede,
		level = 1,
		children,
		class: className,
	}: SurfaceHeaderProps = $props();
</script>

<header class={cn('surface-header', className)} data-slot="surface-header">
	<SectionLabel text={kicker} variant="station" />
	<SectionHeading {heading} {subheading} {level} dot />
	{#if lede}
		<p class="surface-lede">{lede}</p>
	{/if}
	{#if children}
		{@render children()}
	{/if}
</header>

<style>
	.surface-header {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.surface-lede {
		color: var(--muted-foreground);
		font-size: var(--text-subheading);
		line-height: 1.6;
		max-width: 52ch;
	}
</style>
