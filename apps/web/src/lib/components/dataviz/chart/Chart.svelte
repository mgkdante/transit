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
{:else}
	<!--
		Pending branches (added as each family migrates, each gate-green + browser-verified):
		  P1.4 · trend          → LayerChart Spline + Area Wilson band (2 overlaid contexts for dual y)
		  P1.5 · magnitude-bars → LayerChart Bars/Points (Wilson-lower rank, absolute domain)
		         dot-strip      → LayerChart Points (hashJitter, never connected)
		         cycle          → LayerChart weekday small-multiples (shared y + mean rule)
		         histogram      → LayerChart Bars (signed, diverging at 0; median + p90 ref)
		         bullet         → delegate BulletKpi
		         metric         → delegate MetricDisplay / ExplainedMetricCard
		         stacked-share  → delegate StackedBar
		         heatmap        → delegate Heatmap
	-->
{/if}
