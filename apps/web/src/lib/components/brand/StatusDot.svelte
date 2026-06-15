<!--
  StatusDot — LED status indicator (Set A).
  Brand primitive: replaces scattered LED-dot implementations.
  Adapted from yesid.dev StatusDot; re-themed to transit tokens.

  DOCTRINE: this dot can encode DATA (the v1 StatusCode aspects map to the
  dataviz status scale, never --primary). Signal aspects (green/caution/stop/
  lunar) speak the interlocking-signal palette. `orange` is the lone
  INTERACTIVE/default accent and is the only value that touches --primary.
  a11y: colour is never the sole channel — pass `label` for a visually-hidden
  text equivalent (and pair with a glyph at the call site).
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';

	/** v1 StatusCode aspects — encoded with the dataviz status scale (DATA). */
	type StatusAspect = 'early' | 'on_time' | 'late' | 'severe' | 'unknown';
	/** Interlocking-signal aspects + the lone interactive accent. */
	type SignalAspect = 'orange' | 'green' | 'caution' | 'stop' | 'lunar';

	export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
		/**
		 * Dot colour. Signal aspects (orange/green/caution/stop/lunar) or a v1
		 * StatusCode (early/on_time/late/severe/unknown). StatusCodes resolve to
		 * the dataviz status scale so the mark stays doctrine-clean.
		 */
		color?: SignalAspect | StatusAspect;
		/** Enable the LED pulse-glow animation. */
		pulse?: boolean;
		/** Dot size. */
		size?: 'sm' | 'md';
		/**
		 * Halo ring in muted card colour — for dots overlaid on busy surfaces.
		 * Uses CSS outline so it composes with the box-shadow pulse animation.
		 */
		ring?: boolean;
		/** Visually-hidden text label (a11y: colour is never the sole channel). */
		label?: string;
		class?: string;
	}

	let {
		color = 'orange',
		pulse = false,
		size = 'sm',
		ring = false,
		label,
		class: className,
		...restProps
	}: StatusDotProps = $props();

	const sizeMap = { sm: 'size-1.5', md: 'size-2.5' } as const;

	// Signal-aspect palette: orange = the interactive accent (the only --primary
	// touch); green/caution/stop/lunar = interlocking-signal lamp colours.
	// v1 StatusCodes map to the dataviz status scale (CSS keys use hyphens —
	// 'on_time' -> --dataviz-status-on-time), keeping every DATA mark on-scale.
	const colorMap = {
		orange: 'bg-primary',
		green: 'bg-[var(--signal-proceed)]',
		caution: 'bg-[var(--signal-caution)]',
		stop: 'bg-[var(--signal-stop)]',
		lunar: 'bg-[var(--signal-lunar)]',
		early: 'bg-dataviz-status-early',
		on_time: 'bg-dataviz-status-on-time',
		late: 'bg-dataviz-status-late',
		severe: 'bg-dataviz-status-severe',
		unknown: 'bg-dataviz-status-unknown',
	} as const;
</script>

<span
	class={cn(
		sizeMap[size],
		'inline-block shrink-0 rounded-full',
		pulse ? 'led-pulse' : '',
		ring ? 'outline outline-[3px] outline-[var(--muted)]' : '',
		colorMap[color],
		className,
	)}
	data-slot="status-dot"
	{...restProps}
>
	{#if label}<span class="sr-only">{label}</span>{/if}
</span>

<style>
	/* Visually-hidden label — readable by assistive tech, invisible on screen. */
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
