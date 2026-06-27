<!--
  ServiceSpanMark — the LayerChart renderer for a `kind: 'service-span'` ChartSpec (P3, S7 P5).

  The day's first→last departure window as a floating bar on a FIXED 24h LayerChart axis
  [0,1440] min (the same literal axis on every route/refresh, never normalised to the data).
  ServiceSpanBar scales the endpoints via the chart context; the hour axis is a LayerChart
  Axis so the timeline wears the same face as every other mark. Below the timeline, each
  endpoint's clock + a signed punctuality reading (▼ early / ▲ late, colour + glyph, never
  hue alone) + the span-length / trip-count annotations. Honest absence handled upstream
  (the selector returns an absence spec when an endpoint can't resolve).
-->
<script lang="ts">
	import { Chart as LcChart, Svg, Axis } from 'layerchart';
	import { scaleLinear, scaleBand } from 'd3-scale';
	import { cn } from '$lib/utils';
	import ChartFrame from '../ChartFrame.svelte';
	import ServiceSpanBar from './ServiceSpanBar.svelte';
	import type { ServiceSpanSpec } from '../ChartSpec';

	export interface ServiceSpanMarkProps {
		spec: ServiceSpanSpec;
		class?: string;
	}
	let { spec, class: className }: ServiceSpanMarkProps = $props();

	const xDomain = $derived<[number, number]>([spec.domain[0], spec.domain[1]]);
	const tickMins = $derived(spec.hourTicks.map((t) => t.min));
	const tickLabel = (m: number): string => spec.hourTicks.find((t) => t.min === m)?.label ?? '';
	const gridMins = [360, 720, 1080];

	type Mark = { has: boolean; glyph: string; cls: string; text: string };
	function delayMark(v: number | null): Mark {
		const has = v != null && !Number.isNaN(v);
		const late = has && (v as number) > 0;
		const early = has && (v as number) < 0;
		return {
			has,
			glyph: !has || v === 0 ? '·' : late ? '▲' : '▼',
			cls: late ? 'dv-span-late' : 'dv-span-on-time',
			text: !has ? '' : (v as number) > 0 ? `+${v} min` : `${v} min`,
		};
	}
	const firstMark = $derived(delayMark(spec.firstDelayMin));
	const lastMark = $derived(delayMark(spec.lastDelayMin));

	const padding = { top: 4, right: 8, bottom: 22, left: 8 };
</script>

<figure
	class={cn('dv-span-mark m-0', className)}
	aria-label={spec.title}
	data-slot="service-span-timeline"
>
	<ChartFrame height="3rem" class="dv-span-plot">
		<LcChart
			data={[{ k: '' }]}
			x={() => 0}
			xScale={scaleLinear()}
			{xDomain}
			y={() => ''}
			yScale={scaleBand()}
			yDomain={['']}
			{padding}
		>
			<Svg>
				<Axis
					placement="bottom"
					ticks={tickMins}
					format={(m: number) => tickLabel(m)}
					rule={false}
					class="dv-span-axis"
				/>
				<ServiceSpanBar
					firstMin={spec.firstMin}
					lastMin={spec.lastMin}
					{gridMins}
					title={spec.title}
				/>
			</Svg>
		</LcChart>
	</ChartFrame>

	<!-- Endpoint clocks + their signed punctuality readings, below the track. -->
	<div class="dv-span-ends">
		<div class="dv-span-end" data-end="first">
			<span class="dv-span-end-label">{spec.firstLabel}</span>
			<span class="dv-span-end-clock">{spec.firstClock}</span>
			<span
				class="dv-span-delay {firstMark.cls}"
				data-slot="span-delay"
				data-end="first"
				aria-label={firstMark.has
					? `${spec.firstDelayLabel}: ${firstMark.text}`
					: `${spec.firstDelayLabel}: no data`}
			>
				<span class="dv-span-glyph" aria-hidden="true">{firstMark.glyph}</span>
				<span class="dv-span-delay-text">{firstMark.text}</span>
			</span>
		</div>
		<div class="dv-span-end dv-span-end--last" data-end="last">
			<span class="dv-span-end-label">{spec.lastLabel}</span>
			<span class="dv-span-end-clock">{spec.lastClock}</span>
			<span
				class="dv-span-delay {lastMark.cls}"
				data-slot="span-delay"
				data-end="last"
				aria-label={lastMark.has
					? `${spec.lastDelayLabel}: ${lastMark.text}`
					: `${spec.lastDelayLabel}: no data`}
			>
				<span class="dv-span-glyph" aria-hidden="true">{lastMark.glyph}</span>
				<span class="dv-span-delay-text">{lastMark.text}</span>
			</span>
		</div>
	</div>

	<!-- Span length + trip-count annotations (honest: omitted when absent). -->
	{#if spec.spanLabel || spec.tripsLabel}
		<div class="dv-span-annot">
			{#if spec.spanLabel}<span class="dv-span-annot-item" data-slot="span-length"
					>{spec.spanLabel}</span
				>{/if}
			{#if spec.tripsLabel}<span class="dv-span-annot-item" data-slot="span-trips"
					>{spec.tripsLabel}</span
				>{/if}
		</div>
	{/if}
</figure>

<style>
	.dv-span-mark {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	:global(line.dv-span-grid) {
		stroke: var(--border);
		stroke-width: 0.75;
		stroke-dasharray: 2 3;
	}
	:global(line.dv-span-track) {
		stroke: var(--border);
		stroke-width: 1;
	}
	:global(rect.dv-span-bar) {
		fill: var(--dataviz-status-on-time);
	}
	:global(circle.dv-span-dot) {
		fill: var(--dataviz-status-on-time);
	}
	:global(.dv-span-axis .tick text) {
		fill: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: var(--text-micro);
	}
	.dv-span-ends {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
	}
	.dv-span-end {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}
	.dv-span-end--last {
		align-items: flex-end;
		text-align: end;
	}
	.dv-span-end-label {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.dv-span-end-clock {
		font-family: var(--font-mono);
		font-size: var(--text-body);
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
	}
	.dv-span-delay {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	.dv-span-end--last .dv-span-delay {
		flex-direction: row-reverse;
	}
	.dv-span-glyph {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1;
	}
	.dv-span-on-time .dv-span-glyph {
		color: var(--dataviz-status-on-time);
	}
	.dv-span-late .dv-span-glyph {
		color: var(--dataviz-status-late);
	}
	.dv-span-delay-text {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
	}
	.dv-span-annot {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
	}
	.dv-span-annot-item {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
	}
</style>
