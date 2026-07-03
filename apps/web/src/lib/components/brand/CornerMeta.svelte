<!--
  CornerMeta — four absolute corner readouts for a hero zone (§C2.4).

  Blueprint-margin annotations: mono --text-micro in --muted-foreground pinned
  to the four corners of a position:relative host. REAL data only — provider
  name · generated_utc · route/stop counts · build short-hash. Never
  decoration-only text. Hero zones ONLY (home hero, detail heads, /metrics
  masthead); never on dense data sections.

  Decorative by contract: aria-hidden + pointer-events:none — it annotates,
  it never carries the accessible name (the real head does). Hidden < 768px
  (the corners crowd on mobile). Opt-in crosshair ornament (§1.3 design
  language) via `crosshair` — L-tick registration marks in --primary at the
  four corners, drawn behind the readouts.

  The host must be position:relative. Drop this as the first child of the hero
  zone: <div class="hero" style="position:relative"> <CornerMeta ... /> … </div>
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import CornerMarks from './CornerMarks.svelte';
	import { cn } from '$lib/utils';

	export interface CornerMetaProps {
		/** Top-left readout (real data). */
		topLeft?: Snippet;
		/** Top-right readout (real data). */
		topRight?: Snippet;
		/** Bottom-left readout (real data). */
		bottomLeft?: Snippet;
		/** Bottom-right readout (real data). */
		bottomRight?: Snippet;
		/** Opt-in crosshair registration ornament (§1.3). Default off. */
		crosshair?: boolean;
		class?: string;
		[key: string]: unknown;
	}

	let {
		topLeft,
		topRight,
		bottomLeft,
		bottomRight,
		crosshair = false,
		class: className,
		...rest
	}: CornerMetaProps = $props();
</script>

<div class={cn('corner-meta', className)} data-slot="corner-meta" aria-hidden="true" {...rest}>
	{#if crosshair}
		<CornerMarks size="sm" />
	{/if}
	{#if topLeft}
		<span class="corner corner-tl" data-slot="corner-tl">{@render topLeft()}</span>
	{/if}
	{#if topRight}
		<span class="corner corner-tr" data-slot="corner-tr">{@render topRight()}</span>
	{/if}
	{#if bottomLeft}
		<span class="corner corner-bl" data-slot="corner-bl">{@render bottomLeft()}</span>
	{/if}
	{#if bottomRight}
		<span class="corner corner-br" data-slot="corner-br">{@render bottomRight()}</span>
	{/if}
</div>

<style>
	.corner-meta {
		position: absolute;
		inset: 0;
		pointer-events: none;
		/* Below content, above the panel surface — annotation, not chrome. */
		z-index: var(--z-content);
		display: none;
	}

	/* Corners crowd the head on mobile — surface only >= 768px. */
	@media (min-width: 768px) {
		.corner-meta {
			display: block;
		}
	}

	.corner {
		position: absolute;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		line-height: 1.2;
		letter-spacing: var(--tracking-wide);
		color: var(--muted-foreground);
		white-space: nowrap;
	}

	.corner-tl {
		top: 0.75rem;
		left: 0.75rem;
	}
	.corner-tr {
		top: 0.75rem;
		right: 0.75rem;
		text-align: right;
	}
	.corner-bl {
		bottom: 0.75rem;
		left: 0.75rem;
	}
	.corner-br {
		bottom: 0.75rem;
		right: 0.75rem;
		text-align: right;
	}
</style>
