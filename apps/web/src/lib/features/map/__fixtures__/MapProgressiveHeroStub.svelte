<script lang="ts">
	interface Failure {
		readonly kind: 'construct';
		readonly retry: () => Promise<void>;
	}

	interface Props {
		onready?: () => void;
		onidle?: () => void;
		onfailure?: (failure: Failure | null) => void;
	}

	let { onready, onidle, onfailure }: Props = $props();

	function fail(): void {
		onfailure?.({
			kind: 'construct',
			retry: async () => onfailure?.(null),
		});
	}
</script>

<div data-testid="map-progressive-hero-stub">
	<canvas
		class="maplibregl-canvas"
		data-testid="progressive-stub-map-canvas"
		tabindex="0"
		aria-label="Interactive map">Interactive map</canvas
	>
	<button type="button" data-testid="progressive-stub-ready" onclick={() => onready?.()}
		>ready</button
	>
	<button type="button" data-testid="progressive-stub-idle" onclick={() => onidle?.()}>idle</button>
	<button type="button" data-testid="progressive-stub-failure" onclick={fail}>fail</button>
</div>
