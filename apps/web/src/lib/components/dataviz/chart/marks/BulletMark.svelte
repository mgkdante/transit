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
			xScale={scaleLinear().clamp(true)}
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
			</Tooltip.Root>
		</LcChart>
	</ChartFrame>
</figure>

<style>
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
	:global(line.dv-bullet-target) {
		stroke: var(--foreground);
		stroke-width: 2;
		stroke-dasharray: 2 2;
	}
	:global(.dv-bullet-axis .tick text) {
		fill: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: var(--text-mono);
	}
	:global(.dv-bullet-axis .axis-label),
	:global(.dv-bullet-axis text.label) {
		fill: var(--muted-foreground);
		font-size: var(--text-mono);
	}
</style>
