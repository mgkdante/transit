<script lang="ts">
	import { Button } from '@yesid/ui/button';
	import type { MapCopy } from './map.copy';

	let {
		copy: t,
		bearing,
		pitch,
		onreset,
		status = '',
	}: {
		copy: MapCopy;
		bearing: number;
		pitch: number;
		onreset: () => void;
		status?: string;
	} = $props();
	const visible = $derived(Math.abs(bearing) >= 1 || Math.abs(pitch) >= 1);
</script>

<div class="map-north" data-slot="map-north">
	<Button
		type="button"
		variant="outline"
		size="icon-tap"
		class="map-north-button"
		data-testid="map-north-button"
		aria-label={t.northControl}
		title={t.northControl}
		aria-hidden={!visible}
		tabindex={visible ? 0 : -1}
		style={`visibility: ${visible ? 'visible' : 'hidden'}`}
		onclick={onreset}
	>
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			aria-hidden="true"
			style:transform={`rotate(${-bearing}deg)`}
		>
			<path
				d="M12 3 19 21 12 17 5 21Z"
				stroke="currentColor"
				stroke-width="2"
				stroke-linejoin="round"
			/>
		</svg>
	</Button>
</div>
<span class="sr-only" role={status ? 'status' : undefined} aria-live="polite">{status}</span>

<style>
	.map-north {
		position: absolute;
		right: calc(var(--map-detail-offset, 0rem) + 1rem);
		bottom: calc(var(--map-north-clearance) - 0.75rem - 2.75rem);
		z-index: var(--z-map-overlay);
		min-width: 44px;
		min-height: 44px;
		transition: right var(--duration-normal) var(--ease-out);
	}
	.map-north :global(.map-north-button) {
		width: 44px;
		min-height: 44px;
		border-radius: var(--radius-pill);
		background: var(--card);
		box-shadow: var(--shadow-card);
	}
	@media (--desktop-max) {
		.map-north {
			right: 0.75rem;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.map-north {
			transition: none;
		}
	}
</style>
