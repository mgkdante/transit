<script lang="ts">
	import { getChartContext } from 'layerchart';
	import type { MagnitudeDatum } from '../ChartSpec';
	import { ciWhiskerGeometry, type LinearScale, type BandScale } from './ciWhiskerGeometry';

	export interface MagnitudeCiWhiskersProps {
		rows: readonly MagnitudeDatum[];
		domain: readonly [number, number];
	}
	let { rows, domain }: MagnitudeCiWhiskersProps = $props();

	const ctx = getChartContext();
	const CAP = 4;

	const whiskers = $derived(
		ciWhiskerGeometry(rows, ctx.xScale as LinearScale, ctx.yScale as BandScale, domain),
	);
</script>

{#each whiskers as w (w.key)}
	<g class="dv-ci-whisker" data-slot="ci-whisker" data-key={w.key} aria-hidden="true">
		<line x1={w.x0} x2={w.x1} y1={w.yc} y2={w.yc} class="dv-ci-line" />
		<line x1={w.x0} x2={w.x0} y1={w.yc - CAP} y2={w.yc + CAP} class="dv-ci-cap" />
		<line x1={w.x1} x2={w.x1} y1={w.yc - CAP} y2={w.yc + CAP} class="dv-ci-cap" />
	</g>
{/each}

<style>
	.dv-ci-line,
	.dv-ci-cap {
		stroke: var(--foreground);
		stroke-width: 1.5;
		opacity: 0.62;
		stroke-linecap: round;
	}
</style>
