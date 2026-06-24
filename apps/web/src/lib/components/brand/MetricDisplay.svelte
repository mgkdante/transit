<!--
  MetricDisplay — big number + label stat combo (Set A).
  Brand primitive: replaces scattered metric implementations.
  Adapted from yesid.dev MetricDisplay; re-themed to transit tokens.

  Doctrine: the metric VALUE speaks the yellow wayfinding voice
  (text-accent-text = AA amber ink both modes); the label stays quiet
  (.label-metric = muted mono caption).
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';
	// Direct import (NOT the edge barrel): the barrel also pulls EdgeState, which
	// imports the browser-coupled $lib/stores — that would drag the SvelteKit client
	// runtime into pure-node consumers (e.g. dataviz → MetricDisplay in node tests).
	import AbsentValue from '$lib/components/edge/AbsentValue.svelte';
	import type { AbsenceReasonKey } from '$lib/site/absence';
	import type { Locale } from '$lib/i18n';

	export interface MetricDisplayProps extends HTMLAttributes<HTMLDivElement> {
		/**
		 * The metric value (e.g. "82%", "5 min", "1.2k"). When `null` / `undefined`
		 * / "" the tile shows the muted `emptyLabel` instead of the amber value voice
		 * — the honest no-data state, never a bare "·" and never a fabricated 0.
		 */
		value: string | null | undefined;
		/**
		 * Localized no-data label rendered (muted, quiet) when `value` is absent.
		 * When this is also empty, nothing is rendered rather than an empty amber span.
		 */
		emptyLabel?: string;
		/**
		 * Optional typed absence reason. When set (with `locale`), the empty state
		 * renders the styled honest-absence (AbsentValue: calm "unknown" tone + glyph
		 * + the WHY) instead of the plain `emptyLabel` text — the site-wide upgrade.
		 * Falls back to `emptyLabel` when no reason/locale is supplied.
		 */
		absentReason?: AbsenceReasonKey;
		/** Locale for the styled absence copy (required for `absentReason` to render). */
		locale?: Locale;
		/** Copy params interpolated into the absence WHY (e.g. { first: '06:00' }). */
		absentParams?: Readonly<Record<string, string | number>>;
		/** Primary label. */
		label: string;
		/** Optional secondary description. */
		sublabel?: string;
		/** Display size. */
		size?: 'sm' | 'md' | 'lg';
		/** Place the label below the value instead of above. */
		labelBelow?: boolean;
		class?: string;
	}

	let {
		value,
		emptyLabel,
		absentReason,
		locale,
		absentParams,
		label,
		sublabel,
		size = 'md',
		labelBelow = false,
		class: className,
		...restProps
	}: MetricDisplayProps = $props();

	const valueClass = {
		sm: 'text-subheading',
		md: 'text-heading',
		lg: 'text-title',
	} as const;

	// A value is "empty" when null/undefined/"" — the honest no-data state. The
	// amber metric-value voice speaks ONLY for a real value; absence speaks in the
	// quiet muted-mono caption voice (never --accent-text, never --primary).
	const isEmpty = $derived(value == null || value === '');
</script>

<div class={cn('flex flex-col', className)} data-slot="metric-display" {...restProps}>
	{#if !labelBelow}
		<span class="label-metric">{label}</span>
	{/if}
	{#if isEmpty}
		{#if absentReason && locale}
			<AbsentValue variant="inline" reason={absentReason} {locale} params={absentParams} />
		{:else if emptyLabel}
			<span class="metric-empty" data-slot="metric-empty">{emptyLabel}</span>
		{/if}
	{:else}
		<span
			class={cn(
				'metric-value font-heading font-extrabold leading-none text-accent-text',
				valueClass[size],
			)}>{value}</span
		>
	{/if}
	{#if labelBelow}
		<span class="mt-2 label-metric">{label}</span>
	{/if}
	{#if sublabel}
		<span class="mt-1 font-mono text-caption text-[var(--muted-foreground)]">{sublabel}</span>
	{/if}
</div>

<style>
	/* Honest no-data: a quiet muted-mono caption, never the amber metric-value
	   voice and never --primary. Smaller than the value so it reads as an absence. */
	.metric-empty {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1.2;
		color: var(--muted-foreground);
	}
</style>
