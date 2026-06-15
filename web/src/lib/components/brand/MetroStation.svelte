<!--
  MetroStation — STM station roundel with a sonar ping and an amber track spine.
  Brand primitive (Set B): a backlit, theme-invariant signage chip (real signs
  don't reskin) over a station-ping pulse, optionally joined to the next station
  by a line-amber track with darker rail ties.
  Adapted from yesid.dev MetroStation; SELF-CONTAINED — the numbered chip is
  inlined here (no ui/badge import). station-ping keyframe lives in app.css.
-->
<script lang="ts">
	import { cn } from '$lib/utils';

	export interface MetroStationProps {
		/** Station index (1-based, zero-padded to 2 digits) */
		index: number;
		/** Show vertical SVG line connecting to next station */
		showLine?: boolean;
		/** Stagger delay multiplier for the ping animation (seconds) */
		pulseDelay?: number;
		/** Consumer styling */
		class?: string;
		[key: string]: unknown;
	}

	let {
		index,
		showLine = false,
		pulseDelay = 0,
		class: className,
		...rest
	}: MetroStationProps = $props();

	const stationNo = $derived(String(index).padStart(2, '0'));
</script>

<div data-slot="metro-station" class={cn('flex flex-col items-center', className)} {...rest}>
	<!-- Station roundel with sonar pulse — backlit STM station chip
	     (theme-invariant signage; real signs don't reskin). -->
	<div class="station-badge-wrapper">
		<div
			data-slot="metro-station-pulse"
			class="station-pulse"
			style="animation-delay: {pulseDelay}s;"
		></div>
		<!-- Inlined numbered chip (no ui/badge dependency). -->
		<span class="station-number-badge" aria-hidden="true">{stationNo}</span>
	</div>

	<!-- Vertical metro line connecting stations — the yellow line survives
	     daylight via --line-amber; darker dashes overlay as rail ties. -->
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

	/* Inlined numbered roundel — 32px circle, signage palette (theme-invariant). */
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
		font-size: 0.8125rem;
		font-weight: 600;
		line-height: 1;
		letter-spacing: 0.02em;
		font-variant-numeric: tabular-nums;
		user-select: none;
	}

	.metro-line-svg {
		display: block;
		min-height: 20px;
	}

	@media (prefers-reduced-motion: reduce) {
		.station-pulse {
			animation: none;
			display: none;
		}
	}
</style>
