<!--
  RailLayout — sticky-rail body grid (extracted from MetricsExplainer).

  The yesid.dev detail-page body grid, lifted into a reusable layout primitive:
  a two-column grid at >=lg with a sticky context rail on the left and the main
  content column on the right; a single column below lg (the rail flows above
  the content in source order — the caller supplies a floating pill / drawer for
  the mobile affordance, exactly as MetricsExplainer does with TocPill).

    DESKTOP (>=1024px): [rail minmax(13rem,17rem)] [content minmax(0,1fr)],
      gap 2rem, align-items:start; the rail is position:sticky at top:var(--chrome-offset).
    MOBILE (<1024px): one column; both panes stack (rail first, then content).

  Snippet-prop based (Svelte 5 runes), layout only, doctrine-clean: no data
  marks, no colour, tokens only. It owns ONLY the grid + the sticky offset — the
  caller fills `rail` and `content` with whatever they need (a TocNav, a controls
  rail, prose, cards).

  `railLabel` gives the rail's <aside> an accessible name when the rail is a
  navigational/landmark region; omit it for a purely presentational rail.
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	interface RailLayoutProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
		/** The sticky context rail (left column on desktop, stacked above on mobile). */
		rail?: Snippet;
		/** The main content column (right column on desktop). */
		content?: Snippet;
		/** Accessible label for the rail <aside> landmark. Omit for a presentational rail. */
		railLabel?: string;
		class?: string;
	}

	let { rail, content, railLabel, class: className, ...restProps }: RailLayoutProps = $props();
</script>

<div class={cn('rail-layout', className)} data-slot="rail-layout" {...restProps}>
	<aside class="rail-layout__rail" data-slot="rail-layout-rail" aria-label={railLabel}>
		<div class="rail-layout__rail-sticky">
			{@render rail?.()}
		</div>
	</aside>

	<div class="rail-layout__content" data-slot="rail-layout-content">
		{@render content?.()}
	</div>
</div>

<style>
	/* Mobile-first: one column, rail then content (source order). Mirrors the
	   MetricsExplainer body-grid at <lg. */
	.rail-layout {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-card-gap);
		min-width: 0;
		overflow-x: clip;
	}

	.rail-layout__rail,
	.rail-layout__content {
		min-width: 0;
	}

	@media (min-width: 1024px) {
		.rail-layout {
			grid-template-columns: minmax(13rem, 17rem) minmax(0, 1fr);
			gap: 2rem;
			align-items: start;
		}

		.rail-layout__rail {
			grid-column: 1;
		}

		.rail-layout__content {
			grid-column: 2;
		}

		/* The rail tracks the content as it scrolls, parked under the floating
		   chrome via the single --chrome-offset knob (AppShell owns it). */
		.rail-layout__rail-sticky {
			position: sticky;
			top: var(--chrome-offset);
		}
	}
</style>
