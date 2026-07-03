<!--
  DetailTemplate — the thin 3-column detail grid shell (§C2.6, P5.3b).

  A composition shell only (no data marks, no chrome): it owns the LAYOUT of the
  detail-page IA and nothing else. Consumers (P5.3c, NOT wired here) fill the
  slots — /metrics (right: Provenance / Coverage / Freshness) and /status (right:
  per-feed stat cards).

  Desktop (≥xl / 1280px): `grid-template-columns: 1fr 2fr 1fr`, gap 2rem,
  padding-block 2.5rem. Left rail (ToC / context) and right rail (stat cards) are
  sticky at `top: var(--chrome-offset)` — the single P5.3a offset knob (already in
  AppShell); NEVER a hardcoded literal.

  Mobile (<xl): single column, order head → summary strip → sections → [ToC lives
  in the page's floating TocPill, not here]. The right rail is NOT dropped on
  mobile — its stats reflow to a top summary strip via the `mobileSummary` snippet
  so the reader keeps the numbers. When no `mobileSummary` is given, the right
  slot is simply hidden below xl (the desktop-only case).

  Slots: `left` · `center` · `right` · `mobileSummary` (+ `head` above the grid).
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	export interface DetailTemplateProps {
		/** Full-width head above the grid (kicker + title + lede). */
		head?: Snippet;
		/** Left rail — ToC / SEC readout / context cards (sticky, desktop). */
		left?: Snippet;
		/** Center column — the numbered sections (2fr). */
		center?: Snippet;
		/** Right rail — stat cards (sticky, desktop). */
		right?: Snippet;
		/** Mobile-only top summary strip (the right-rail stats reflowed). */
		mobileSummary?: Snippet;
		class?: string;
	}

	let {
		head,
		left,
		center,
		right,
		mobileSummary,
		class: className,
	}: DetailTemplateProps = $props();
</script>

<div data-slot="detail-template" class={cn('detail-template', className)}>
	{#if head}
		<div class="detail-head" data-slot="detail-head">{@render head()}</div>
	{/if}

	{#if mobileSummary}
		<div class="detail-mobile-summary" data-slot="detail-mobile-summary">
			{@render mobileSummary()}
		</div>
	{/if}

	<div class="detail-grid">
		{#if left}
			<aside class="detail-rail detail-rail--left" data-slot="detail-left">{@render left()}</aside>
		{/if}
		<div class="detail-center" data-slot="detail-center">
			{#if center}{@render center()}{/if}
		</div>
		{#if right}
			<aside class="detail-rail detail-rail--right" data-slot="detail-right">
				{@render right()}
			</aside>
		{/if}
	</div>
</div>

<style>
	.detail-template {
		display: flex;
		flex-direction: column;
	}
	.detail-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-card-gap);
		padding-block: 1.5rem;
	}

	/* Mobile: the right-rail stats live in a top summary strip; the desktop rails
	   collapse into the single column flow. Order = head → strip → sections. */
	.detail-mobile-summary {
		display: block;
	}
	/* When there is no mobile summary the right rail is desktop-only. */
	.detail-rail--right {
		display: none;
	}
	.detail-rail--left {
		display: block;
	}

	@media (min-width: 1280px) {
		.detail-grid {
			grid-template-columns: 1fr 2fr 1fr;
			gap: 2rem;
			padding-block: 2.5rem;
		}
		/* The mobile summary strip is redundant once the right rail is visible. */
		.detail-mobile-summary {
			display: none;
		}
		.detail-rail {
			position: sticky;
			/* The single P5.3a offset knob — never a hardcoded literal. */
			top: var(--chrome-offset);
			align-self: start;
			max-height: calc(100dvh - var(--chrome-offset));
			overflow-y: auto;
		}
		.detail-rail--right {
			display: block;
		}
	}

	/* The center column never overflows its track (long tables/pre scroll inside). */
	.detail-center {
		min-width: 0;
	}
</style>
