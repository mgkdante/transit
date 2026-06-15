<!--
  SeverityBar — a horizontal magnitude bar coloured by severity band.

  Encodes a normalized value [0,1] as bar length AND a SeverityCode as the bar
  colour. DOCTRINE: the fill is a data mark, so it draws from the dataviz
  severity scale only (var(--dataviz-severity-{critical|high|watch})) — never
  --primary/--destructive. The track is a neutral surface (muted), not a data
  colour. a11y: progressbar role with aria-valuenow + a severity label so the
  band is announced, not inferred from colour alone.
-->
<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { SeverityCode } from '$lib/v1/schemas';
	import { severityVar } from './tokens';

	export interface SeverityBarProps
		extends WithElementRef<HTMLAttributes<HTMLDivElement>> {
		/** Severity band — drives the fill colour. */
		severity: SeverityCode;
		/** Normalized magnitude in [0,1]. `null` -> empty track (no data). */
		value: number | null;
		/** Accessible label for the measured quantity (e.g. route name + metric). */
		label?: string;
		/** Bar thickness. */
		size?: 'sm' | 'md';
		class?: string;
	}

	let {
		severity,
		value,
		label,
		size = 'md',
		class: className,
		ref = $bindable(null),
		...restProps
	}: SeverityBarProps = $props();

	const pct = $derived(
		value == null || Number.isNaN(value) ? 0 : Math.min(1, Math.max(0, value)) * 100,
	);
	const hasData = $derived(value != null && !Number.isNaN(value));
	const color = $derived(severityVar(severity));
	const heightClass = { sm: 'h-1.5', md: 'h-2.5' } as const;
</script>

<div
	bind:this={ref}
	class={cn('dv-severity-track w-full overflow-hidden rounded-pill bg-muted', heightClass[size], className)}
	role="progressbar"
	aria-valuemin={0}
	aria-valuemax={100}
	aria-valuenow={hasData ? Math.round(pct) : undefined}
	aria-label={label ? `${label} — ${severity}` : severity}
	data-slot="severity-bar"
	data-severity={severity}
	{...restProps}
>
	{#if hasData}
		<div class="dv-severity-fill h-full rounded-pill" style="width: {pct}%; background: {color};"></div>
	{/if}
</div>

<style>
	.rounded-pill {
		border-radius: var(--radius-pill);
	}
	.dv-severity-fill {
		min-width: 2px;
		transition: width 240ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	@media (prefers-reduced-motion: reduce) {
		.dv-severity-fill {
			transition: none;
		}
	}
</style>
