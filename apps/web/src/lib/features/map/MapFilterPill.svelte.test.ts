import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFilterStore, emptyFilterState } from '$lib/filters';
import { motionMode } from '$lib/stores';
import MapFilterPillHarness from './__fixtures__/MapFilterPillHarness.svelte';

beforeEach(() => {
	localStorage.clear();
	motionMode.set('raw');
});

afterEach(() => {
	localStorage.clear();
});

describe('MapFilterPill', () => {
	it('keeps four live filter mutations inside the Sheet until one Done close', async () => {
		let pushed = '';
		let writes = 0;
		const store = createFilterStore(emptyFilterState(), (search) => {
			pushed = search;
			writes += 1;
		});

		render(MapFilterPillHarness, { props: { store, locale: 'en' } });

		const trigger = screen.getByRole('button', { name: 'Controls 0' });
		expect(trigger).not.toHaveAttribute('aria-label');
		trigger.focus();
		await fireEvent.click(trigger);

		const dialog = screen.getByRole('dialog', { name: 'Controls' });
		expect(dialog).toHaveAttribute('aria-modal', 'true');
		await waitFor(() => expect(screen.getByTestId('map-filter-drawer-title')).toHaveFocus());

		for (const name of ['Stop', 'Show markers with alerts', 'Late', 'Standing']) {
			await fireEvent.click(within(dialog).getByRole('button', { name }));
			expect(screen.getByRole('dialog', { name: 'Controls' })).toBeInTheDocument();
		}

		expect(pushed).toBe('status=late&occupancy=standing&entity=stop&alert=has_alert');
		expect(store.entities).toEqual(['stop']);
		expect(store.alerts).toEqual(['has_alert']);
		expect(store.status).toEqual(['late']);
		expect(store.occupancy).toEqual(['standing']);
		expect(writes).toBe(4);

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
		expect(writes).toBe(4);
		expect(screen.getByRole('button', { name: 'Controls 4' })).toHaveFocus();
	});

	it('moves focus to the Active disclosure after removal and to Done after Clear disappears', async () => {
		const store = createFilterStore(emptyFilterState());
		store.addRoute('161');
		store.addStop('53355');

		render(MapFilterPillHarness, {
			props: {
				store,
				locale: 'en',
				routes: [{ id: '161', short: '161', long: 'Van Horne', type: 3 }],
				stops: [
					{
						id: '53355',
						code: '53355',
						name: 'Van Horne / Rockland',
						lat: 45.52,
						lon: -73.62,
					},
				],
			},
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Controls 2' }));
		const dialog = screen.getByRole('dialog', { name: 'Controls' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Remove route 161' }));
		await waitFor(() =>
			expect(within(dialog).getByRole('button', { name: /^Active/ })).toHaveFocus(),
		);

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' }));
		expect(within(dialog).queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
		await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Done' })).toHaveFocus());
		expect(dialog).toBeInTheDocument();
	});

	it('uses Sheet dismissal for Escape and the overlay, restoring the surviving trigger', async () => {
		const store = createFilterStore(emptyFilterState());
		render(MapFilterPillHarness, { props: { store, locale: 'en' } });
		const trigger = screen.getByRole('button', { name: 'Controls 0' });

		trigger.focus();
		await fireEvent.click(trigger);
		await fireEvent.keyDown(document, { key: 'Escape' });
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
		expect(trigger).toHaveFocus();

		await fireEvent.click(trigger);
		await waitFor(() => expect(screen.getByTestId('map-filter-drawer-title')).toHaveFocus());
		await waitFor(() =>
			expect(
				(Reflect.get(globalThis, 'bitsDismissableLayers') as Map<unknown, unknown>)?.size,
			).toBeGreaterThan(0),
		);
		const overlay = document.querySelector<HTMLElement>(
			'[data-slot="sheet-overlay"]:has(+ [data-m6b-controls-drawer])',
		);
		expect(overlay).toBeInTheDocument();
		await fireEvent.pointerDown(overlay!, {
			button: 0,
			clientX: 1,
			clientY: 1,
			pointerType: 'mouse',
		});
		await fireEvent.click(overlay!);
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
		expect(trigger).toHaveFocus();
	});

	it('flips motion without closing the unified drawer', async () => {
		const store = createFilterStore(emptyFilterState());
		render(MapFilterPillHarness, { props: { store, locale: 'en' } });

		await fireEvent.click(screen.getByRole('button', { name: 'Controls 0' }));
		const dialog = screen.getByRole('dialog', { name: 'Controls' });
		const motionSwitch = within(dialog).getByRole('switch', { name: 'Motion' });
		expect(motionSwitch).toHaveAttribute('aria-checked', 'false');

		await fireEvent.click(motionSwitch);
		expect(motionMode.current).toBe('smooth');
		expect(dialog).toBeInTheDocument();
	});

	it('can hide the mobile presentation while detail chrome owns the bottom edge', () => {
		const store = createFilterStore(emptyFilterState());
		render(MapFilterPillHarness, { props: { store, locale: 'en', hidden: true } });
		expect(screen.queryByTestId('map-filter-pill')).not.toBeInTheDocument();
	});

	it('pins the portaled drawer below the published nav edge without changing Sheet behavior', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapFilterPill.svelte'),
			'utf-8',
		);

		expect(source).toContain('data-m6b-controls-drawer');
		expect(source).toMatch(/left:\s*0\.75rem/);
		expect(source).toMatch(/right:\s*auto/);
		expect(source).toMatch(/--map-controls-drawer-gap:\s*10px/);
		expect(source).toMatch(
			/--map-controls-drawer-top:\s*calc\(\s*1rem\s*\+\s*env\(safe-area-inset-top,\s*0px\)\s*\+\s*var\(--pill-h\)\s*\+\s*var\(--map-controls-drawer-gap\)\s*\)/s,
		);
		expect(source).toMatch(
			/--map-controls-drawer-bottom:\s*calc\(\s*5\.25rem\s*\+\s*env\(safe-area-inset-bottom, 0px\)\s*\+\s*44px\s*\+\s*var\(--map-controls-drawer-gap\)\s*\)/s,
		);
		expect(source).toMatch(/bottom:\s*var\(--map-controls-drawer-bottom\)/);
		expect(source).toMatch(/width:\s*min\(21rem,\s*calc\(100vw - 2rem\)\)/);
		expect(source).toMatch(
			/max-height:\s*min\(\s*72dvh,\s*calc\(\s*100dvh\s*-\s*var\(--map-controls-drawer-top\)\s*-\s*var\(--map-controls-drawer-bottom\)\s*\)\s*\)/s,
		);
		expect(source).toMatch(/overflow-y:\s*auto/);
		expect(source).toMatch(/data-state='open'[\s\S]*var\(--duration-slow\)/);
		expect(source).toMatch(/data-state='closed'[\s\S]*var\(--duration-normal\)/);
		expect(source).toMatch(/prefers-reduced-motion:\s*reduce/);
		// The PRM suppression must repeat the data-state-qualified selectors: the
		// keyed open/close animation rules are (0,3,0), so an unqualified (0,2,0)
		// PRM rule is dead CSS and reduced-motion users get the full entrance/exit.
		const prmBlock = source.slice(source.indexOf('prefers-reduced-motion'));
		expect(prmBlock).toMatch(
			/\[data-m6b-controls-drawer\]\[data-slot='sheet-content'\]\[data-state='open'\]/,
		);
		expect(prmBlock).toMatch(
			/\[data-m6b-controls-drawer\]\[data-slot='sheet-content'\]\[data-state='closed'\]/,
		);
		expect(source).not.toMatch(/:global\(\[data-slot=['"]sheet-(?:content|overlay)['"]\]\)\s*[,{]/);
		expect(source).not.toContain('<svelte:window');
		expect(source).not.toContain('map-filter-drawer-backdrop');
	});

	it('keeps the pill breakpoint at 1024px and moves the stall swap to the real <1024 query', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapFilterPill.svelte'),
			'utf-8',
		);

		expect(source).toMatch(
			/@media \(min-width: 1024px\)[\s\S]*\.map-filter-pill-container[\s\S]*display:\s*none/,
		);
		expect(source).toMatch(
			/@media \(max-width: 1023\.98px\)[\s\S]*data-global-stall='true'[\s\S]*display:\s*none/,
		);
		expect(source).toContain("window.matchMedia('(max-width: 1023.98px)')");
		expect(source).not.toContain("window.matchMedia('(max-width: 768px)')");
	});
});
