import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import MapSurfaceCanvasLayer from './MapSurfaceCanvasLayer.svelte';

// The orchestrator hands its mapBody snippet (which holds the single <MapStage/>
// mount) straight through. Here we stand in a marker element so we can prove the
// ONE-MOUNT law: the canvas base layer renders exactly once, before the vignette.
const mapBody = createRawSnippet(() => ({
	render: () => `<div data-testid="map-stage-stand-in" class="map-hero-stage"></div>`,
}));

describe('MapSurfaceCanvasLayer', () => {
	it('renders the orchestrator mapBody (the GL canvas) exactly once', () => {
		const { container } = render(MapSurfaceCanvasLayer, { props: { mapBody } });

		const stages = container.querySelectorAll('[data-testid="map-stage-stand-in"]');
		expect(stages).toHaveLength(1);
	});

	it('frames the canvas with a non-interactive vignette layered OVER it (mapBody first)', () => {
		const { container } = render(MapSurfaceCanvasLayer, { props: { mapBody } });

		const stage = container.querySelector('[data-testid="map-stage-stand-in"]')!;
		const vignette = container.querySelector('.map-vignette')!;
		expect(stage).toBeInTheDocument();
		expect(vignette).toBeInTheDocument();
		// The vignette is aria-hidden decoration — it must never read to assistive tech.
		expect(vignette).toHaveAttribute('aria-hidden', 'true');
		// The mapBody (canvas base layer) precedes the vignette in DOM order, so the
		// vignette composites OVER the live canvas (z-5 over z-1).
		expect(stage.compareDocumentPosition(vignette) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});
});
