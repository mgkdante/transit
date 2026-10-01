<script lang="ts">
	import { Chart as LcChart, Svg, Bars, Axis, Grid, Tooltip } from 'layerchart';
	import { scaleBand, scaleLinear } from 'd3-scale';
	import { goto } from '$app/navigation';
	import { cn } from '$lib/utils';
	import ChartDatumPopover from '../ChartDatumPopover.svelte';
	import ChartFrame from '../ChartFrame.svelte';
	import {
		chartDatumPopoverBoundary,
		createChartDatumPopover,
	} from '../useChartDatumPopover.svelte';
	import { categoryGutter } from '../axisGutter';
	import MagnitudeCiWhiskers from './MagnitudeCiWhiskers.svelte';
	import { activateMagnitudeRow } from './magnitudeRowActivation';
	import type { MagnitudeBarsSpec, MagnitudeDatum } from '../ChartSpec';
	import type { SeverityCode } from '$lib/v1/schemas';

	export interface MagnitudeBarsMarkProps {
		spec: MagnitudeBarsSpec;
		class?: string;
	}

	let { spec, class: className }: MagnitudeBarsMarkProps = $props();

	const labels = $derived(spec.rows.map((r) => r.label));
	const rowKeys = $derived(spec.rows.map((r) => r.key));
	const labelsByKey = $derived(new Map(spec.rows.map((r) => [r.key, r.label] as const)));
	const reals = $derived(spec.rows.filter((r) => r.value != null));
	const xDomain = $derived<[number, number]>([spec.domain[0], spec.domain[1]]);
	const hasTapPopover = $derived(spec.rows.some((r) => r.tapPopover != null));
	const hasKeyboardRows = $derived(spec.rows.some((r) => r.tapPopover != null || r.href != null));
	const hasPointerRows = $derived(
		spec.rows.some((r) => r.value != null && (r.tapPopover != null || r.href != null)),
	);
	const BAND_PADDING = 0.42;
	const MIN_POINTER_STEP_PX = 24;
	const popover = createChartDatumPopover();
	let figure = $state<HTMLElement | null>(null);
	const layerStructureKey = $derived(
		JSON.stringify([
			spec.mark,
			spec.scale,
			spec.sort,
			spec.domain,
			spec.ciLabel != null,
			hasTapPopover,
			spec.rows.map((row) => [
				row.key,
				row.label,
				row.value == null,
				row.severity ?? 'watch',
				Boolean(row.href),
				Boolean(row.tapPopover),
			]),
		]),
	);
	let lastStructureKey: string | undefined;
	$effect.pre(() => {
		const key = layerStructureKey;
		const focused = document.activeElement;
		if (lastStructureKey !== undefined && lastStructureKey !== key) {
			const ownsFocus =
				document.getElementById(popover.id)?.contains(focused) ||
				(focused?.matches('.dv-barmark-keyboard-row') && figure?.contains(focused));
			if (popover.open) popover.close(false);
			if (ownsFocus) figure?.focus({ preventScroll: true });
		}
		lastStructureKey = key;
	});

	const bySeverity = (sev: SeverityCode): MagnitudeDatum[] =>
		reals.filter((r) => (r.severity ?? 'watch') === sev);

	const xOf = (d: MagnitudeDatum) => d.value ?? 0;
	const yOf = (d: MagnitudeDatum) => d.key;

	const gutter = $derived(categoryGutter(labels, { min: 96, max: 216 }));
	const padding = $derived({ top: 12, right: 28, bottom: 42, left: gutter.left });
	const remHeight = $derived(Math.max(3, spec.rows.length) * 1.35 + 3);
	const pointerHeight = $derived(
		Math.ceil(
			(spec.rows.length + BAND_PADDING) * MIN_POINTER_STEP_PX + padding.top + padding.bottom,
		),
	);
	const frameHeight = $derived(
		hasPointerRows ? `max(${remHeight}rem, ${pointerHeight}px)` : `${remHeight}rem`,
	);

	function onRowClick(event: MouseEvent, detail: { data?: MagnitudeDatum }): void {
		const datum = detail?.data;
		if (datum) activateMagnitudeRow(event, datum, popover, goto);
	}

	function onRowButtonActivate(event: KeyboardEvent | MouseEvent, datum: MagnitudeDatum): void {
		if (event instanceof KeyboardEvent) {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
		}
		if (!(event.currentTarget instanceof SVGElement) || !datum.tapPopover) return;
		event.stopPropagation();
		popover.openFromTrigger(event.currentTarget, datum.tapPopover);
	}

	const fmt = (v: number | null): string => (v == null ? '' : String(v));
	const fmtWithUnit = (v: number | null): string => (v == null ? '' : `${fmt(v)}${spec.unit}`);
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<figure
	bind:this={figure}
	class={cn('dv-barmark m-0', className)}
	aria-label={spec.title}
	tabindex={hasKeyboardRows ? 0 : -1}
	data-slot="magnitude-bars-mark"
	use:chartDatumPopoverBoundary={popover}
>
	<ChartFrame height={frameHeight} class="dv-barmark-plot">
		{#key layerStructureKey}
			<LcChart
				data={reals}
				x={xOf}
				y={yOf}
				xScale={scaleLinear().clamp(true)}
				{xDomain}
				yScale={scaleBand().padding(BAND_PADDING)}
				yDomain={rowKeys}
				{padding}
				tooltipContext={{
					mode: 'band',
					onclick: onRowClick,
					...(hasTapPopover ? { touchEvents: 'auto' as const } : {}),
				}}
			>
				{#snippet children({ context })}
					<Svg>
						<Grid x class="dv-barmark-grid" />
						<Axis
							placement="bottom"
							label={spec.xLabel}
							labelPlacement="middle"
							ticks={4}
							format={(v) => `${v}`}
							class="dv-barmark-axis"
						/>
						<Axis
							placement="left"
							rule={false}
							format={(key: string) => gutter.truncate(labelsByKey.get(key) ?? key)}
							class="dv-barmark-axis"
						/>
						<Bars data={bySeverity('watch')} radius={3} class="dv-barmark-watch" />
						<Bars data={bySeverity('high')} radius={3} class="dv-barmark-high" />
						<Bars data={bySeverity('critical')} radius={3} class="dv-barmark-critical" />
						{#if spec.ciLabel}
							<MagnitudeCiWhiskers rows={reals} domain={xDomain} />
						{/if}
						{#each spec.rows as row (row.key)}
							{@const rowY = context.yScale(row.key) as number | undefined}
							{@const rowHeight =
								(context.yScale as { bandwidth?: () => number }).bandwidth?.() ?? 0}
							{#if Number.isFinite(rowY) && rowHeight > 0 && context.width > 0}
								{#if row.tapPopover}
									<g
										role="button"
										aria-label={row.label}
										aria-haspopup="dialog"
										aria-expanded="false"
										tabindex="0"
										class="dv-barmark-keyboard-row"
										onkeydown={(event) => onRowButtonActivate(event, row)}
										onclick={(event) => onRowButtonActivate(event, row)}
									>
										<rect x="0" y={rowY} width={context.width} height={rowHeight} />
									</g>
								{:else if row.href}
									<a href={row.href} aria-label={row.label} class="dv-barmark-keyboard-row">
										<rect x="0" y={rowY} width={context.width} height={rowHeight} />
									</a>
								{/if}
							{/if}
						{/each}
					</Svg>
					{#if !hasTapPopover || popover.showNativeTooltip}
						<Tooltip.Root>
							{#snippet children({ data }: { data: MagnitudeDatum })}
								<Tooltip.Header>{data.label}</Tooltip.Header>
								<Tooltip.List>
									<Tooltip.Item label={spec.xLabel ?? spec.title} value={fmtWithUnit(data.value)} />
									{#if spec.ciLabel && data.wilsonLo != null && data.wilsonHi != null}
										<Tooltip.Item
											label={spec.ciLabel}
											value={`${fmtWithUnit(data.wilsonLo)}–${fmtWithUnit(data.wilsonHi)}`}
										/>
									{/if}
									{#if data.note}<Tooltip.Item label="" value={data.note} />{/if}
								</Tooltip.List>
							{/snippet}
						</Tooltip.Root>
					{/if}
				{/snippet}
			</LcChart>
		{/key}
	</ChartFrame>
	<ChartDatumPopover controller={popover} />

	<table class="sr-only">
		<caption>{spec.title}</caption>
		<thead>
			<tr><th scope="col">{spec.rowLabel}</th><th scope="col">{spec.xLabel ?? spec.title}</th></tr>
		</thead>
		<tbody>
			{#each spec.rows as r (r.key)}
				<tr data-key={r.key}>
					<th scope="row">
						{#if r.href}<a href={r.href} tabindex="-1">{r.label}</a>{:else}{r.label}{/if}
					</th>
					<td>
						{fmtWithUnit(
							r.value,
						)}{#if spec.ciLabel && r.wilsonLo != null && r.wilsonHi != null}&nbsp;({spec.ciLabel}
							{fmtWithUnit(r.wilsonLo)}–{fmtWithUnit(r.wilsonHi)}){/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</figure>

<style>
	.dv-barmark:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	:global([data-slot='magnitude-bars-mark'] rect.lc-tooltip-rect) {
		cursor: pointer;
	}
	:global(rect.dv-barmark-watch) {
		fill: var(--dataviz-severity-watch);
	}
	:global(rect.dv-barmark-high) {
		fill: var(--dataviz-severity-high);
	}
	:global(rect.dv-barmark-critical) {
		fill: var(--dataviz-severity-critical);
	}
	.dv-barmark-keyboard-row rect {
		fill: transparent;
		pointer-events: none;
	}
	.dv-barmark-keyboard-row:focus-visible rect {
		stroke: var(--ring);
		stroke-width: 2;
	}
	:global(.dv-barmark-axis .tick text) {
		fill: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: var(--text-mono);
	}
	:global(.dv-barmark-axis .axis-label),
	:global(.dv-barmark-axis text.label) {
		fill: var(--muted-foreground);
		font-size: var(--text-mono);
	}
	:global(.dv-barmark-grid line) {
		stroke: var(--border);
		opacity: 0.5;
	}
</style>
