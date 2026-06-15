<!--
  StatusBadge — the canonical StatusCode mark for the data-viz kit.

  Modes:
    - 'dot'    : a coloured glyph dot (compact inline marker).
    - 'pill'   : glyph + label chip (the default, list/table use).
    - 'legend' : a single legend row (glyph + label, left-aligned).

  DOCTRINE: ALWAYS glyph + colour — colour is never the sole channel. The
  colour comes from the dataviz status scale only (var(--dataviz-status-{enum
  with _->-})), never --primary/--success/--destructive. The glyph encodes the
  same band so colour-blind / monochrome readers get the signal too.
-->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { StatusCode } from '$lib/v1/schemas';
	import { STATUS_GLYPH, statusVar } from './tokens';

	export interface StatusBadgeProps extends WithElementRef<HTMLAttributes<HTMLSpanElement>> {
		/** The realtime delay band to encode. */
		status: StatusCode;
		/** Render shape. */
		mode?: 'dot' | 'pill' | 'legend';
		/**
		 * Human-readable label (resolve via resolveLabel(status, labels) upstream;
		 * we do NOT resolve here so the kit stays i18n-agnostic). Falls back to the
		 * raw status code when omitted. Shown in 'pill'/'legend'; used as the
		 * a11y label in 'dot'.
		 */
		label?: string;
		/** Visual size. */
		size?: 'sm' | 'md';
		class?: string;
	}

	let {
		status,
		mode = 'pill',
		label,
		size = 'md',
		class: className,
		ref = $bindable(null),
		...restProps
	}: StatusBadgeProps = $props();

	const glyph = $derived(STATUS_GLYPH[status]);
	const color = $derived(statusVar(status));
	const text = $derived(label ?? status);

	const sizeText = { sm: 'text-micro', md: 'text-caption' } as const;
</script>

{#if mode === 'dot'}
	<!-- Glyph-only marker: colour + glyph, with an sr-only label for a11y. -->
	<span
		bind:this={ref}
		class={cn(
			'dv-dot inline-flex shrink-0 items-center justify-center leading-none',
			sizeText[size],
			className,
		)}
		style="color: {color};"
		role="img"
		aria-label={text}
		data-slot="status-badge"
		data-status={status}
		{...restProps}
	>
		<span aria-hidden="true">{glyph}</span>
	</span>
{:else if mode === 'legend'}
	<span
		bind:this={ref}
		class={cn(
			'dv-legend inline-flex items-center gap-2 text-foreground',
			sizeText[size],
			className,
		)}
		data-slot="status-badge"
		data-status={status}
		{...restProps}
	>
		<span class="dv-glyph leading-none" style="color: {color};" aria-hidden="true">{glyph}</span>
		<span class="font-mono">{text}</span>
	</span>
{:else}
	<!-- pill -->
	<span
		bind:this={ref}
		class={cn(
			'dv-pill inline-flex items-center gap-1.5 rounded-pill border border-border bg-card px-2 py-0.5 font-mono leading-none text-foreground',
			sizeText[size],
			className,
		)}
		data-slot="status-badge"
		data-status={status}
		{...restProps}
	>
		<span class="dv-glyph leading-none" style="color: {color};" aria-hidden="true">{glyph}</span>
		<span>{text}</span>
	</span>
{/if}

<style>
	.dv-glyph,
	.dv-dot {
		/* Glyphs are small geometric marks; keep them optically centered. */
		font-variant-emoji: text;
	}
	.rounded-pill {
		border-radius: var(--radius-pill);
	}
</style>
