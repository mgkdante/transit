import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile } from 'svelte/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
	departureCount: null,
	alerts: null,
};

const happyWindow = window as typeof window & {
	happyDOM: { setInnerWidth(widthPx: number): void };
};

function installViewportMatchMedia(widthPx: number): void {
	happyWindow.happyDOM.setInnerWidth(widthPx);
	expect(window.matchMedia('(max-width: 1023.98px)').matches).toBe(widthPx < 1024);
	expect(window.matchMedia('(min-width: 1024px)').matches).toBe(widthPx >= 1024);
}

function installCompiledCss(...paths: string[]): HTMLStyleElement {
	const style = document.createElement('style');
	style.dataset.m6c2TestCss = '';
	style.textContent = paths
		.map(
			(path) =>
				compile(readFileSync(resolve(process.cwd(), path), 'utf8'), {
					filename: path,
					generate: 'client',
					css: 'external',
				}).css?.code ?? '',
		)
		.join('\n');
	document.head.append(style);
	return style;
}

beforeEach(() => {
	localStorage.clear();
	motionMode.set('raw');
	happyWindow.happyDOM.setInnerWidth(1280);
});

afterEach(() => {
	localStorage.clear();
	document.head.querySelectorAll('[data-m6c2-test-css]').forEach((style) => style.remove());
	vi.restoreAllMocks();
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

	it('suppresses the hover peek while near-me is open and restores it after close', async () => {
		const store = createFilterStore(emptyFilterState());
		const { container } = render(MapOverlayChromeHarness, {
			props: { store, locale: 'en', isDesktop: true, hoverPeek: stopPeek },
		});

		expect(container.querySelector('.map-peek')).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Stops near me' }));
		expect(container.querySelector('.map-peek')).not.toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Stops near me' }));
		expect(container.querySelector('.map-peek')).toBeInTheDocument();
	});

	it('reads a near-me-published vertical clearance without moving its right-column anchor', async () => {
		const store = createFilterStore(emptyFilterState());
		const { container } = render(MapOverlayChromeHarness, {
			props: { store, locale: 'en', isDesktop: true, hoverPeek: stopPeek },
		});

		await waitFor(() =>
			expect(container.style.getPropertyValue('--map-near-clearance')).not.toBe(''),
		);
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapOverlayChrome.svelte'),
			'utf8',
		);
		const peekRule = source.match(/\.map-peek\s*\{[\s\S]*?\n\t\}/)?.[0] ?? '';
		expect(peekRule).toContain('bottom: var(--map-near-clearance, 8.6rem)');
		expect(peekRule).toContain('right: calc(var(--map-detail-offset, 0rem) + 1rem)');
	});

	it('fits the right-anchored peek between Controls and every frozen detail width', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapOverlayChrome.svelte'),
			'utf8',
		);
		const peekRule = source.match(/\.map-peek\s*\{[\s\S]*?\n\t\}/)?.[0] ?? '';
		const peekContentRule =
			source.match(/\.map-peek\s+:global\(\.map-hover-peek\)\s*\{[\s\S]*?\n\t\}/)?.[0] ?? '';

		const maxWidth = peekRule.match(/max-width:\s*([\s\S]*?);/)?.[1].replace(/\s+/g, '');
		expect(maxWidth).toBe(
			'min(20rem,calc(100%-var(--map-detail-offset,0rem)-var(--app-left-rail-offset,0rem)-18rem))',
		);
		expect(peekContentRule).toContain('min-width: 0');

		for (const viewportWidth of [1024, 1280, 1440]) {
			for (const detailWidth of [59.2, 300, 360, 560]) {
				const controlsRight = 16 + 256;
				const peekRight = viewportWidth - detailWidth - 16;
				const peekWidth = Math.min(320, viewportWidth - detailWidth - 288);
				expect(peekWidth).toBeGreaterThan(0);
				expect(peekRight - peekWidth).toBeGreaterThanOrEqual(controlsRight);
				expect(peekRight).toBeLessThanOrEqual(viewportWidth);
			}
		}
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

	it('keeps motion labels id-free across the dual Controls surfaces', async () => {
		const store = createFilterStore(emptyFilterState());
		const { container, rerender } = render(MapOverlayChromeHarness, {
			props: { store, locale: 'en', isDesktop: true },
		});

		expect(document.querySelectorAll('#map-motion-label')).toHaveLength(0);
		await fireEvent.click(screen.getByRole('button', { name: 'Controls 0' }));
		expect(screen.getByRole('dialog', { name: 'Controls' })).toBeInTheDocument();
		expect(document.querySelectorAll('#map-motion-label')).toHaveLength(0);

		await rerender({ store, locale: 'en', isDesktop: false });
		expect(container.querySelector('.map-filter-panel')).toBeInTheDocument();
		expect(document.querySelectorAll('#map-motion-label')).toHaveLength(0);
	});

	// M6f-2 F14 RECEIPT (DOM contract, not geometry). Under the harness stale
	// controller the Controls peel stays PRESENT, OPENABLE, and an already-open
	// drawer STAYS open. RED before the fix: every one of the four suppression
	// sites removed the peel from the DOM and moved focus to near-me.
	it.each([768, 769, 1023])(
		'keeps the Controls peel present, open and openable through a %dpx global stall',
		async (widthPx) => {
			installViewportMatchMedia(widthPx);
			installCompiledCss(
				'src/lib/features/map/MapFilterPill.svelte',
				'src/lib/features/map/MapFeedStallBanner.svelte',
			);
			const store = createFilterStore(emptyFilterState());
			const view = render(MapOverlayChromeHarness, {
				props: { store, locale: 'en', isDesktop: false, isStale: false },
			});
			view.container.style.setProperty('--map-mobile-control-bottom', '84px');
			view.container.style.setProperty('--chrome-offset', '16px');
			const stableRegion = screen.getByRole('status');

			await fireEvent.click(screen.getByRole('button', { name: 'Controls 0' }));
			expect(screen.getByRole('dialog', { name: 'Controls' })).toBeInTheDocument();

			await view.rerender({ store, locale: 'en', isDesktop: false, isStale: true });
			// Guard the graft: assert the stall was actually REACHED, so a healthy
			// feed can never deliver a silent pass.
			expect(screen.getByRole('status')).toBe(stableRegion);
			expect(stableRegion).toHaveAttribute('data-state', 'global-stall');
			expect(stableRegion).toHaveClass('map-feed-stall');
			expect(stableRegion.textContent?.trim()).toMatch(/Live feed not responding/);

			// The drawer stays open, the peel stays in the DOM and visible, and
			// focus is NOT taken away from the user.
			expect(screen.getByRole('dialog', { name: 'Controls' })).toBeInTheDocument();
			const pill = screen.getByTestId('map-filter-pill');
			expect(getComputedStyle(pill).display).not.toBe('none');
			expect(screen.getByRole('button', { name: 'Stops near me' })).not.toHaveFocus();

			// And it is still OPERABLE while stalled: close, then re-open.
			await fireEvent.click(screen.getByTestId('map-filter-done'));
			await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
			await fireEvent.click(screen.getByRole('button', { name: 'Controls 0' }));
			expect(screen.getByRole('dialog', { name: 'Controls' })).toBeInTheDocument();

			// The banner vacates the peel's anchor and stacks ABOVE the control row.
			expect(getComputedStyle(stableRegion).top).toBe('auto');
			expect(getComputedStyle(stableRegion).bottom).toBe('calc(84px + 44px + 10px)');
			expect(getComputedStyle(stableRegion).right).toBe('12px');

			await view.rerender({ store, locale: 'en', isDesktop: false, isStale: false });
			expect(screen.getByTestId('map-filter-pill')).toBeInTheDocument();
			expect(screen.getByRole('status')).toBe(stableRegion);
			expect(stableRegion).toHaveAttribute('data-state', 'idle');
		},
	);

	// The peel's touch target is declared in CSS, so this is a SOURCE contract —
	// the real ≥44px measurement is the browser lane's, not jsdom's.
	it('declares a 44px minimum touch target on the Controls peel trigger', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapFilterPill.svelte'),
			'utf-8',
		);
		expect(source).toMatch(
			/\.map-filter-pill-container :global\(\.map-filter-pill\)\s*\{[\s\S]*min-height:\s*44px/,
		);
	});

	it('keeps the banner in its top-centre row at 1024px with the real complementary query keys', async () => {
		installViewportMatchMedia(1024);
		const store = createFilterStore(emptyFilterState());
		const view = render(MapOverlayChromeHarness, {
			props: { store, locale: 'en', isDesktop: false, isStale: false },
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Controls 0' }));
		expect(screen.getByRole('dialog', { name: 'Controls' })).toBeInTheDocument();

		await view.rerender({ store, locale: 'en', isDesktop: false, isStale: true });
		installCompiledCss(
			'src/lib/features/map/MapFilterPill.svelte',
			'src/lib/features/map/MapFeedStallBanner.svelte',
		);
		view.container.style.setProperty('--map-mobile-control-bottom', '84px');
		view.container.style.setProperty('--chrome-offset', '16px');
		expect(screen.getByRole('dialog', { name: 'Controls' })).toBeInTheDocument();
		const pill = screen.getByTestId('map-filter-pill');
		expect(pill).toBeInTheDocument();
		expect(getComputedStyle(pill).display).toBe('none');
		const banner = screen.getByRole('status');
		expect(banner).toHaveAttribute('data-state', 'global-stall');
		expect(banner).toHaveClass('map-feed-stall');
		expect(getComputedStyle(banner).top).not.toBe('auto');
		expect(getComputedStyle(banner).bottom).not.toBe('84px');
		expect(getComputedStyle(banner).right).toBe('0px');
	});

	it.each([
		{
			widthPx: 1023,
			isStale: false,
			failure: null,
			state: 'idle',
			placement: 'head',
			readout: null,
		},
		{
			widthPx: 1023,
			isStale: true,
			failure: null,
			state: 'global-stall',
			placement: 'head',
			readout: 'not responding',
		},
		{
			widthPx: 1023,
			isStale: true,
			failure: 'Vehicle positions unavailable',
			state: 'selected-family-failure',
			placement: 'head',
			readout: null,
		},
		{
			widthPx: 1024,
			isStale: false,
			failure: null,
			state: 'idle',
			placement: 'floating',
			readout: null,
		},
		{
			widthPx: 1024,
			isStale: true,
			failure: null,
			state: 'global-stall',
			placement: 'floating',
			readout: 'not responding',
		},
		{
			widthPx: 1024,
			isStale: true,
			failure: 'Vehicle positions unavailable',
			state: 'selected-family-failure',
			placement: 'floating',
			readout: null,
		},
	] as const)(
		'resolves the freshness/banner matrix at $widthPx for $state',
		({ widthPx, isStale, failure, state, placement, readout }) => {
			installViewportMatchMedia(widthPx);
			installCompiledCss(
				'src/lib/features/map/MapFreshness.svelte',
				'src/lib/features/map/MapFeedStallBanner.svelte',
			);
			const store = createFilterStore(emptyFilterState());
			const { container } = render(MapOverlayChromeHarness, {
				props: {
					store,
					locale: 'en',
					isDesktop: widthPx >= 1024,
					isStale,
					selectedFamilyFailureMessage: failure,
				},
			});
			container.style.setProperty('--map-mobile-control-bottom', '84px');
			container.style.setProperty('--chrome-offset', '16px');
			const owner = container.querySelector<HTMLElement>('[data-slot="map-freshness-owner"]');
			const banner = screen.getByRole('status');

			expect(screen.getByRole('status')).toHaveAttribute('data-state', state);
			expect(owner).toHaveAttribute('data-active-placement', placement);
			expect(owner).toHaveAttribute('data-not-responding', readout ? 'true' : 'false');
			// M6f-2 F14: the readout SURVIVES every state at every viewport. It used
			// to be destroyed outright under a stall — at 1024 as well as at 1023 —
			// because the owner nulled both timestamps.
			expect(container.querySelectorAll('[data-placement]')).toHaveLength(2);
			const active = container.querySelector<HTMLElement>(`[data-placement="${placement}"]`)!;
			const inactivePlacement = placement === 'head' ? 'floating' : 'head';
			const inactive = container.querySelector<HTMLElement>(
				`[data-placement="${inactivePlacement}"]`,
			)!;
			expect(getComputedStyle(active).display).not.toBe('none');
			expect(getComputedStyle(inactive).display).toBe('none');
			// "Instead of 'one minute ago', it will say 'not responding'."
			expect(active.getAttribute('data-not-responding')).toBe(readout ? 'true' : null);
			const age = active.querySelector('.freshness-stamp-age')!;
			if (readout) {
				expect(age).toHaveTextContent(readout);
				// The stall swaps the AGE, it does not destroy the ANCHOR: the
				// machine-readable last-update timestamp survives for AT and scrapers.
				expect(age).toHaveAttribute('datetime', '2026-06-15T00:00:00Z');
			} else {
				expect(age).not.toHaveTextContent('not responding');
				expect(age.textContent).toMatch(/\d/);
			}
			expect(container.querySelector('.map-feed-stall') != null).toBe(state === 'global-stall');
			if (state === 'global-stall' && widthPx < 1024) {
				expect(getComputedStyle(banner).top).toBe('auto');
				expect(getComputedStyle(banner).bottom).toBe('calc(84px + 44px + 10px)');
				expect(getComputedStyle(banner).right).toBe('12px');
			} else {
				expect(getComputedStyle(banner).top).not.toBe('auto');
				expect(getComputedStyle(banner).bottom).not.toBe('84px');
				expect(getComputedStyle(banner).right).toBe('0px');
			}
		},
	);

	it.each([768, 769, 1023, 1024])(
		'computes the compact near-me move only inside the %dpx side of the convergence',
		(widthPx) => {
			installViewportMatchMedia(widthPx);
			installCompiledCss('src/lib/features/map/MapNearMeControl.svelte');
			const store = createFilterStore(emptyFilterState());
			const { container } = render(MapOverlayChromeHarness, {
				props: { store, locale: 'en', isDesktop: widthPx >= 1024 },
			});
			const toggle = container.querySelector<HTMLElement>('.map-near-toggle')!;
			const label = toggle.querySelector<HTMLElement>('span')!;
			const computed = getComputedStyle(toggle);

			if (widthPx < 1024) {
				expect(computed.width).toBe('44px');
				expect(computed.height).toBe('44px');
				expect(computed.minHeight).toBe('44px');
				expect(computed.padding).toBe('0px');
				expect(getComputedStyle(label).display).toBe('none');
			} else {
				expect(computed.width).not.toBe('44px');
				expect(computed.height).not.toBe('44px');
				expect(computed.minHeight).toBe('44px');
				expect(getComputedStyle(label).display).not.toBe('none');
			}
		},
	);

	it('closes the portaled drawer at 1024px and hands focus to desktop Controls', async () => {
		let desktopListener: ((event: MediaQueryListEvent) => void) | undefined;
		vi.spyOn(window, 'matchMedia').mockImplementation(
			(query) =>
				({
					matches: false,
					media: query,
					onchange: null,
					addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
						if (query === '(min-width: 1024px)') {
							desktopListener = listener as (event: MediaQueryListEvent) => void;
						}
					},
					removeEventListener: () => {},
					addListener: () => {},
					removeListener: () => {},
					dispatchEvent: () => true,
				}) as MediaQueryList,
		);
		const store = createFilterStore(emptyFilterState());
		const view = render(MapOverlayChromeHarness, {
			props: { store, locale: 'en', isDesktop: false },
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Controls 0' }));
		expect(screen.getByRole('dialog', { name: 'Controls' })).toBeInTheDocument();

		await view.rerender({ store, locale: 'en', isDesktop: true });
		desktopListener?.({ matches: true, media: '(min-width: 1024px)' } as MediaQueryListEvent);

		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
		expect(screen.getByRole('button', { name: 'Collapse controls' })).toHaveFocus();
	});

	it('hands 1024px drawer focus to Expand when the desktop rail was persisted collapsed', async () => {
		localStorage.setItem('transit:controls-rail', 'true');
		let desktopListener: ((event: MediaQueryListEvent) => void) | undefined;
		vi.spyOn(window, 'matchMedia').mockImplementation(
			(query) =>
				({
					matches: false,
					media: query,
					onchange: null,
					addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
						if (query === '(min-width: 1024px)') {
							desktopListener = listener as (event: MediaQueryListEvent) => void;
						}
					},
					removeEventListener: () => {},
					addListener: () => {},
					removeListener: () => {},
					dispatchEvent: () => true,
				}) as MediaQueryList,
		);
		const store = createFilterStore(emptyFilterState());
		const view = render(MapOverlayChromeHarness, {
			props: { store, locale: 'en', isDesktop: false },
		});
		await waitFor(() =>
			expect(document.querySelector('.map-filter-panel .map-filters')).toHaveAttribute(
				'data-open',
				'false',
			),
		);

		await fireEvent.click(screen.getByRole('button', { name: 'Controls 0' }));
		await view.rerender({ store, locale: 'en', isDesktop: true });
		desktopListener?.({ matches: true, media: '(min-width: 1024px)' } as MediaQueryListEvent);

		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
		expect(screen.getByRole('button', { name: 'Expand controls' })).toHaveFocus();
	});

	it('keeps Controls present when a selected-family failure outranks aggregate staleness', () => {
		installViewportMatchMedia(1023);
		const store = createFilterStore(emptyFilterState());
		render(MapOverlayChromeHarness, {
			props: {
				store,
				locale: 'en',
				isDesktop: false,
				isStale: true,
				selectedFamilyFailureMessage: 'Vehicle positions unavailable',
			},
		});

		expect(screen.getByTestId('map-filter-pill')).toBeInTheDocument();
		expect(screen.getByRole('status')).toHaveAttribute('data-state', 'selected-family-failure');
	});
});
