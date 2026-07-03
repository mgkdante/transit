<!--
  Chart — the ONE renderer for a ChartSpec.

  A selector emits a typed `ChartSpec`; this component renders it. It NEVER computes a
  scale, a threshold, a ranking, or a no-data reason — those live in the selector (Web
  Surface Doctrine: "do not bury metric definitions, no-data reasons, or ranking
  formulas in Svelte markup"). The renderer's only job is to map an already-derived spec
  onto a mark: LayerChart for the cross-view magnitude marks (always handed the spec's
  absolute domain, never auto-extent), and the existing dataviz primitive where it
  already wins (heatmap per-row, stacked-share part-to-whole, metric tile, AbsentValue).

  Branches are added per chart-family migration (S7 P1.4 trend → P1.5 the rest), so this
  file grows but its contract does not. No reliability section consumes `<Chart>` until
  those phases, so an un-migrated kind renders nothing here BY DESIGN — never a broken,
  zeroed, or auto-scaled mark.
-->
<script lang="ts">
	import AbsentValue from '$lib/components/edge/AbsentValue.svelte';
	import TrendMark from './marks/TrendMark.svelte';
	import HistogramMark from './marks/HistogramMark.svelte';
	import DotStripMark from './marks/DotStripMark.svelte';
	import MagnitudeBarsMark from './marks/MagnitudeBarsMark.svelte';
	import DumbbellMark from './marks/DumbbellMark.svelte';
	import LineMark from './marks/LineMark.svelte';
	import SparklineMark from './marks/SparklineMark.svelte';
	import BulletMark from './marks/BulletMark.svelte';
	import HeatmapMark from './marks/HeatmapMark.svelte';
	import StackedShareMark from './marks/StackedShareMark.svelte';
	import ServiceSpanMark from './marks/ServiceSpanMark.svelte';
	import type { ChartSpec } from './ChartSpec';

	export interface ChartProps {
		/** The fully-derived spec from a selector — the renderer owns no business logic. */
		spec: ChartSpec;
		class?: string;
	}

	let { spec, class: className }: ChartProps = $props();
</script>

{#if spec.kind === 'absence'}
	<AbsentValue
		reason={spec.reason}
		locale={spec.locale}
		params={spec.params}
		variant={spec.variant ?? 'block'}
		class={className}
	/>
{:else if spec.kind === 'trend'}
	<TrendMark {spec} class={className} />
{:else if spec.kind === 'histogram'}
	<HistogramMark {spec} class={className} />
{:else if spec.kind === 'dot-strip'}
	<DotStripMark {spec} class={className} />
{:else if spec.kind === 'magnitude-bars'}
	<MagnitudeBarsMark {spec} class={className} />
{:else if spec.kind === 'dumbbell'}
	<DumbbellMark {spec} class={className} />
{:else if spec.kind === 'line'}
	<LineMark {spec} class={className} />
{:else if spec.kind === 'sparkline'}
	<SparklineMark {spec} class={className} />
{:else if spec.kind === 'bullet'}
	<BulletMark {spec} class={className} />
{:else if spec.kind === 'heatmap'}
	<HeatmapMark {spec} class={className} />
{:else if spec.kind === 'stacked-share'}
	<StackedShareMark {spec} class={className} />
{:else if spec.kind === 'service-span'}
	<ServiceSpanMark {spec} class={className} />
{:else}
	<!--
		Pending branches (added as each family migrates, each gate-green + browser-verified):
		  metric → a scalar tile (no data mark) — the number IS the value voice
		  cycle  → LayerChart weekday small-multiples (shared y + mean rule)
	-->
{/if}
