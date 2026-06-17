import { fireEvent, render } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFilterStore, emptyFilterState } from '$lib/filters';
import MapFilters from './MapFilters.svelte';

describe('MapFilters', () => {
	const routeFixtures = [
		{ id: '161', short: '161', long: 'Van Horne', type: 3 },
		{ id: '24', short: '24', long: 'Sherbrooke', type: 3 },
		{ id: '55', short: '55', long: 'Saint-Laurent', type: 3 },
	];
	const stopFixtures = [
		{ id: '53355', code: '53355', name: 'Van Horne / Rockland', lat: 45.52, lon: -73.62 },
	];

	it('renders status, crowding, and marker filters in one collapsible column panel', async () => {
		let pushed = '';
		const store = createFilterStore(emptyFilterState(), (search) => {
			pushed = search;
		});

		const { container, getByText, getByRole, getAllByText } = render(MapFilters, {
			props: { store, locale: 'en' },
		});

		expect(getByText('Status')).toBeTruthy();
		expect(getByText('Crowding')).toBeTruthy();
		expect(getByText('Markers')).toBeTruthy();
		expect(getAllByText('Alerts').length).toBeGreaterThan(0);
		expect(getByRole('button', { name: 'Show markers with alerts' })).not.toBeDisabled();
		expect(container.querySelectorAll('.mf-group-badge[data-icon]').length).toBeGreaterThanOrEqual(4);
		expect(container.querySelector('.map-filters')).toHaveAttribute('data-open', 'true');
		const inactiveClear = getByRole('button', { name: 'Clear' });
		expect(inactiveClear).toBeDisabled();
		expect(inactiveClear).toHaveAttribute('data-active', 'false');
		expect(inactiveClear.closest('.mf-clear-row')).toBeInTheDocument();
		expect(inactiveClear.querySelector('.mf-clear-icon')).toBeInTheDocument();
		expect(inactiveClear).toHaveTextContent('Clear');

		const stop = getByRole('button', { name: 'Stop' });
		await fireEvent.click(stop);

		expect(pushed).toBe('entity=stop');
		expect(store.entities).toEqual(['stop']);
		expect(inactiveClear).not.toBeDisabled();
		expect(inactiveClear).toHaveAttribute('data-active', 'true');

		await fireEvent.click(getByRole('button', { name: 'Filter' }));
		expect(container.querySelector('.map-filters')).toHaveAttribute('data-open', 'false');

		const rail = container.querySelector('[data-testid="map-filter-rail"]');
		expect(rail).toBeInTheDocument();
		expect(rail).not.toHaveTextContent('Status');
		expect(rail).not.toHaveTextContent('Crowding');
		expect(rail).not.toHaveTextContent('Markers');
		expect(rail).not.toHaveTextContent('Alerts');
		expect(rail?.querySelector('.mf-rail-title')).not.toBeInTheDocument();
		expect(rail?.querySelector('.mf-rail-token')).not.toBeInTheDocument();
		expect(rail?.querySelectorAll('.mf-group')).toHaveLength(4);
		expect(rail?.querySelectorAll('.mf-group-badge[data-icon]')).toHaveLength(4);
		expect(rail?.querySelectorAll('.mf-chip').length).toBeGreaterThanOrEqual(14);
		expect(container.querySelector('.mf-title')).not.toBeInTheDocument();
		const clear = getByRole('button', { name: 'Clear' });
		expect(clear).toBeInTheDocument();
		expect(clear.closest('.mf-clear-row')).toBeInTheDocument();
		expect(clear.closest('.mf-head')).not.toBeInTheDocument();
		expect(clear.querySelector('.mf-clear-icon')).toBeInTheDocument();
		expect(clear.querySelector('.mf-clear-text')).not.toBeInTheDocument();

		await fireEvent.click(getByRole('button', { name: 'Late' }));
		expect(pushed).toBe('status=late&entity=stop');
		expect(store.status).toEqual(['late']);

		await fireEvent.click(getByRole('button', { name: 'Show markers with alerts' }));
		expect(pushed).toBe('status=late&entity=stop&alert=has_alert');
		expect(store.alerts).toEqual(['has_alert']);
	});

	it('renders active route, stop, and bus picks as removable filter sections', async () => {
		let pushed = '';
		const store = createFilterStore(emptyFilterState(), (search) => {
			pushed = search;
		});
		store.addRoute('161');
		store.addStop('53355');
		store.addVehicle('40061');

		const { getByRole, queryByRole, queryByText } = render(MapFilters, {
			props: { store, locale: 'en', routes: routeFixtures, stops: stopFixtures },
		});

		expect(queryByRole('searchbox', { name: 'Search routes' })).not.toBeInTheDocument();
		expect(queryByText('Drilldown')).not.toBeInTheDocument();
		expect(getByRole('button', { name: 'Remove route 161' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		expect(getByRole('button', { name: 'Remove stop 53355' })).toHaveTextContent(
			'Van Horne / Rockland',
		);
		expect(getByRole('button', { name: 'Remove bus 40061' })).toHaveTextContent('Bus 40061');

		await fireEvent.click(getByRole('button', { name: 'Remove route 161' }));

		expect(pushed).toBe('stop=53355&vehicle=40061');
		expect([...store.routes]).toEqual([]);
		expect(queryByRole('button', { name: 'Remove route 161' })).not.toBeInTheDocument();

		await fireEvent.click(getByRole('button', { name: 'Clear' }));

		expect(pushed).toBe('');
		expect(store.isEmpty).toBe(true);
	});

	it('renders removable trip chips without the old drilldown bucket', async () => {
		let pushed = '';
		const store = createFilterStore(emptyFilterState(), (search) => {
			pushed = search;
		});
		store.addTrip('296851600');

		const { getByRole, getByText, queryByText } = render(MapFilters, {
			props: { store, locale: 'en' },
		});

		expect(queryByText('Drilldown')).not.toBeInTheDocument();
		expect(getByText('Trips')).toBeInTheDocument();
		expect(getByRole('button', { name: 'Remove trip 296851600' })).toBeInTheDocument();

		await fireEvent.click(getByRole('button', { name: 'Remove trip 296851600' }));

		expect([...store.trips]).toEqual([]);
		expect(pushed).toBe('');
	});

	it('keeps selected route pills removable when multiple routes are active', async () => {
		let pushed = '';
		const store = createFilterStore(emptyFilterState(), (search) => {
			pushed = search;
		});
		store.addRoute('161');
		store.addRoute('24');

		const { getByRole } = render(MapFilters, {
			props: { store, locale: 'en', routes: routeFixtures },
		});

		expect(getByRole('button', { name: 'Remove route 161' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		expect(getByRole('button', { name: 'Remove route 24' })).toHaveAttribute(
			'aria-pressed',
			'true',
		);

		await fireEvent.click(getByRole('button', { name: 'Remove route 161' }));

		expect(pushed).toBe('route=24');
		expect([...store.routes]).toEqual(['24']);
	});

	it('collapses by removing text without changing the panel spacing model', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapFilters.svelte'),
			'utf-8',
		);

		expect(source).not.toMatch(/\.map-filters\[data-open='false'\]\s*\{[^}]*padding:/);
		expect(source).not.toMatch(/transition:\s*[^;{}]*padding/);
		expect(source).not.toMatch(
			/\.map-filters\[data-open='false'\]\s+\.mf-(?:head|body|group|group-label|chips)\s*\{[^}]*\b(?:align-items|justify-items|justify-content):\s*center/,
		);
		expect(source).toMatch(/data-scrollable=\{bodyScrollable\}/);
		expect(source).toMatch(/\.map-filters\[data-open='false'\]\s*\{\s*width:\s*3\.7rem;\s*\}/);
		expect(source).toMatch(
			/\.map-filters\[data-open='false'\]\[data-scrollable='true'\]\s*\{\s*width:\s*4\.65rem;\s*\}/,
		);
		expect(
			Array.from(
				source.matchAll(/\.map-filters\[data-open='false'\](?:\s+\.[a-z-]+)?\s*\{/g),
				(match) => match[0].replace(/\s+/g, ' '),
			),
		).toEqual([".map-filters[data-open='false'] {", ".map-filters[data-open='false'] .mf-chip {"]);
		expect(source).toMatch(/\.mf-chip\s*\{[\s\S]*overflow:\s*hidden/);
		expect(source).toMatch(/\.mf-chip-text\s*\{[\s\S]*white-space:\s*nowrap/);
		expect(source).toMatch(/\.mf-label-text\s*\{[\s\S]*white-space:\s*nowrap/);
	});

	it('keeps desktop scrolling inside the filter card instead of the overlay wrapper', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapFilters.svelte'),
			'utf-8',
		);

		expect(source).toMatch(/\.map-filters\s*\{[\s\S]*max-height:\s*min\(72dvh,\s*calc\(100dvh - 7rem\)\)/);
		expect(source).toMatch(/\.map-filters\s*\{[\s\S]*overflow:\s*hidden/);
		expect(source).toMatch(/\.mf-body\s*\{[\s\S]*min-height:\s*0/);
		expect(source).toMatch(/\.mf-body\s*\{[\s\S]*overflow-y:\s*auto/);
		expect(source).toMatch(/\.mf-body\s*\{[\s\S]*scrollbar-gutter:\s*auto/);
		expect(source).toMatch(
			/\.map-filters\[data-scrollable='true'\]\s+\.mf-body\s*\{[\s\S]*padding-right:\s*0\.35rem/,
		);
		expect(source).toMatch(
			/\.map-filters\[data-scrollable='true'\]\s+\.mf-body\s*\{[\s\S]*scrollbar-gutter:\s*stable/,
		);
	});
});
