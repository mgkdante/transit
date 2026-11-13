import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFilterStore, emptyFilterState } from '#lib/filters/index.ts';
import { motionMode } from '#lib/stores/index.ts';
import MapFilterPillHarness from './__fixtures__/MapFilterPillHarness.svelte';

beforeEach(() => {
	localStorage.clear();
	motionMode.set('raw');
});

afterEach(() => {
	localStorage.clear();
});

describe('MapFilterPill', () => {
	it('keeps the global click ripple off the controls drawer', async () => {
		render(MapFilterPillHarness, {
			props: { store: createFilterStore(emptyFilterState(), () => {}), locale: 'en' },
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Controls 0' }));

		const drawer = await screen.findByTestId('map-filter-drawer');
		expect(drawer.closest('[data-ripple-exempt]')).not.toBeNull();
	});

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
		expect(dialog).toHaveAttribute('aria-modal', 'false');
		await waitFor(() => expect(screen.getByTestId('map-filter-drawer-title')).toHaveFocus());

		for (const name of ['Stop', 'Has alert Show markers with alerts', 'Late', 'Standing']) {
			await fireEvent.click(within(dialog).getByRole('checkbox', { name }));
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
		await fireEvent.click(
			within(dialog).getByRole('button', { name: 'Remove filter: 161 Van Horne' }),
		);
		await waitFor(() =>
			expect(within(dialog).getByRole('button', { name: /^Active/ })).toHaveFocus(),
		);

		await fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' }));
		expect(within(dialog).queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
		await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Done' })).toHaveFocus());
		expect(dialog).toBeInTheDocument();
	});

	it('uses Sheet dismissal for Escape and outside taps, restoring the surviving trigger', async () => {
		const store = createFilterStore(emptyFilterState());
		render(MapFilterPillHarness, { props: { store, locale: 'en' } });
		const trigger = screen.getByRole('button', { name: 'Controls 0' });

		trigger.focus();
		await fireEvent.click(trigger);
		await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
		expect(trigger).toHaveFocus();

		await fireEvent.click(trigger);
		await waitFor(() => expect(screen.getByTestId('map-filter-drawer-title')).toHaveFocus());
		// Animation-frame cleanup can leave older layers registered while this Sheet opens.
		const dialog = screen.getByRole('dialog');
		await waitFor(() => {
			const layers = Reflect.get(globalThis, 'bitsDismissableLayers') as Map<
				{ opts: { ref: { current: HTMLElement | null } } },
				unknown
			>;
			expect([...layers.keys()].some((layer) => layer.opts.ref.current === dialog)).toBe(true);
		});
		const outside = document.body;
		await fireEvent.pointerDown(outside, {
			button: 0,
			clientX: 1,
			clientY: 1,
			pointerType: 'mouse',
		});
		await fireEvent.click(outside);
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
		expect(trigger).toHaveFocus();
	});

	it('flips motion without closing the unified drawer', async () => {
		const store = createFilterStore(emptyFilterState());
		render(MapFilterPillHarness, { props: { store, locale: 'en' } });

		await fireEvent.click(screen.getByRole('button', { name: 'Controls 0' }));
		const dialog = screen.getByRole('dialog', { name: 'Controls' });
		const motionSwitch = within(dialog).getByRole('switch', {
			name: 'Estimated positions',
		});
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
});
