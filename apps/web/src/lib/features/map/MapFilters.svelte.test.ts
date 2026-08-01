import { fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRawSnippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFilterStore, emptyFilterState } from '$lib/filters';
import MapFilters from './MapFilters.svelte';

describe('MapFilters', () => {
	beforeEach(() => localStorage.removeItem('transit:controls-rail'));
	afterEach(() => localStorage.removeItem('transit:controls-rail'));

	const routeFixtures = [
		{ id: '161', short: '161', long: 'Van Horne', type: 3 },
		{ id: '24', short: '24', long: 'Sherbrooke', type: 3 },
		{ id: '55', short: '55', long: 'Saint-Laurent', type: 3 },
	];
	const stopFixtures = [
		{ id: '53355', code: '53355', name: 'Van Horne / Rockland', lat: 45.52, lon: -73.62 },
	];
	const statusMappings = [
		{ code: 'early', glyph: '▼', en: 'Early', fr: 'En avance' },
		{ code: 'on_time', glyph: '●', en: 'On-time', fr: 'À l’heure' },
		{ code: 'late', glyph: '▲', en: 'Late', fr: 'En retard' },
		{ code: 'severe', glyph: '◆', en: 'Severe', fr: 'Sévère' },
		{ code: 'unknown', glyph: '○', en: 'Unknown', fr: 'Inconnu' },
	] as const;
	const occupancyMappings = [
		{ code: 'empty', glyph: '▁', en: 'Empty', fr: 'Vide' },
		{ code: 'many_seats', glyph: '▃', en: 'Many seats', fr: 'Plusieurs places' },
		{ code: 'few_seats', glyph: '▅', en: 'Few seats', fr: 'Peu de places' },
		{ code: 'standing', glyph: '▇', en: 'Standing', fr: 'Debout' },
		{ code: 'full', glyph: '█', en: 'Full', fr: 'Plein' },
	] as const;

	function expectGlyphMappings(
		container: HTMLElement,
		kind: 'status' | 'crowding',
		mappings: typeof statusMappings | typeof occupancyMappings,
		locale: 'en' | 'fr',
	): void {
		const group = container.querySelector<HTMLElement>(`[data-filter-group="${kind}"]`)!;
		for (const mapping of mappings) {
			const label = mapping[locale];
			const chip = within(group).getByRole('button', { name: label });
			const glyph = chip.querySelector(
				`[data-m6d-glyph-kind="${kind}"][data-m6d-glyph-code="${mapping.code}"]`,
			);
			expect(glyph).toHaveTextContent(mapping.glyph);
			expect(glyph).toHaveAttribute('aria-hidden', 'true');
			expect(chip.querySelector('.mf-chip-text')).toHaveTextContent(label);
			expect(chip).toHaveAccessibleName(label);
		}
	}

	it('renders ordered disclosures and reopens both state mappings from the six-group glyph rail', async () => {
		let pushed = '';
		const store = createFilterStore(emptyFilterState(), (search) => {
			pushed = search;
		});

		const { container, getByText, getByRole, getAllByText, queryByRole } = render(MapFilters, {
			props: { store, locale: 'en', controlsMode: true, routes: routeFixtures },
		});

		expect(getByText('Status')).toBeTruthy();
		expect(getByText('Crowding')).toBeTruthy();
		expect(getByText('Markers')).toBeTruthy();
		expect(getAllByText('Alerts').length).toBeGreaterThan(0);
		expect(getByRole('button', { name: 'Show markers with alerts' })).not.toBeDisabled();
		expect(container.querySelectorAll('.mf-group-badge[data-icon]').length).toBeGreaterThanOrEqual(
			4,
		);
		expect(container.querySelector('.map-filters')).toHaveAttribute('data-open', 'true');
		expect(queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
		expect(
			Array.from(container.querySelectorAll('[data-filter-group]'), (group) =>
				group.getAttribute('data-filter-group'),
			),
		).toEqual(['markers', 'alerts', 'active', 'status', 'crowding']);
		for (const name of ['Markers', 'Alerts', 'Status', 'Crowding']) {
			expect(getByRole('button', { name })).toHaveAttribute('aria-expanded', 'true');
		}
		expect(getByRole('button', { name: /^Active/ })).toHaveAttribute('aria-expanded', 'false');

		const stop = getByRole('button', { name: 'Stop' });
		await fireEvent.click(stop);

		expect(pushed).toBe('entity=stop');
		expect(store.entities).toEqual(['stop']);
		expect(getByRole('button', { name: 'Clear' })).toBeInTheDocument();

		store.addRoute('161');
		await waitFor(() =>
			expect(getByRole('button', { name: /^Active/ })).toHaveAttribute('aria-expanded', 'true'),
		);

		await fireEvent.click(getByRole('button', { name: 'Collapse controls' }));
		expect(container.querySelector('.map-filters')).toHaveAttribute('data-open', 'false');
		expect(localStorage.getItem('transit:controls-rail')).toBe('true');

		const rail = container.querySelector('[data-testid="map-filter-rail"]');
		expect(rail).toBeInTheDocument();
		expect(rail?.querySelectorAll('.mf-rail-glyph')).toHaveLength(6);
		expect(rail?.querySelectorAll('.mf-chip')).toHaveLength(0);
		expect(
			Array.from(rail?.querySelectorAll('.mf-rail-abbr') ?? [], (item) => item.textContent),
		).toEqual(['Motion', 'Mark.', 'Alerts', 'Active', 'Status', 'Crowd']);
		expect(within(rail as HTMLElement).getByRole('button', { name: 'Active 1' })).toHaveTextContent(
			'1',
		);

		await fireEvent.click(within(rail as HTMLElement).getByRole('button', { name: 'Status' }));
		expect(container.querySelector('.map-filters')).toHaveAttribute('data-open', 'true');
		expect(localStorage.getItem('transit:controls-rail')).toBe('false');
		await waitFor(() => expect(getByRole('button', { name: 'Status' })).toHaveFocus());
		expectGlyphMappings(container, 'status', statusMappings, 'en');

		await fireEvent.click(getByRole('button', { name: 'Collapse controls' }));
		const crowdingRail = container.querySelector<HTMLElement>('[data-testid="map-filter-rail"]')!;
		expect(crowdingRail.querySelectorAll('.mf-chip')).toHaveLength(0);
		await fireEvent.click(within(crowdingRail).getByRole('button', { name: 'Crowding' }));
		expect(container.querySelector('.map-filters')).toHaveAttribute('data-open', 'true');
		await waitFor(() => expect(getByRole('button', { name: 'Crowding' })).toHaveFocus());
		expectGlyphMappings(container, 'crowding', occupancyMappings, 'en');
	});

	it.each([
		{ locale: 'en', collapsible: true, presentation: 'desktop' },
		{ locale: 'fr', collapsible: true, presentation: 'desktop' },
		{ locale: 'en', collapsible: false, presentation: 'drawer' },
		{ locale: 'fr', collapsible: false, presentation: 'drawer' },
	] as const)(
		'renders canonical glyphs without changing $locale $presentation chip names',
		({ locale, collapsible, presentation }) => {
			const store = createFilterStore(emptyFilterState());
			const { container } = render(MapFilters, {
				props: { store, locale, collapsible, controlsMode: true },
			});

			expect(container.querySelector('.map-filters')).toHaveAttribute(
				'data-presentation',
				presentation,
			);
			expectGlyphMappings(container, 'status', statusMappings, locale);
			expectGlyphMappings(container, 'crowding', occupancyMappings, locale);
		},
	);

	it('keeps both D3 consumers on the dataviz glyph vocabulary', () => {
		for (const relative of [
			'src/lib/features/map/MapFilters.svelte',
			'src/lib/features/map/MapSelectionDetail.svelte',
		]) {
			const source = readFileSync(resolve(process.cwd(), relative), 'utf8');
			expect(source, relative).toMatch(
				/import\s*\{[^}]*STATUS_GLYPH[^}]*occupancyGlyph[^}]*\}\s*from '\$lib\/components\/dataviz'/s,
			);
			expect(source.match(/STATUS_GLYPH\[/g), relative).toHaveLength(1);
			expect(source.match(/occupancyGlyph\(/g), relative).toHaveLength(1);
			expect(source, relative).not.toContain('OCCUPANCY_GLYPH');
			expect(source, relative).not.toMatch(/['"](?:▼|●|▲|◆|○|▁|▃|▅|▇|█|◌)['"]/);
		}
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

	it('expands the Motion glyph and focuses the full motion switch', async () => {
		const store = createFilterStore(emptyFilterState());
		const header = createRawSnippet(() => ({
			render: () =>
				'<button type="button" role="switch" aria-checked="false" aria-label="Motion" data-testid="map-motion-switch">Raw</button>',
		}));
		const { container, getByRole, getByTestId } = render(MapFilters, {
			props: { store, locale: 'en', controlsMode: true, header },
		});

		await fireEvent.click(getByRole('button', { name: 'Collapse controls' }));
		const rail = container.querySelector<HTMLElement>('[data-testid="map-filter-rail"]')!;
		await fireEvent.click(within(rail).getByRole('button', { name: 'Motion' }));

		expect(container.querySelector('.map-filters')).toHaveAttribute('data-open', 'true');
		await waitFor(() => expect(getByTestId('map-motion-switch')).toHaveFocus());
	});

	it('includes the dynamic Active count in the localized rail name', async () => {
		const store = createFilterStore(emptyFilterState());
		store.addRoute('161');
		const { container, getByRole } = render(MapFilters, {
			props: { store, locale: 'fr', controlsMode: true, routes: routeFixtures },
		});

		await fireEvent.click(getByRole('button', { name: 'Réduire les contrôles' }));
		const rail = container.querySelector<HTMLElement>('[data-testid="map-filter-rail"]')!;
		expect(within(rail).getByRole('button', { name: 'Actifs 1' })).toHaveTextContent('1');
	});

	it('counts every active filter in the header while Active counts selected IDs only', () => {
		const store = createFilterStore(emptyFilterState());
		store.addRoute('161');
		store.toggleEntity('stop');
		store.toggleStatus('late');

		const { container, getByRole } = render(MapFilters, {
			props: {
				store,
				locale: 'en',
				controlsMode: true,
				collapsible: false,
				routes: routeFixtures,
			},
		});

		expect(container.querySelector('.mf-head-count')).toHaveTextContent('3');
		expect(getByRole('button', { name: /^Active/ })).toHaveTextContent('1');
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

	it('renames the panel title to Controls in controlsMode and keeps the aria-labels in sync', () => {
		const store = createFilterStore(emptyFilterState(), () => {});

		const { container, getByRole, queryByRole } = render(MapFilters, {
			props: { store, locale: 'en', controlsMode: true },
		});

		expect(getByRole('button', { name: 'Collapse controls' })).toBeInTheDocument();
		expect(queryByRole('button', { name: 'Filter' })).not.toBeInTheDocument();
		expect(container.querySelector('.mf-title')).toHaveTextContent('Controls');
		// The panel group's accessible name follows the same swap.
		expect(container.querySelector('.map-filters')).toHaveAttribute('aria-label', 'Controls');
		expect(container.querySelector('.map-filters')).toHaveAttribute('data-controls', 'true');
	});

	it('renders the collapse icon + title above the motion header inside the controls panel', () => {
		const store = createFilterStore(emptyFilterState(), () => {});
		const header = createRawSnippet(() => ({
			render: () => `<div data-testid="motion-slot">motion</div>`,
		}));

		const { container, getByTestId } = render(MapFilters, {
			props: { store, locale: 'en', controlsMode: true, header },
		});

		const slot = getByTestId('motion-slot');
		expect(slot).toBeInTheDocument();

		const head = container.querySelector('.mf-head')!;
		const headerWrap = container.querySelector('[data-testid="map-filter-header"]')!;
		// The collapse icon + title (.mf-head) sit at the TOP, ABOVE the motion header.
		expect(
			head.compareDocumentPosition(headerWrap) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(headerWrap.contains(slot)).toBe(true);
	});

	it('keeps the Filter title and omits the header when controlsMode is off', () => {
		const store = createFilterStore(emptyFilterState(), () => {});

		const { container } = render(MapFilters, {
			props: { store, locale: 'en' },
		});

		expect(container.querySelector('.mf-title')).toHaveTextContent('Filter');
		expect(container.querySelector('.map-filters')).toHaveAttribute('data-controls', 'false');
		expect(container.querySelector('[data-testid="map-filter-header"]')).not.toBeInTheDocument();
	});

	it('uses an in-flow fixed-width content wrapper clipped by a 5.75rem shell', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapFilters.svelte'),
			'utf-8',
		);

		expect(source).toMatch(/\.map-filters\[data-open='false'\]\s*\{[^}]*width:\s*5\.75rem/);
		expect(source).toMatch(/\.mf-expanded\s*\{[^}]*width:\s*16rem[^}]*flex:\s*none/s);
		expect(source).not.toMatch(/\.mf-expanded\s*\{[^}]*position:\s*absolute/s);
		expect(source).not.toMatch(/\.mf-expanded\s*\{[^}]*max-width:\s*100%/s);
		expect(source).toMatch(/\.mf-rail-layer\s*\{[^}]*position:\s*absolute/s);
		expect(source).toMatch(
			/\.map-filters\s*\{[^}]*transition-property:\s*width[^}]*transition-duration:\s*var\(--duration-slow\)/s,
		);
		expect(source).toMatch(
			/\.map-filters\[data-open='false'\]\s*\{[^}]*transition-duration:\s*var\(--duration-normal\)/s,
		);
		const shellRule = source.match(/\.map-filters\s*\{([\s\S]*?)\}/)?.[1] ?? '';
		expect(shellRule).not.toMatch(/transition-(?:property|duration):[^;]*(?:background|border)/);
		expect(source).toContain("const STORAGE_KEY = 'transit:controls-rail'");
	});

	it('keeps desktop scrolling inside the filter card instead of the overlay wrapper', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapFilters.svelte'),
			'utf-8',
		);

		expect(source).toMatch(
			/\.map-filters\s*\{[\s\S]*max-height:\s*min\(72dvh,\s*calc\(100dvh - 7rem\)\)/,
		);
		expect(source).toMatch(/\.map-filters\s*\{[\s\S]*overflow:\s*hidden/);
		expect(source).toMatch(/\.mf-body\s*\{[\s\S]*min-height:\s*0/);
		expect(source).toMatch(/\.mf-body\s*\{[\s\S]*overflow-y:\s*auto/);
		expect(source).toMatch(/\.mf-body\s*\{[\s\S]*padding-right:\s*0\.5rem/);
		expect(source).toMatch(/\.mf-body\s*\{[\s\S]*scrollbar-gutter:\s*stable/);
		expect(source).toMatch(
			/\.map-filters\[data-presentation='drawer'\][\s\S]*\.mf-body\s*\{[^}]*overflow:\s*visible/s,
		);
		expect(source).toMatch(
			/\.map-filters\[data-presentation='drawer'\] \.mf-head\s*\{[^}]*position:\s*sticky/s,
		);
		expect(source).not.toMatch(
			/\.map-filters\[data-presentation='drawer'\] \.mf-controls\s*\{[^}]*position:\s*sticky/s,
		);
	});

	it('removes the onselect API and delegates presentation markup to the named stateless split', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapFilters.svelte'),
			'utf-8',
		);
		const lineCount = source.split('\n').length - 1;

		expect(source).not.toContain('onselect');
		expect(source).toContain("import MapFilterGroup from './MapFilterGroup.svelte'");
		expect(source).toContain("import MapFilterRail from './MapFilterRail.svelte'");
		expect(lineCount).toBeLessThan(1_000);
	});

	it('removes onselect from the complete Controls snippet death graph', () => {
		for (const relative of [
			'src/lib/features/map/MapFilters.svelte',
			'src/lib/features/map/MapFilterPill.svelte',
			'src/lib/features/map/MapOverlayChrome.svelte',
			'src/lib/features/map/__fixtures__/MapFilterPillHarness.svelte',
			'src/lib/features/map/__fixtures__/MapOverlayChromeHarness.svelte',
		]) {
			expect(readFileSync(resolve(process.cwd(), relative), 'utf-8'), relative).not.toContain(
				'onselect',
			);
		}
	});

	it('restores the persisted desktop rail state with a browser-safe localStorage key', async () => {
		localStorage.setItem('transit:controls-rail', 'true');
		const store = createFilterStore(emptyFilterState());
		const { container } = render(MapFilters, {
			props: { store, locale: 'en', controlsMode: true },
		});

		await waitFor(() =>
			expect(container.querySelector('.map-filters')).toHaveAttribute('data-open', 'false'),
		);
	});

	it('moves focus to the surviving Expand control when collapsed Clear disappears', async () => {
		const store = createFilterStore(emptyFilterState());
		store.addRoute('161');
		const { getByRole } = render(MapFilters, {
			props: { store, locale: 'en', controlsMode: true, routes: routeFixtures },
		});

		await fireEvent.click(getByRole('button', { name: 'Collapse controls' }));
		await fireEvent.click(getByRole('button', { name: 'Clear' }));

		expect(store.isEmpty).toBe(true);
		expect(getByRole('button', { name: 'Expand controls' })).toHaveFocus();
	});

	it('hands focus between the desktop Collapse and Expand controls', async () => {
		const store = createFilterStore(emptyFilterState());
		const { getByRole } = render(MapFilters, {
			props: { store, locale: 'en', controlsMode: true },
		});

		const collapse = getByRole('button', { name: 'Collapse controls' });
		collapse.focus();
		await fireEvent.click(collapse);
		await waitFor(() => expect(getByRole('button', { name: 'Expand controls' })).toHaveFocus());

		await fireEvent.click(getByRole('button', { name: 'Expand controls' }));
		await waitFor(() => expect(getByRole('button', { name: 'Collapse controls' })).toHaveFocus());
	});

	it('keeps the frozen filter controls in the hard-44 inventory while desktop chips stay compact', () => {
		const filtersSource = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapFilters.svelte'),
			'utf-8',
		);
		const groupPath = resolve(process.cwd(), 'src/lib/features/map/MapFilterGroup.svelte');
		const railPath = resolve(process.cwd(), 'src/lib/features/map/MapFilterRail.svelte');

		expect(existsSync(groupPath)).toBe(true);
		expect(existsSync(railPath)).toBe(true);
		if (!existsSync(groupPath) || !existsSync(railPath)) return;

		const groupSource = readFileSync(groupPath, 'utf-8');
		const railSource = readFileSync(railPath, 'utf-8');
		expect(filtersSource).toMatch(/\.mf-toggle\s*\{[^}]*min-height:\s*44px/s);
		expect(filtersSource).toMatch(/\.mf-clear\s*\{[^}]*min-height:\s*44px/s);
		expect(filtersSource).toMatch(
			/data-presentation='drawer'[\s\S]*\.mf-chip\s*\{[^}]*min-height:\s*44px/s,
		);
		expect(filtersSource).toMatch(/\.mf-chip\s*\{[^}]*min-height:\s*2rem/s);
		expect(groupSource).toMatch(/\.mf-group-trigger\s*\{[^}]*min-height:\s*44px/s);
		expect(railSource).toMatch(/\.mf-rail-glyph\s*\{[^}]*min-height:\s*44px/s);
	});
});
