<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { SeverityCode } from '$lib/v1/schemas';
	import SeverityBar from './SeverityBar.svelte';
	import ChartTooltip from './ChartTooltip.svelte';
	import { createChartTooltip, type ChartTooltipRow } from './useChartTooltip.svelte';
	import type { ChartLegendItem } from './ChartLegend.svelte';
	import { AbsentValue } from '$lib/components/edge';
	import type { AbsenceReasonKey } from '$lib/site/absence';
	import type { Locale } from '$lib/i18n';

	export interface RankedRowProps extends WithElementRef<HTMLAttributes<HTMLDivElement>> {
		rank: number;
		title: string;
		subtitle?: string;
		severity: SeverityCode;
		colorVar?: string;
		value: number | null;
		domain?: readonly [number, number];
		unit?: string;
		showRank?: boolean;
		display?: string | null;
		absentReason?: AbsenceReasonKey;
		locale?: Locale;
		absentParams?: Readonly<Record<string, string | number>>;
		delta?: number | null;
		deltaDisplay?: string;
		higherIsBetter?: boolean;
		onSelect?: () => void;
		bare?: boolean;
		tooltip?: boolean;
		tooltipRows?: ChartLegendItem[];
		barInteractive?: boolean;
		class?: string;
	}

	let {
		rank,
		title,
		subtitle,
		severity,
		colorVar,
		value,
		domain,
		unit,
		showRank = true,
		display,
		absentReason,
		locale,
		absentParams,
		delta = null,
		deltaDisplay,
		higherIsBetter = false,
		onSelect,
		bare = false,
		tooltip = false,
		tooltipRows,
		barInteractive = false,
		class: className,
		ref = $bindable(null),
		...restProps
	}: RankedRowProps = $props();

	const hasDelta = $derived(delta != null && !Number.isNaN(delta));
	const activeLocale = $derived(locale ?? 'en');
	const rankLabel = $derived(
		showRank
			? activeLocale === 'fr'
				? `Rang ${rank} : ${title}`
				: `Rank ${rank}: ${title}`
			: title,
	);
	const noChangeLabel = $derived(
		activeLocale === 'fr' ? 'aucune donnée de variation' : 'no change data',
	);
	const changeLabel = $derived(activeLocale === 'fr' ? 'variation' : 'change');

	const showAbsent = $derived(
		(display == null || display === '') && absentReason != null && locale != null,
	);

	const deltaGlyph = $derived(!hasDelta ? '·' : delta! > 0 ? '▲' : delta! < 0 ? '▼' : '·');

	const deltaVar = $derived.by(() => {
		if (!hasDelta || delta === 0) return 'var(--dataviz-status-unknown)';
		const isImprovement = higherIsBetter ? delta! > 0 : delta! < 0;
		return isImprovement ? 'var(--dataviz-status-on-time)' : 'var(--dataviz-severity-critical)';
	});

	const deltaText = $derived(
		!hasDelta ? '' : (deltaDisplay ?? (delta! > 0 ? `+${delta}` : `${delta}`)),
	);

	const interactive = $derived(typeof onSelect === 'function');

	const rootRole = $derived(interactive ? 'button' : bare ? undefined : 'listitem');

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

	const tip = createChartTooltip();
	const hasTooltip = $derived(tooltip && (tooltipRows?.length ?? 0) > 0);
	const tipRows = $derived<ChartTooltipRow[]>(
		(tooltipRows ?? []).map((r) => ({
			colorVar: r.colorVar,
			label: r.label,
			value: r.value ?? '',
		})),
	);
	const focusable = $derived(interactive || hasTooltip);

	function showTip() {
		if (!hasTooltip) return;
		tip.show({ xPct: 100, yPct: 50, heading: title, rows: tipRows, side: 'left' });
	}
	function hideTip() {
		tip.hide();
	}
</script>

{#snippet rowBody()}
	{#if showRank}
		<span
			class="dv-rank w-6 text-right font-mono text-small tabular-nums text-muted-foreground"
			aria-hidden="true"
		>
			{rank}
		</span>
	{:else}
		<span aria-hidden="true"></span>
	{/if}

	<div class="min-w-0">
		<div class="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
			<span class="min-w-0 break-words font-medium text-foreground">{title}</span>
			{#if showAbsent}
				<span class="min-w-0 text-right">
					<AbsentValue
						variant="row"
						reason={absentReason!}
						locale={activeLocale}
						params={absentParams}
					/>
				</span>
			{:else if display}
				<span
					class="ml-auto min-w-0 break-words text-right font-mono text-small tabular-nums text-foreground"
					>{display}</span
				>
			{/if}
		</div>
		{#if subtitle}
			<span class="block break-words text-caption text-muted-foreground">{subtitle}</span>
		{/if}
		<div class="mt-1.5">
			<SeverityBar
				{severity}
				{colorVar}
				{value}
				{domain}
				{unit}
				locale={activeLocale}
				label={rankLabel}
				size="sm"
				interactive={barInteractive && !tooltip}
			/>
		</div>
	</div>

	<span
		class="dv-delta inline-flex shrink-0 items-center gap-1 font-mono text-caption tabular-nums"
		style="color: {deltaVar};"
		role="img"
		aria-label={hasDelta ? `${changeLabel} ${deltaText}` : noChangeLabel}
	>
		<span aria-hidden="true">{deltaGlyph}</span>
		{#if hasDelta}<span aria-hidden="true">{deltaText}</span>{/if}
	</span>
{/snippet}

{#snippet rowEl()}
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		bind:this={ref}
		class={cn(
			'dv-ranked-row grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-card px-3 py-2',
			interactive &&
				'cursor-pointer transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
			!interactive &&
				hasTooltip &&
				'transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
			className,
		)}
		role={rootRole}
		tabindex={focusable ? 0 : undefined}
		onclick={interactive ? activate : undefined}
		onkeydown={interactive ? onKeydown : undefined}
		onpointerenter={hasTooltip ? showTip : undefined}
		onpointerleave={hasTooltip ? hideTip : undefined}
		onfocus={hasTooltip ? showTip : undefined}
		onblur={hasTooltip ? hideTip : undefined}
		aria-describedby={hasTooltip && tip.open ? tip.id : undefined}
		data-slot="ranked-row"
		{...restProps}
	>
		{@render rowBody()}
	</div>
{/snippet}

{#if hasTooltip}
	<ChartTooltip
		open={tip.open}
		xPct={tip.xPct}
		yPct={tip.yPct}
		heading={tip.heading}
		rows={tip.rows}
		side={tip.side}
		id={tip.id}
	>
		{@render rowEl()}
	</ChartTooltip>
{:else}
	{@render rowEl()}
{/if}
