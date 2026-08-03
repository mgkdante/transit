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
	import { AbsentValue } from '$lib/components/edge';
	import type { AbsenceReasonKey } from '$lib/site/absence';
	import type { Locale } from '$lib/i18n';

	export interface MetricDisplayProps extends HTMLAttributes<HTMLDivElement> {
		/**
		 * The metric value (e.g. "82%", "5 min", "1.2k"). When `null` / `undefined`
		 * / "" the tile uses the typed shared absence state when one is supplied.
		 */
		value: string | null | undefined;
		/**
		 * Optional typed absence reason. When set (with `locale`), the empty state
		 * renders the shared AbsentValue chassis with the canonical short + why copy.
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

	// A value is "empty" when null/undefined/"". The amber metric-value voice speaks
	// ONLY for a real value; typed absence always uses the shared chassis.
	const isEmpty = $derived(value == null || value === '');
</script>

<div class={cn('flex flex-col', className)} data-slot="metric-display" {...restProps}>
	{#if !labelBelow}
		<span class="label-metric">{label}</span>
	{/if}
	{#if isEmpty}
		{#if absentReason && locale}
			<AbsentValue variant="inline" reason={absentReason} {locale} params={absentParams} />
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
