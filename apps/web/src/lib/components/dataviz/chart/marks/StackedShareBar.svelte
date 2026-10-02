<script lang="ts">
	import { getChartContext } from 'layerchart';

	export interface ShareSeg {
		key: string;
		label: string;
		share: number;
		start: number;
		end: number;
		fill: string;
		href?: string;
	}
	let { segments }: { segments: readonly ShareSeg[] } = $props();

	const ctx = getChartContext();
	const h = $derived((ctx.height as number) ?? 0);
	const x = (v: number): number => (ctx.xScale(v) as number) ?? 0;
	const round = (v: number): number => Math.round(v);
</script>

{#each segments as s (s.key)}
	{@const x0 = x(s.start)}
	{@const x1 = x(s.end)}
	{#if s.href}
		<a href={s.href} aria-label={`${s.label}: ${round(s.share)}%`} class="dv-share-link">
			<rect
				class="dv-share-seg"
				data-occ={s.key}
				x={x0}
				y={0}
				width={Math.max(0, x1 - x0)}
				height={h}
				fill={s.fill}
			/>
		</a>
	{:else}
		<rect
			class="dv-share-seg"
			data-occ={s.key}
			x={x0}
			y={0}
			width={Math.max(0, x1 - x0)}
			height={h}
			fill={s.fill}
		/>
	{/if}
{/each}

<style>
	/* Focus ring for keyboard-reachable band links. --ring is an interactive
	   affordance (never a data mark) — doctrine-allow: interactive. */
	.dv-share-link:focus-visible rect {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
	}
</style>
