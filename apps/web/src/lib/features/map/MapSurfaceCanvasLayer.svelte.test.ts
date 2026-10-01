import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import MapSurfaceCanvasLayer from './MapSurfaceCanvasLayer.svelte';

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
		expect(vignette).toHaveAttribute('aria-hidden', 'true');
		expect(stage.compareDocumentPosition(vignette) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});
});
