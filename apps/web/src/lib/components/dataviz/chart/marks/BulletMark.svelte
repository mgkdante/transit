<!--
  BulletMark — the LayerChart renderer for a `kind: 'bullet'` ChartSpec (A2, S7 P2.2).

  A KPI's scale context: a single value on a FIXED zero-based domain (the same value renders
  the same length on every route/grain/refresh — never /max), with an optional target tick.
  LENGTH/POSITION encodes the value (Cleveland-McGill top tier); the `tone` colours the value
  bar on the dataviz STATUS scale (never --primary) as a REDUNDANT cue paired with the number
  shown above it. Clear min/max axis + a hover tooltip (value · target · n). ChartFrame-gated.

  The big number itself is text (text-led, in the surrounding tile) — this mark is the
  scale-context graph beneath it. A null value renders no value bar (the tile shows the
  honest absence); the track + axis still show the scale.
-->
<script lang="ts">
	import { Chart as LcChart, Svg, Bars, Rule, Axis, Tooltip } from 'layerchart';
	import { scaleBand, scaleLinear } from 'd3-scale';
	import { cn } from '$lib/utils';
	import ChartFrame from '../ChartFrame.svelte';
	import type { BulletSpec } from '../ChartSpec';

	export interface BulletMarkProps {
		spec: BulletSpec;
		class?: string;
	}
	let { spec, class: className }: BulletMarkProps = $props();

	const xDomain = $derived<[number, number]>([spec.domain[0], spec.domain[1]]);
	const hasValue = $derived(spec.value != null);
	const tone = $derived(spec.tone ?? 'neutral');

	type Row = { label: ''; value: number };
	// The track spans the whole domain (the scale context); the value bar fills to the value.
	const trackRow = $derived<Row[]>([{ label: '', value: spec.domain[1] }]);
	const valueRow = $derived<Row[]>(hasValue ? [{ label: '', value: spec.value as number }] : []);

	const fmt = (v: number | null | undefined): string => (v == null ? '' : String(v));
	const padding = { top: 4, right: 12, bottom: 22, left: 12 };
</script>

<figure class={cn('dv-bullet m-0', className)} aria-label={spec.title} data-slot="bullet-mark">
	<ChartFrame height="2.75rem" class="dv-bullet-plot">
		<LcChart
			data={trackRow}
			x={(d: Row) => d.value}
			y={(d: Row) => d.label}
			xScale={scaleLinear()}
			{xDomain}
			yScale={scaleBand().padding(0.32)}
			yDomain={['']}
			{padding}
			tooltipContext={{ mode: 'band' }}
		>
			<Svg>
				<Axis
					placement="bottom"
					label={spec.xLabel}
					labelPlacement="middle"
					ticks={[spec.domain[0], spec.domain[1]]}
					format={(v) => `${v}`}
					class="dv-bullet-axis"
				/>
				<Bars data={trackRow} radius={2} class="dv-bullet-track" />
				{#if hasValue}
					<Bars data={valueRow} radius={2} class={`dv-bullet-value dv-bullet--${tone}`} />
				{/if}
				{#if spec.target != null}
					<Rule x={spec.target} class="dv-bullet-target" />
				{/if}
			</Svg>
			<Tooltip.Root>
				{#snippet children()}
					<Tooltip.Header>{spec.title}</Tooltip.Header>
					<Tooltip.List>
						{#if hasValue}
							<Tooltip.Item
								label={spec.xLabel ?? spec.title}
								value={`${fmt(spec.value)}${spec.unit}`}
							/>
						{/if}
						{#if spec.target != null}
							<Tooltip.Item
								label={spec.targetLabel ?? 'target'}
								value={`${spec.target}${spec.unit}`}
							/>
						{/if}
						{#if spec.n != null}<Tooltip.Item label="n" value={String(spec.n)} />{/if}
					</Tooltip.List>
				{/snippet}
			</Tooltip.Root>
		</LcChart>
	</ChartFrame>
</figure>

<style>
	/* The track is a quiet scale context; the value bar carries the tone. LayerChart puts
	   the class ON each rect, so target the rect directly (and beat the .lc-bar default). */
	:global(rect.dv-bullet-track) {
		fill: var(--muted);
		opacity: 0.55;
	}
	:global(rect.dv-bullet--neutral) {
		fill: var(--foreground);
	}
	:global(rect.dv-bullet--good) {
		fill: var(--dataviz-status-on-time);
	}
	:global(rect.dv-bullet--warn) {
		fill: var(--dataviz-status-late);
	}
	:global(rect.dv-bullet--bad) {
		fill: var(--dataviz-status-severe);
	}
	/* The target tick: a crisp contrasting line a rider reads as "the goal". */
	:global(line.dv-bullet-target) {
		stroke: var(--foreground);
		stroke-width: 2;
		stroke-dasharray: 2 2;
	}
	:global(.dv-bullet-axis .tick text) {
		fill: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: var(--text-micro);
	}
	:global(.dv-bullet-axis .axis-label),
	:global(.dv-bullet-axis text.label) {
		fill: var(--muted-foreground);
		font-size: var(--text-micro);
	}
</style>
