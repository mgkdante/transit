<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '../cn/index.js';

	export type MetroStationProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
		index: number;
		showLine?: boolean;
		pulseDelay?: number;
		roundel?: Snippet<[stationNo: string]>;
	};

	let {
		index,
		showLine = false,
		pulseDelay = 0,
		roundel,
		class: className,
		...rest
	}: MetroStationProps = $props();

	const stationNo = $derived(String(index).padStart(2, '0'));
</script>

<div data-slot="metro-station" class={cn('flex flex-col items-center', className)} {...rest}>
	<div class="station-badge-wrapper">
		<div
			data-slot="metro-station-pulse"
			class="station-pulse"
			style="animation-delay: {pulseDelay}s;"
		></div>
		{#if roundel}
			{@render roundel(stationNo)}
		{:else}
			<span class="station-number-badge" aria-hidden="true">{stationNo}</span>
		{/if}
	</div>

	{#if showLine}
		<svg
			class="metro-line-svg flex-1"
			width="3"
			viewBox="0 0 3 100"
			preserveAspectRatio="none"
			aria-hidden="true"
			data-metro-line
		>
			<line
				x1="1.5"
				y1="0"
				x2="1.5"
				y2="100"
				stroke="var(--line-amber, var(--primary))"
				stroke-width="3"
			/>
			<line
				x1="1.5"
				y1="0"
				x2="1.5"
				y2="100"
				stroke="var(--border-strong)"
				stroke-width="3"
				stroke-dasharray="1 4"
				data-metro-line-ties
			/>
		</svg>
	{/if}
</div>

<style>
	.station-badge-wrapper {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.station-pulse {
		position: absolute;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: color-mix(in srgb, var(--accent, var(--primary)) 50%, transparent);
		animation: station-ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;
	}

	.station-number-badge {
		position: relative;
		z-index: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: var(--radius-pill);
		background-color: var(--signage-bg);
		color: var(--signage-text);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		line-height: 1;
		letter-spacing: 0.02em;
		font-variant-numeric: tabular-nums;
		user-select: none;
	}

	.station-badge-wrapper :global([data-slot='badge'].station-number-badge) {
		width: 2rem;
		height: 2rem;
		font-size: 0.8125rem;
	}

	.metro-line-svg {
		display: block;
		min-height: 20px;
	}

	@keyframes station-ping {
		0% {
			transform: scale(1);
			opacity: 0.6;
		}
		75%,
		100% {
			transform: scale(2.5);
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.station-pulse {
			animation: none;
			display: none;
		}
	}
</style>
