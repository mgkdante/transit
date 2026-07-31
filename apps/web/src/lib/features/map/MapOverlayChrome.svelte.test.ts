import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFilterStore, emptyFilterState } from '$lib/filters';
import { motionMode } from '$lib/stores';
import type { StopIndexEntry } from '$lib/v1/schemas';
import type { WithDistance } from '$lib/components/map';
import type { MapHoverPeek } from './mapHoverPeek';
import { copy as MAP_COPY } from './map.copy';
import MapOverlayChromeHarness from './__fixtures__/MapOverlayChromeHarness.svelte';

const stop: StopIndexEntry = {
	id: 'stop-1',
	name: 'Sherbrooke / Saint-Denis',
	code: '52618',
	lat: 45.51,
	lon: -73.57,
};

const stopPeek: MapHoverPeek = {
	kind: 'stop',
	id: 'stop-1',
	title: 'Sherbrooke / Saint-Denis',
	nameAbsent: false,
	code: '52618',
	vehicleCount: 0,
};

beforeEach(() => {
	localStorage.clear();
	motionMode.set('raw');
});

afterEach(() => {
	localStorage.clear();
});

describe('MapOverlayChrome', () => {
	it('composes the title, near-me, the desktop Controls panel, and both freshness chips', () => {
		const store = createFilterStore(emptyFilterState());
		const { container } = render(MapOverlayChromeHarness, { props: { store, locale: 'en' } });

		// The title block (MapHeadTitle) renders the surface heading.
		expect(container.querySelector('.map-head .map-heading')).toHaveTextContent(
			MAP_COPY.en.heading,
		);
		// The near-me control is present.
		expect(container.querySelector('.map-near')).toBeInTheDocument();
		// The desktop Controls panel renders the SHARED controls snippet (MapFilters in
		// controlsMode + the motion header) — one source of truth with the mobile drawer.
		const panel = container.querySelector('.map-filter-panel')!;
		expect(panel).toBeInTheDocument();
		const filters = panel.querySelector('.map-filters');
		expect(filters).toHaveAttribute('data-controls', 'true');
		expect(panel.querySelector('[data-testid="map-filter-header"]')).toBeInTheDocument();
		// Both the head and floating freshness placements are present (one component, two
		// placements — the CSS shows the right one per breakpoint).
		expect(container.querySelector('[data-placement="head"]')).toBeInTheDocument();
		expect(container.querySelector('[data-placement="floating"]')).toBeInTheDocument();
	});

	it('uses one always-mounted region for live-edge notices', async () => {
		const store = createFilterStore(emptyFilterState());
		const { container, rerender } = render(MapOverlayChromeHarness, {
			props: { store, locale: 'en' },
		});

		// WHY(M1 #34): MapOverlayChrome no longer mounts a second live region on
		// demand. The single announcement owner stays present and empty at rest.
		const idle = container.querySelector('.map-live-edge')!;
		expect(idle).toBeInTheDocument();
		expect(idle).toHaveAttribute('data-state', 'idle');
		expect(idle.textContent?.trim()).toBe('');

		await rerender({
			store,
			locale: 'en',
			liveEdgeState: 'unavailable',
			liveEdgeMessage: MAP_COPY.en.liveUnavailable,
		});
		const edge = container.querySelector('.map-live-edge')!;
		expect(edge).toBeInTheDocument();
		expect(edge).toHaveTextContent(MAP_COPY.en.liveUnavailable);
		// It is a polite live region that states a fact (the map stays usable behind it).
		expect(edge).toHaveAttribute('role', 'status');
		expect(edge).toHaveAttribute('aria-live', 'polite');
		expect(edge).toHaveAttribute('data-state', 'unavailable');
	});

	it('renders the desktop hover peek only on desktop, and never on mobile', async () => {
		const store = createFilterStore(emptyFilterState());
		const { container, rerender } = render(MapOverlayChromeHarness, {
			props: { store, locale: 'en', isDesktop: true, hoverPeek: stopPeek },
		});

		// Desktop + a hover model → the dedicated passive peek renders.
		expect(container.querySelector('.map-peek')).toBeInTheDocument();
		expect(container.querySelector('.map-peek')).not.toHaveAttribute('aria-live');

		// Mobile (isDesktop false) → no peek even with a hover model (the LAW: the peek
		// is desktop-only; mobile drives detail through the bottom sheet instead).
		await rerender({ store, locale: 'en', isDesktop: false, hoverPeek: stopPeek });
		expect(container.querySelector('.map-peek')).not.toBeInTheDocument();
	});

	it('keeps the hover peek available even while the right detail rail is open', async () => {
		const store = createFilterStore(emptyFilterState());
		const { container } = render(MapOverlayChromeHarness, {
			props: { store, locale: 'en', isDesktop: true, detailOpen: true, hoverPeek: stopPeek },
		});

		// detailOpen does NOT suppress the peek — both can show at once on desktop.
		expect(container.querySelector('.map-peek')).toBeInTheDocument();
	});

	it('hides the mobile filter pill while the detail sheet owns the bottom edge', async () => {
		const store = createFilterStore(emptyFilterState());
		const { rerender } = render(MapOverlayChromeHarness, {
			props: { store, locale: 'en', detailOpen: false },
		});

		expect(screen.queryByTestId('map-filter-pill')).toBeInTheDocument();

		await rerender({ store, locale: 'en', detailOpen: true });
		expect(screen.queryByTestId('map-filter-pill')).not.toBeInTheDocument();
	});

	it('feeds the orchestrator nearby stops into the near-me control', async () => {
		const store = createFilterStore(emptyFilterState());
		const nearby: WithDistance<StopIndexEntry>[] = [{ ...stop, distanceM: 120 }];
		const { container } = render(MapOverlayChromeHarness, {
			props: {
				store,
				locale: 'en',
				nearMeOrigin: { lat: 45.5, lon: -73.6, label: 'Origin', precision: 'address' },
				nearbyStops: nearby,
			},
		});

		// Open the near-me panel → the resolved nearby stop the orchestrator computed
		// (nearestStops) renders as a pickable button inside the near-me surface.
		await fireEvent.click(container.querySelector('.map-near-toggle')!);
		const stopButton = await waitFor(() =>
			container.querySelector<HTMLButtonElement>('.map-near-stop'),
		);
		expect(stopButton).toBeInTheDocument();
		expect(stopButton).toHaveTextContent(stop.name);
	});
});
