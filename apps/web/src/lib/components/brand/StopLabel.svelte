<!--
  StopLabel — STM stop marker with a pulsing LED lamp.
  Brand primitive (Set B): mono wayfinding plate, FR prefix.
  Renders "ARRÊT {stop} · {label}" — the digits speak the amber voice.
  Adapted from yesid.dev StopLabel; re-themed to transit tokens, FR-localized.
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';

	export interface StopLabelProps extends HTMLAttributes<HTMLDivElement> {
		/** Stop number (e.g. "01", "02") */
		stop: string;
		/**
		 * Stop name. Optional: when omitted/empty, the plate shows just the
		 * "ARRÊT {stop}" number (no trailing separator) — the meta-chip form used in
		 * the detail head where the name is the display h1 above.
		 */
		label?: string;
		/**
		 * Element to render as. Default `div` (a plain plate); pass a heading tag
		 * (e.g. `h1`) when this plate IS the surface's title, so the page earns a
		 * real heading outline (the SectionHeading law, §C2.7). The visible mono
		 * wayfinding look is identical either way.
		 */
		as?: 'div' | 'h1' | 'h2' | 'h3';
		class?: string;
	}

	let { stop, label, as = 'div', class: className, ...restProps }: StopLabelProps = $props();

	// The name is optional in the meta-chip form (the display h1 carries the name);
	// omit the "·" separator when there is no label so no orphan separator shows.
	const hasLabel = $derived(label != null && label !== '');
</script>

<svelte:element this={as} class={cn('stop-label', className)} data-slot="stop-label" {...restProps}>
	<span class="stop-label-num">ARRÊT {stop}</span>{#if hasLabel}
		· {label}{/if}
</svelte:element>

<style>
	.stop-label {
		/* Reset the UA heading box so `as="h1"` looks identical to the div plate. */
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 400;
		letter-spacing: 2px;
		color: var(--muted-foreground);
		position: relative;
		padding-left: 16px;
		text-transform: uppercase;
	}

	/* The stop digits carry the yellow wayfinding voice (accent-text =
	   AA-computed amber ink, STM-style station numbering). */
	.stop-label-num {
		color: var(--accent-text);
	}

	/* Pulse-glow lamp — the LED sits ahead of the plate. The keyframe
	   lives in app.css (single source). */
	.stop-label::before {
		content: '';
		position: absolute;
		left: 0;
		top: 50%;
		transform: translateY(-50%);
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--primary);
		box-shadow: 0 0 6px 2px rgb(var(--primary-rgb) / 0.6);
		animation: pulse-glow 2s ease-in-out infinite;
	}

	/* In daylight the lamp sits on a signal-head bezel so it reads against paper. */
	:global([data-theme='light']) .stop-label::before,
	:global(.theme-light) .stop-label::before {
		outline: 2px solid var(--lamp-bezel);
		outline-offset: 0px;
	}

	@media (prefers-reduced-motion: reduce) {
		.stop-label::before {
			animation: none;
		}
	}
</style>
