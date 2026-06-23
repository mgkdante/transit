import { fireEvent, render, screen } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFilterStore, emptyFilterState } from '$lib/filters';
import { motionMode } from '$lib/stores';
import MapFilterPillHarness from './MapFilterPillHarness.svelte';

beforeEach(() => {
	// MapMotionControl reads the persisted motionMode store; reset to the RAW
	// default so the drawer's motion switch starts unchecked each test.
	localStorage.clear();
	motionMode.set('raw');
});

afterEach(() => {
	localStorage.clear();
});

describe('MapFilterPill', () => {
	it('opens the unified Controls drawer and reuses the shared controls snippet', async () => {
		let pushed = '';
		const store = createFilterStore(emptyFilterState(), (search) => {
			pushed = search;
		});

		render(MapFilterPillHarness, { props: { store, locale: 'en' } });

		expect(screen.queryByTestId('map-filter-drawer')).not.toBeInTheDocument();

		// The pill button reads "Controls" (the unified panel title), not "Filter".
		await fireEvent.click(screen.getByRole('button', { name: /controls 0/i }));
		const drawer = screen.getByTestId('map-filter-drawer');
		expect(drawer).toBeInTheDocument();

		// The drawer renders MapFilters in controlsMode (data-controls="true"), the
		// motion header (data-testid="map-filter-header"), and the motion switch
		// (data-testid="map-motion-switch") — all the unified Controls, inside the
		// drawer, one source of truth with the desktop overlay.
		const controls = drawer.querySelector('.map-filters');
		expect(controls).toHaveAttribute('data-controls', 'true');
		const header = drawer.querySelector('[data-testid="map-filter-header"]');
		expect(header).toBeInTheDocument();
		const motionSwitch = drawer.querySelector('[data-testid="map-motion-switch"]');
		expect(motionSwitch).toBeInTheDocument();
		// The motion switch sits inside the header at the very top of the drawer.
		expect(header!.contains(motionSwitch)).toBe(true);

		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(screen.queryByTestId('map-filter-drawer')).not.toBeInTheDocument();

		// Re-open and apply a filter from inside the drawer: it pushes to the URL
		// spine AND closes the drawer (the shared onselect wired by the pill).
		await fireEvent.click(screen.getByRole('button', { name: /controls 0/i }));
		expect(screen.getByTestId('map-filter-drawer')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
		expect(pushed).toBe('entity=stop');
		expect(store.entities).toEqual(['stop']);
		expect(screen.queryByTestId('map-filter-drawer')).not.toBeInTheDocument();
	});

	it('flips the motion mode from inside the drawer (the toggle is part of the unified controls)', async () => {
		const store = createFilterStore(emptyFilterState());

		render(MapFilterPillHarness, { props: { store, locale: 'en' } });

		await fireEvent.click(screen.getByRole('button', { name: /controls 0/i }));
		const motionSwitch = screen
			.getByTestId('map-filter-drawer')
			.querySelector<HTMLButtonElement>('[data-testid="map-motion-switch"]')!;
		expect(motionSwitch).toHaveAttribute('aria-checked', 'false');

		motionSwitch.click();
		expect(motionMode.current).toBe('smooth');
	});

	it('can be hidden while the mobile detail sheet owns the bottom edge', () => {
		const store = createFilterStore(emptyFilterState());

		render(MapFilterPillHarness, { props: { store, locale: 'en', hidden: true } });

		expect(screen.queryByTestId('map-filter-pill')).not.toBeInTheDocument();
	});

	it('keeps the floating drawer inside a phone viewport with safe bottom spacing', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapFilterPill.svelte'),
			'utf-8',
		);

		expect(source).toMatch(/bottom:\s*calc\(2\.5rem \+ env\(safe-area-inset-bottom, 0px\)\)/);
		expect(source).toMatch(/left:\s*0\.75rem/);
		expect(source).toMatch(/transform:\s*none/);
		expect(source).toMatch(/max-height:\s*min\(72dvh,\s*calc\(100dvh - 7rem\)\)/);
		expect(source).toMatch(/bottom:\s*calc\(100% \+ 10px\)/);
		expect(source).toMatch(/padding-bottom:\s*calc\(1rem \+ env\(safe-area-inset-bottom, 0px\)\)/);
	});

	it('hides the pill at the single 1024px map breakpoint (matches layout.isDesktop + the panel-hide)', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapFilterPill.svelte'),
			'utf-8',
		);

		// Unified breakpoint: the pill is gone at >= 1024px (desktop renders the left
		// Controls overlay instead). No dead 760/761 band.
		expect(source).toMatch(
			/@media \(min-width: 1024px\)[\s\S]*\.map-filter-pill-container[\s\S]*display:\s*none/,
		);
		expect(source).not.toContain('min-width: 761px');
		expect(source).not.toContain('760px');
	});
});
