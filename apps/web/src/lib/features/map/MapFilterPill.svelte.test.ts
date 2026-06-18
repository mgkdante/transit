import { fireEvent, render, screen } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFilterStore, emptyFilterState } from '$lib/filters';
import MapFilterPill from './MapFilterPill.svelte';

describe('MapFilterPill', () => {
	it('opens a floating mobile drawer and reuses the filter spine', async () => {
		let pushed = '';
		const store = createFilterStore(emptyFilterState(), (search) => {
			pushed = search;
		});

		render(MapFilterPill, { props: { store, locale: 'en' } });

		expect(screen.queryByTestId('map-filter-drawer')).not.toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: /filter 0/i }));
		expect(screen.getByTestId('map-filter-drawer')).toBeInTheDocument();

		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(screen.queryByTestId('map-filter-drawer')).not.toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: /filter 0/i }));
		expect(screen.getByTestId('map-filter-drawer')).toBeInTheDocument();

		await fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
		expect(pushed).toBe('entity=stop');
		expect(store.entities).toEqual(['stop']);
		expect(screen.queryByTestId('map-filter-drawer')).not.toBeInTheDocument();
	});

	it('can be hidden while the mobile detail sheet owns the bottom edge', () => {
		const store = createFilterStore(emptyFilterState());

		render(MapFilterPill, { props: { store, locale: 'en', hidden: true } });

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
		expect(source).toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom, 0px\)/);
	});
});
