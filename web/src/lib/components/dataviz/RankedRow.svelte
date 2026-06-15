<!--
  RankedRow — one row of a ranked list: rank + title + severity bar + delta.

  Used for "worst offenders" / hotspot lists. The magnitude bar is a SeverityBar
  (dataviz severity scale only). The delta chip shows movement vs a prior period
  with a glyph (▲/▼/—) so direction is never colour-only; its colour is encoded
  on the dataviz scale (worse = severity-critical token, better = on-time green
  token, flat = unknown token). NEVER --primary for any data mark.

  a11y: a list-item with explicit rank + value + delta text; the SeverityBar
  carries its own progressbar semantics. Interactive rows expose a button-ish
  role only when `onSelect` is provided.
-->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { SeverityCode } from '$lib/v1/schemas';
	import SeverityBar from './SeverityBar.svelte';

	export interface RankedRowProps
		extends WithElementRef<HTMLAttributes<HTMLDivElement>> {
		/** 1-based rank. */
		rank: number;
		/** Row title (route/stop name — already localized). */
		title: string;
		/** Optional secondary line (e.g. route id, branch). */
		subtitle?: string;
		/** Severity band — drives the bar fill. */
		severity: SeverityCode;
		/** Normalized magnitude in [0,1] for the bar. `null` -> no-data bar. */
		value: number | null;
		/** Display value text (e.g. "12.4 min", "84%"). */
		display?: string;
		/**
		 * Delta vs prior period. Sign drives the glyph + colour. `null` = no
		 * comparison available (renders an em-dash, neutral).
		 */
		delta?: number | null;
		/** Formatted delta text (e.g. "+2.1"). Falls back to the raw number. */
		deltaDisplay?: string;
		/**
		 * Whether a positive delta is GOOD (improvement). For delay/severity lists
		 * a rising value is bad (default false). For on-time % a rise is good.
		 */
		higherIsBetter?: boolean;
		/** Make the row activatable (keyboard + click). */
		onSelect?: () => void;
		class?: string;
	}

	let {
		rank,
		title,
		subtitle,
		severity,
		value,
		display,
		delta = null,
		deltaDisplay,
		higherIsBetter = false,
		onSelect,
		class: className,
		ref = $bindable(null),
		...restProps
	}: RankedRowProps = $props();

	const hasDelta = $derived(delta != null && !Number.isNaN(delta));

	// Direction glyph — never colour-only.
	const deltaGlyph = $derived(!hasDelta ? '—' : delta! > 0 ? '▲' : delta! < 0 ? '▼' : '—');

	// Delta colour on the dataviz scale: improvement = on-time green token,
	// regression = severity-critical token, flat / no-data = unknown token.
	const deltaVar = $derived.by(() => {
		if (!hasDelta || delta === 0) return 'var(--dataviz-status-unknown)';
		const isImprovement = higherIsBetter ? delta! > 0 : delta! < 0;
		return isImprovement ? 'var(--dataviz-status-on-time)' : 'var(--dataviz-severity-critical)';
	});

	const deltaText = $derived(
		!hasDelta ? '' : (deltaDisplay ?? (delta! > 0 ? `+${delta}` : `${delta}`)),
	);

	const interactive = $derived(typeof onSelect === 'function');

	function activate() {
		onSelect?.();
	}
	function onKeydown(e: KeyboardEvent) {
		if (!interactive) return;
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onSelect?.();
		}
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- role + tabindex are correlated: interactive => button + tabindex 0, else listitem + no tabindex. The compiler cannot narrow the conditional. -->
<div
	bind:this={ref}
	class={cn(
		'dv-ranked-row grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border border-border bg-card px-3 py-2',
		interactive && 'cursor-pointer transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
		className,
	)}
	role={interactive ? 'button' : 'listitem'}
	tabindex={interactive ? 0 : undefined}
	onclick={interactive ? activate : undefined}
	onkeydown={interactive ? onKeydown : undefined}
	data-slot="ranked-row"
	{...restProps}
>
	<!-- Rank — monospace ordinal, neutral. -->
	<span class="dv-rank w-6 text-right font-mono text-small tabular-nums text-muted-foreground" aria-hidden="true">
		{rank}
	</span>

	<div class="min-w-0">
		<div class="flex items-baseline justify-between gap-2">
			<span class="truncate font-medium text-foreground">{title}</span>
			{#if display}
				<span class="shrink-0 font-mono text-small tabular-nums text-foreground">{display}</span>
			{/if}
		</div>
		{#if subtitle}
			<span class="block truncate text-caption text-muted-foreground">{subtitle}</span>
		{/if}
		<div class="mt-1.5">
			<SeverityBar {severity} {value} label={`Rank ${rank}: ${title}`} size="sm" />
		</div>
	</div>

	<!-- Delta chip: glyph + colour + text. -->
	<span
		class="dv-delta inline-flex shrink-0 items-center gap-1 font-mono text-caption tabular-nums"
		style="color: {deltaVar};"
		aria-label={hasDelta ? `change ${deltaText}` : 'no change data'}
	>
		<span aria-hidden="true">{deltaGlyph}</span>
		{#if hasDelta}<span aria-hidden="true">{deltaText}</span>{/if}
	</span>
</div>
