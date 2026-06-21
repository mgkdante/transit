<!--
  /metrics article shell — ports the yesid.dev blog/projects listing layout
  (the "edge-title grid") onto the transit chrome, so /metrics reads as a sibling
  of yesid's blog/[slug] + projects/[slug] detail pages: same background, same
  rails, same measured reading column.

  STRUCTURE (1:1 with yesid's blog/projects +layout.svelte, on transit tokens):
    · A giant vertical writing-mode EDGE WORD in a sticky left column (the page
      subject — EN "METRICS." / FR "MESURE.", the period in --primary), flanked by
      the metro-station dots that bracket every yesid listing page.
    · A 2px --primary/35% accent-rail separating the edge column from the content.
    · The content column hosts the page tree ({@render children()}); the measured
      ~46rem reading column + the per-section article chrome (the hazard header,
      the TOC rail) live inside MetricsExplainer's own .body-grid.

  TRANSIT ADAPTATION: yesid's listing layout pulls the edge title up behind the
  fixed nav with `margin-top: -5rem; padding-top: 5rem`. Here the TopBar is a
  SEPARATE 60px strip ABOVE the #main scroll container (AppShell), so there is no
  nav to tuck under — the edge column simply sticks to the top of the scroll
  viewport (top: 0) and spans its height. The grid collapses to a single column
  below lg (the edge column + rail are desktop-only ornament), so mobile is the
  bare content, exactly like yesid.

  Tokens only, no hex; --primary is theme-mapped so both themes tune the rails.
-->
<script lang="ts">
	import { getLocale, type Locale } from '$lib/i18n';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';

	let { children }: { children: import('svelte').Snippet } = $props();

	const locale: Locale = getLocale();
	const edgeTitle = $derived(metricsCopy[locale].edgeTitle);
</script>

<div class="listing-layout">
	<div class="edge-title-column" aria-hidden="true">
		<div class="edge-title">{edgeTitle}<span class="edge-dot">.</span></div>
		<div class="metro-dots metro-dots-top">
			<div class="metro-line"></div>
			<div class="metro-dot metro-dot-sm"></div>
			<div class="metro-dot metro-dot-sm"></div>
			<div class="metro-dot metro-dot-sm"></div>
			<div class="metro-dot metro-dot-lg"></div>
		</div>
		<div class="metro-dots metro-dots-bottom">
			<div class="metro-dot metro-dot-lg"></div>
			<div class="metro-dot metro-dot-sm"></div>
			<div class="metro-dot metro-dot-sm"></div>
			<div class="metro-dot metro-dot-sm"></div>
			<div class="metro-line"></div>
		</div>
	</div>
	<div class="accent-rail"></div>
	<div class="listing-content">
		{@render children()}
	</div>
</div>

<style>
	/* Edge-title grid (yesid Recipe 4). Single column on mobile (edge ornament +
	   rail are display:none); a 3-track grid at lg: [edge word] [2px rail] [content]. */
	.listing-layout {
		display: block;
		width: 100%;
	}
	.edge-title-column {
		display: none;
	}
	.accent-rail {
		display: none;
	}
	.listing-content {
		min-width: 0;
	}

	@media (min-width: 1024px) {
		.listing-layout {
			display: grid;
			grid-template-columns: auto 2px 1fr;
		}
		/* The edge column sticks to the top of the #main scroll viewport (the
		   TopBar is a separate strip above it, so no negative-margin nav tuck like
		   yesid — the edge word simply spans the viewport height as you scroll). */
		.edge-title-column {
			display: flex;
			align-items: center;
			justify-content: center;
			position: sticky;
			top: 0;
			height: 100dvh;
			writing-mode: vertical-rl;
			transform: rotate(180deg);
			padding: 1rem 1.5rem;
		}
		.edge-title {
			font-family: var(--font-heading);
			font-size: clamp(6rem, 12vw, 13rem);
			font-weight: 900;
			color: var(--foreground);
			white-space: nowrap;
			line-height: 1;
			letter-spacing: -0.04em;
		}
		.edge-dot {
			color: var(--primary);
		}
		/* The 2px accent rail (operator's "one step bolder" — 35% primary). */
		.accent-rail {
			display: block;
			background: color-mix(in srgb, var(--primary) 35%, transparent);
		}
	}

	/* Metro station dots — bracket the edge word top + bottom (yesid listing). */
	.metro-dots {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		writing-mode: horizontal-tb;
	}
	.metro-dots-top {
		top: 16px;
	}
	.metro-dots-bottom {
		bottom: 16px;
	}
	.metro-line {
		width: 2px;
		height: 32px;
		background: color-mix(in srgb, var(--primary) 25%, transparent);
	}
	.metro-dot {
		border-radius: 50%;
	}
	.metro-dot-sm {
		width: 6px;
		height: 6px;
		border: 1.5px solid color-mix(in srgb, var(--primary) 35%, transparent);
	}
	.metro-dot-lg {
		width: 10px;
		height: 10px;
		background: color-mix(in srgb, var(--primary) 25%, transparent);
		border: 2px solid color-mix(in srgb, var(--primary) 45%, transparent);
	}
</style>
