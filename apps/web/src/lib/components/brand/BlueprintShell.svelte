<!--
  BlueprintShell — Shared shell for Da Vincian blueprint header backgrounds.
  Provides crosshairs, reference labels, and CSS for absolute SVG positioning.
  Consumer passes SVG layers via the `hero` and `details` snippets, plus label text.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	export interface BlueprintShellProps {
		/** Hero SVG layer (full-width, faintest) — rendered first */
		hero: Snippet;
		/** Detail SVG layers (absolutely positioned) — rendered in edge-details container */
		details: Snippet;
		/** Reference labels: [top-right, bottom-left, bottom-right] */
		labels: [string, string, string];
		class?: string;
		[key: string]: unknown;
	}

	let { hero, details, labels, class: className = '', ...rest }: BlueprintShellProps = $props();
</script>

<div
	class="blueprint-bg absolute inset-0 z-0 text-[var(--primary)] {className}"
	aria-hidden="true"
	{...rest}
>
	<!-- Hero layer -->
	<div class="hero-svg absolute inset-x-0 top-[10%] bottom-[10%] z-0 opacity-[0.16]">
		{@render hero()}
	</div>

	<!-- Detail layers -->
	<div class="edge-details absolute inset-0 z-0 overflow-hidden">
		{@render details()}
	</div>

	<!-- Corner crosshairs -->
	<div class="crosshair" style="top:24px;left:24px;"></div>
	<div class="crosshair" style="top:24px;right:24px;"></div>
	<div class="crosshair" style="bottom:24px;left:24px;"></div>
	<div class="crosshair" style="bottom:24px;right:24px;"></div>

	<!-- Reference labels -->
	<span class="ref-label" style="top:16px;right:56px;">{labels[0]}</span>
	<span class="ref-label" style="bottom:16px;left:56px;">{labels[1]}</span>
	<span class="ref-label" style="bottom:16px;right:56px;">{labels[2]}</span>
</div>

<style>
	.crosshair {
		position: absolute;
		width: 24px;
		height: 24px;
	}
	.crosshair::before {
		content: '';
		position: absolute;
		width: 24px;
		height: 1px;
		background: color-mix(in srgb, var(--primary) 15%, transparent);
		top: 50%;
	}
	.crosshair::after {
		content: '';
		position: absolute;
		width: 1px;
		height: 24px;
		background: color-mix(in srgb, var(--primary) 15%, transparent);
		left: 50%;
	}

	/* The assemblies' drafting <text> hardcodes a "JetBrains Mono" presentation
	   attribute the app never registers (only the Variable face loads); CSS
	   outranks presentation attributes, so pin every label to the mono TOKEN
	   here — one rule for all art (R3a review). */
	.blueprint-bg :global(text) {
		font-family: var(--font-mono);
	}

	.ref-label {
		position: absolute;
		font-family: var(--font-mono);
		font-size: 10px;
		color: color-mix(in srgb, var(--primary) 20%, transparent);
		letter-spacing: 1.5px;
		z-index: var(--z-base);
	}

	/* GO2-W5 taste round 2: the blueprint art must be VISIBLE in light —
	   operator verdict. The hero/detail layers ship dark-tuned opacities
	   (0.10–0.18) that vanish on warm paper, so light mode roughly doubles
	   them (!important beats the consumers' inline detail opacities) and
	   hardens the annotations. The whole shell stays aria-hidden decoration.
	   Round 3 (operator: light "still needs more demarcation"): each value up
	   another step — hero 0.34→0.46, details 0.30→0.42, crosshairs 40→55%,
	   ref labels 55→70%. Confident drawing on paper, still background art. */
	:global([data-theme='light']) .hero-svg,
	:global(.theme-light) .hero-svg {
		opacity: 0.46;
	}
	:global([data-theme='light']) .edge-details :global(.edge-detail),
	:global(.theme-light) .edge-details :global(.edge-detail) {
		opacity: 0.42 !important;
	}
	:global([data-theme='light']) .crosshair::before,
	:global([data-theme='light']) .crosshair::after,
	:global(.theme-light) .crosshair::before,
	:global(.theme-light) .crosshair::after {
		background: color-mix(in srgb, var(--primary) 55%, transparent);
	}
	:global([data-theme='light']) .ref-label,
	:global(.theme-light) .ref-label {
		color: color-mix(in srgb, var(--primary) 70%, transparent);
	}

	:global(.edge-detail) {
		position: absolute;
	}

	@media (max-width: 1023px) {
		.hero-svg {
			opacity: 0.3;
		}

		.edge-details :global(.edge-detail) {
			opacity: 0.3 !important;
		}

		:global([data-theme='light']) .hero-svg,
		:global(.theme-light) .hero-svg {
			opacity: 0.5;
		}

		:global([data-theme='light']) .edge-details :global(.edge-detail),
		:global(.theme-light) .edge-details :global(.edge-detail) {
			opacity: 0.46 !important;
		}

		.ref-label,
		.crosshair {
			display: none;
		}
	}
</style>
