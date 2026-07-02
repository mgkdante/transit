<!--
  MagnitudeBarsMark — the LayerChart renderer for a `kind: 'magnitude-bars'` ChartSpec
  (A13, S7). Sorted horizontal bars/lollipops, worst-on-top, on a fixed zero-based domain
  (the same value renders the same length on every route/grain/refresh). Bars split into
  per-severity `<Bars>` so each colours via a class on its rects. CLEAR AXES + MAX DATA: a
  labelled value x-axis + the row (label) y-axis + grid + a hover tooltip; clicking a row
  navigates to its drill `href` (e.g. the stop page). Honest absence is the renderer's own
  `absence` spec. ChartFrame-gated; sr-table fallback.
-->
<script lang="ts">
	import { Chart as LcChart, Svg, Bars, Axis, Grid, Tooltip } from 'layerchart';
	import { scaleBand, scaleLinear } from 'd3-scale';
	import { goto } from '$app/navigation';
	import { cn } from '$lib/utils';
	import ChartFrame from '../ChartFrame.svelte';
	import { categoryGutter } from '../axisGutter';
	import MagnitudeCiWhiskers from './MagnitudeCiWhiskers.svelte';
	import type { MagnitudeBarsSpec, MagnitudeDatum } from '../ChartSpec';
	import type { SeverityCode } from '$lib/v1/schemas';

	export interface MagnitudeBarsMarkProps {
		spec: MagnitudeBarsSpec;
		class?: string;
	}

	let { spec, class: className }: MagnitudeBarsMarkProps = $props();

	// Row labels in spec order (worst-on-top) = the band-y domain.
	const labels = $derived(spec.rows.map((r) => r.label));
	const reals = $derived(spec.rows.filter((r) => r.value != null));
	const xDomain = $derived<[number, number]>([spec.domain[0], spec.domain[1]]);

	const bySeverity = (sev: SeverityCode): MagnitudeDatum[] =>
		reals.filter((r) => (r.severity ?? 'watch') === sev);

	const xOf = (d: MagnitudeDatum) => d.value ?? 0;
	const yOf = (d: MagnitudeDatum) => d.label;

	// Grow with the row count (worst-N up to 100) so bars never crowd; the page scrolls.
	const frameHeight = $derived(`${Math.max(3, spec.rows.length) * 1.35 + 3}rem`);
	// Operator: the y-gutter is sized FROM the labels (char count × mono glyph advance), clamped —
	// long stop / street names get the room they need (up to a cap) and a plain-number axis no
	// longer wastes it. The truncation below is matched to THIS gutter, so a label is only cut where
	// it genuinely stops fitting (never a blanket 16-char cut). right:28 keeps the LAST x-tick
	// ("15" / "100") fully inside the plot instead of clipping at the edge.
	const gutter = $derived(categoryGutter(labels, { min: 96, max: 216 }));
	const padding = $derived({ top: 12, right: 28, bottom: 42, left: gutter.left });

	// The drill fires on the tooltip's band overlay (which sits ON TOP of the bars, so the
	// bars' own onclick never reaches the pointer) — LayerChart's tooltipContext.onclick
	// hands back the active row datum, so clicking anywhere on a row navigates to its stop.
	function onRowClick(_e: MouseEvent, detail: { data?: MagnitudeDatum }): void {
		const href = detail?.data?.href;
		if (href) goto(href);
	}

	const fmt = (v: number | null): string => (v == null ? '' : String(v));
	// The full name still rides the tooltip header + the sr-only table + the drill, so a
	// truncated tick is never a loss of information — only the axis label is shortened.
</script>

<figure
	class={cn('dv-barmark m-0', className)}
	aria-label={spec.title}
	data-slot="magnitude-bars-mark"
>
	<ChartFrame height={frameHeight} class="dv-barmark-plot">
		<LcChart
			data={reals}
			x={xOf}
			y={yOf}
			xScale={scaleLinear().clamp(true)}
			{xDomain}
			yScale={scaleBand().padding(0.42)}
			yDomain={labels}
			{padding}
			tooltipContext={{ mode: 'band', onclick: onRowClick }}
		>
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
					format={(l: string) => gutter.truncate(l)}
					class="dv-barmark-axis"
				/>
				<Bars data={bySeverity('watch')} radius={3} class="dv-barmark-watch" />
				<Bars data={bySeverity('high')} radius={3} class="dv-barmark-high" />
				<Bars data={bySeverity('critical')} radius={3} class="dv-barmark-critical" />
				<!-- PR-WEB-5: the 95% Wilson CI whisker per row (only the windowed severe-rate path
				     carries a meaningful, bar-scale CI). Drawn ON TOP so the line + caps read over the
				     bar; the CI was flipped onto the severe scale in the selector so it brackets the bar. -->
				{#if spec.ciLabel}
					<MagnitudeCiWhiskers rows={reals} domain={xDomain} />
				{/if}
			</Svg>
			<Tooltip.Root>
				{#snippet children({ data }: { data: MagnitudeDatum })}
					<Tooltip.Header>{data.label}</Tooltip.Header>
					<Tooltip.List>
						<Tooltip.Item
							label={spec.xLabel ?? spec.title}
							value={`${fmt(data.value)}${spec.unit}`}
						/>
						{#if spec.ciLabel && data.wilsonLo != null && data.wilsonHi != null}
							<Tooltip.Item
								label={spec.ciLabel}
								value={`${fmt(data.wilsonLo)}–${fmt(data.wilsonHi)}${spec.unit}`}
							/>
						{/if}
						{#if data.note}<Tooltip.Item label="" value={data.note} />{/if}
						{#if data.href}<Tooltip.Item label="" value="↦ open stop" />{/if}
					</Tooltip.List>
				{/snippet}
			</Tooltip.Root>
		</LcChart>
	</ChartFrame>

	<!-- AT fallback: the ranking as a table; links drill to each stop. -->
	<table class="sr-only">
		<caption>{spec.title}</caption>
		<thead>
			<tr><th scope="col">stop</th><th scope="col">{spec.unit}</th></tr>
		</thead>
		<tbody>
			{#each spec.rows as r (r.key)}
				<tr data-key={r.key}>
					<th scope="row">
						{#if r.href}<a href={r.href}>{r.label}</a>{:else}{r.label}{/if}
					</th>
					<td>
						{fmt(
							r.value,
						)}{#if spec.ciLabel && r.wilsonLo != null && r.wilsonHi != null}&nbsp;({spec.ciLabel}
							{fmt(r.wilsonLo)}–{fmt(r.wilsonHi)}){/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</figure>

<style>
	/* The tooltip's band overlay sits ON TOP of the bars and is the click target, so IT
	   carries the drill cursor (scoped to this mark so other charts' bands stay default). */
	:global([data-slot='magnitude-bars-mark'] rect.lc-tooltip-rect) {
		cursor: pointer;
	}
	/* Severity-coloured bars — LayerChart puts the class ON each rect. */
	:global(rect.dv-barmark-watch) {
		fill: var(--dataviz-severity-watch);
	}
	:global(rect.dv-barmark-high) {
		fill: var(--dataviz-severity-high);
	}
	:global(rect.dv-barmark-critical) {
		fill: var(--dataviz-severity-critical);
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
