<script lang="ts">
	import { Chart as LcChart, Svg, Tooltip } from 'layerchart';
	import { scaleLinear, scaleBand } from 'd3-scale';
	import { cn } from '$lib/utils';
	import ChartFrame from '../ChartFrame.svelte';
	import StackedShareBar, { type ShareSeg } from './StackedShareBar.svelte';
	import { occupancyVar, statusVar } from '$lib/components/dataviz/tokens';
	import type { StackedShareSpec } from '../ChartSpec';
	import type { OccupancyCode, StatusCode } from '$lib/v1/schemas';

	export interface StackedShareMarkProps {
		spec: StackedShareSpec;
		class?: string;
	}
	let { spec, class: className }: StackedShareMarkProps = $props();

	const fillFor = (seg: StackedShareSpec['segments'][number]): string => {
		if (spec.scale === 'occupancy' && seg.occupancy)
			return occupancyVar(seg.occupancy as OccupancyCode);
		if (spec.scale === 'status' && seg.status) return statusVar(seg.status as StatusCode);
		return 'var(--muted)';
	};

	const segs = $derived.by<ShareSeg[]>(() => {
		let offset = 0;
		return spec.segments.map((s) => {
			const start = offset;
			offset += s.share;
			return {
				key: s.key,
				label: s.label,
				share: s.share,
				start,
				end: offset,
				fill: fillFor(s),
				href: s.href,
			};
		});
	});

	const frameHeight = $derived(
		spec.size === 'sm' ? '0.5rem' : spec.size === 'md' ? '0.625rem' : '0.875rem',
	);

	const round = (v: number): number => Math.round(v);
	const summary = $derived(spec.segments.map((s) => `${s.label} ${round(s.share)}%`).join(', '));
</script>

<figure
	class={cn('dv-share-mark m-0', className)}
	aria-label={`${spec.title}: ${summary}`}
	data-slot="stacked-share-mark"
>
	<ChartFrame height={frameHeight} class="dv-share-plot">
		<LcChart
			data={segs}
			x={(d: ShareSeg) => d.start}
			xScale={scaleLinear()}
			xDomain={[0, 100]}
			y={() => ''}
			yScale={scaleBand()}
			yDomain={['']}
			padding={{ top: 0, right: 0, bottom: 0, left: 0 }}
			tooltipContext={{ mode: 'band' }}
		>
			<Svg>
				<StackedShareBar segments={segs} />
			</Svg>
			<Tooltip.Root>
				<Tooltip.Header>{spec.title}</Tooltip.Header>
				<Tooltip.List>
					{#each segs as s (s.key)}
						<Tooltip.Item label={s.label} value={`${round(s.share)}%`} color={s.fill} />
					{/each}
				</Tooltip.List>
			</Tooltip.Root>
		</LcChart>
	</ChartFrame>

	{#if spec.legend && segs.length > 0}
		<ul
			class="dv-legend-list mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-caption text-muted-foreground"
		>
			{#each segs as s (s.key + '-leg')}
				<li class="inline-flex items-center gap-1.5">
					<span
						class="dv-legend-swatch inline-block size-2"
						style="background: {s.fill};"
						aria-hidden="true"
					></span>
					<span class="text-foreground">{s.label}</span>
					<span class="font-mono tabular-nums text-foreground">{round(s.share)}%</span>
				</li>
			{/each}
		</ul>
	{/if}

	<table class="sr-only">
		<caption>{spec.title}</caption>
		<tbody>
			{#each spec.segments as s (s.key)}
				<tr><th scope="row">{s.label}</th><td>{round(s.share)}%</td></tr>
			{/each}
		</tbody>
	</table>
</figure>

<style>
	:global(rect.dv-share-seg) {
		stroke: var(--card);
		stroke-width: 1;
	}

	.dv-legend-swatch {
		border-radius: var(--radius-sm);
	}
</style>
