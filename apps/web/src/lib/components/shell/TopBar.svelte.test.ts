import { fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import TopBar from './TopBar.svelte';

describe('TopBar search results', () => {
	it('renders selectable grouped chrome search results', async () => {
		const onresultselect = vi.fn();
		const { getByRole } = render(TopBar, {
			props: {
				locale: 'en',
				search: '161',
				searchResults: [
					{ kind: 'route', id: '161', label: '161 Van Horne', priority: 0 },
					{ kind: 'vehicle', id: '40061', label: '40061', meta: 'Route 161', priority: 20 },
					{
						kind: 'address',
						id: '45.525686,-73.594764',
						label: '5333 Avenue Casgrain, Montréal, Quebec',
						meta: 'Address',
						priority: 30,
						lat: 45.5256864,
						lon: -73.5947644,
					},
				],
				onresultselect,
			},
		});

		expect(getByRole('button', { name: 'Route 161 Van Horne' })).toHaveTextContent('Route');
		expect(getByRole('button', { name: 'Bus 40061 Route 161' })).toHaveTextContent('Bus');
		expect(
			getByRole('button', {
				name: 'Address 5333 Avenue Casgrain, Montréal, Quebec Address',
			}),
		).toHaveTextContent('Address');

		await fireEvent.click(getByRole('button', { name: 'Route 161 Van Horne' }));

		expect(onresultselect).toHaveBeenCalledWith({
			kind: 'route',
			id: '161',
			label: '161 Van Horne',
			priority: 0,
		});
	});

	it('turns browser autofill off on the chrome search inputs', async () => {
		const { container, getByRole } = render(TopBar, {
			props: { locale: 'en' },
		});

		// The chrome search is a transit query box (lines/stops/addresses), not a
		// postal-address field, so it opts OUT of browser address autofill.
		expect(getByRole('searchbox', { name: 'Search the network' })).toHaveAttribute(
			'autocomplete',
			'off',
		);

		await fireEvent.click(getByRole('button', { name: 'Open search' }));

		const mobileSearch = within(container).getByTestId('topbar-mobile-search');
		expect(
			within(mobileSearch).getByRole('searchbox', { name: 'Search the network' }),
		).toHaveAttribute('autocomplete', 'off');
	});

	it('opens a focused mobile search surface from the search icon', async () => {
		const { container, getByRole, queryByTestId } = render(TopBar, {
			props: { locale: 'en' },
		});

		expect(queryByTestId('topbar-mobile-search')).not.toBeInTheDocument();

		await fireEvent.click(getByRole('button', { name: 'Open search' }));

		const mobileSearch = within(container).getByTestId('topbar-mobile-search');
		const input = mobileSearch.querySelector<HTMLInputElement>(
			'[data-slot="topbar-mobile-search-input"]',
		);

		expect(input).toBeTruthy();
		await waitFor(() => expect(document.activeElement).toBe(input));
	});

	it('closes the mobile search surface after selecting a result', async () => {
		const onresultselect = vi.fn();
		const { getByRole, queryByTestId } = render(TopBar, {
			props: {
				locale: 'en',
				search: '161',
				searchResults: [{ kind: 'route', id: '161', label: '161 Van Horne', priority: 0 }],
				onresultselect,
			},
		});

		await fireEvent.click(getByRole('button', { name: 'Open search' }));

		const mobileSearch = within(queryByTestId('topbar-mobile-search') as HTMLElement);
		await fireEvent.click(mobileSearch.getByRole('button', { name: 'Route 161 Van Horne' }));

		expect(onresultselect).toHaveBeenCalledWith({
			kind: 'route',
			id: '161',
			label: '161 Van Horne',
			priority: 0,
		});
		expect(queryByTestId('topbar-mobile-search')).not.toBeInTheDocument();
	});

	it('closes desktop search suggestions when the user clicks outside', async () => {
		const { getByRole, queryByRole } = render(TopBar, {
			props: {
				locale: 'en',
				search: 'casgrain',
				searchResults: [
					{
						kind: 'address',
						id: 'google:casgrain',
						label: '5333 Avenue Casgrain, Montréal, Quebec',
						meta: 'Address',
						priority: 30,
					},
				],
			},
		});

		expect(
			getByRole('button', { name: 'Address 5333 Avenue Casgrain, Montréal, Quebec Address' }),
		).toBeInTheDocument();

		await fireEvent.pointerDown(document.body);

		expect(
			queryByRole('button', { name: 'Address 5333 Avenue Casgrain, Montréal, Quebec Address' }),
		).not.toBeInTheDocument();
	});

	it('scopes the search placeholder and aria-label to the line catalogue', () => {
		const { getByRole } = render(TopBar, { props: { locale: 'en', searchScope: 'route' } });
		expect(getByRole('searchbox', { name: 'Search a line' })).toHaveAttribute(
			'placeholder',
			'Search a line…',
		);
	});

	it('scopes the search placeholder and aria-label to the stop catalogue', () => {
		const { getByRole } = render(TopBar, { props: { locale: 'en', searchScope: 'stop' } });
		expect(getByRole('searchbox', { name: 'Search a stop' })).toHaveAttribute(
			'placeholder',
			'Search a stop…',
		);
	});

	it('keeps the full-network search affordance on map scope', () => {
		const { getByRole } = render(TopBar, { props: { locale: 'en', searchScope: 'map' } });
		expect(getByRole('searchbox', { name: 'Search the network' })).toHaveAttribute(
			'placeholder',
			'Search a line, stop, or address…',
		);
	});

	it('authors the FR-canonical scoped placeholder for the line catalogue', () => {
		const { getByRole } = render(TopBar, { props: { locale: 'fr', searchScope: 'route' } });
		expect(getByRole('searchbox', { name: 'Rechercher une ligne' })).toHaveAttribute(
			'placeholder',
			'Rechercher une ligne…',
		);
	});

	it('authors the FR-canonical scoped placeholder for the stop catalogue', () => {
		const { getByRole } = render(TopBar, { props: { locale: 'fr', searchScope: 'stop' } });
		expect(getByRole('searchbox', { name: 'Rechercher un arrêt' })).toHaveAttribute(
			'placeholder',
			'Rechercher un arrêt…',
		);
	});

	it('gives long address search suggestions room to wrap', () => {
		const source = readSource();

		expect(source).toContain('let searchResultsOpen = $state(true)');
		expect(source).toContain(
			'<svelte:window onkeydown={onKeydown} onpointerdown={onWindowPointerDown} />',
		);
		expect(source).toMatch(/\.topbar-search-results\s*\{[\s\S]*width:\s*min\(max\(100%, 38rem\)/);
		expect(source).toMatch(/\.topbar-search-label\s*\{[\s\S]*white-space:\s*normal/);
		expect(source).toMatch(/\.topbar-search-result\s*\{[\s\S]*align-items:\s*flex-start/);
	});

	it('opens a future mobile navigation menu with the yesid house link externalized', async () => {
		const { getByRole, queryByTestId } = render(TopBar, {
			props: { locale: 'en' },
		});

		expect(queryByTestId('topbar-mobile-menu')).not.toBeInTheDocument();

		await fireEvent.click(getByRole('button', { name: 'Open menu' }));

		const menu = queryByTestId('topbar-mobile-menu') as HTMLElement;
		expect(menu).toBeInTheDocument();
		const yesid = within(menu).getByRole('link', { name: 'yesid.' });
		expect(yesid).toHaveAttribute('href', 'https://yesid.dev');
		expect(yesid).toHaveAttribute('target', '_blank');
		expect(yesid).toHaveAttribute('rel', 'noopener noreferrer');

		await fireEvent.click(getByRole('button', { name: 'Close menu' }));
		expect(queryByTestId('topbar-mobile-menu')).not.toBeInTheDocument();
	});

	it('returns focus to the hamburger toggle when the mobile menu closes', async () => {
		const { getByRole, queryByTestId } = render(TopBar, {
			props: { locale: 'en', url: new URL('https://transit.local/map') },
		});

		const toggle = getByRole('button', { name: 'Open menu' });
		await fireEvent.click(toggle);
		expect(queryByTestId('topbar-mobile-menu')).toBeInTheDocument();

		// Escape closes the menu and parks focus back on its trigger — the menu is the
		// primary mobile /map escape, so focus must not be stranded on a removed node.
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(queryByTestId('topbar-mobile-menu')).not.toBeInTheDocument();
		expect(document.activeElement).toBe(toggle);
	});

	it('returns focus to the toggle when an Audit menu link closes the mobile menu', async () => {
		const { getByRole, queryByTestId } = render(TopBar, {
			props: { locale: 'en', url: new URL('https://transit.local/map') },
		});

		const toggle = getByRole('button', { name: 'Open menu' });
		await fireEvent.click(toggle);
		const menu = queryByTestId('topbar-mobile-menu') as HTMLElement;
		const audit = within(menu).getByRole('group', { name: 'Audit' });

		await fireEvent.click(within(audit).getByRole('link', { name: 'Hotspots' }));
		expect(queryByTestId('topbar-mobile-menu')).not.toBeInTheDocument();
		expect(document.activeElement).toBe(toggle);
	});

	it('caps the mobile menu height so a grown menu scrolls instead of clipping', () => {
		const source = readSource();
		// The menu grew (primaries + Audit group + house link); without an internal
		// cap its tail overflows the non-scrolling header on short viewports (and /map
		// locks the body), so it must scroll itself — mirroring the search-results cap.
		expect(source).toMatch(
			/\.topbar-mobile-menu\s*\{[\s\S]*max-height:\s*min\(calc\(100dvh - 5rem\), 34rem\)[\s\S]*overflow-y:\s*auto[\s\S]*overscroll-behavior:\s*contain/,
		);
	});

	it('uses a mobile-only compact navigation menu without duplicating the desktop rail', () => {
		const source = readSource();
		// The brand cluster (yesid. mark · divider · transit home) + its ≤760px
		// collapse were extracted into the shared BrandCluster.svelte primitive
		// (Wave 4 chrome de-dup). The invariants below (brand-mark present, brand-
		// mark + divider hide ≤760px, product never fully hidden) are unchanged —
		// they are now verified at their new home.
		const brand = readBrandClusterSource();

		expect(brand).toContain('class="topbar-brand-mark"');
		expect(source).toMatch(/class="tap-press topbar-menu-toggle md:hidden"/);
		expect(source).toMatch(/\.topbar-mobile-menu\s*\{[\s\S]*position:\s*absolute/);
		expect(source).toMatch(/\.topbar-mobile-menu\s*\{[\s\S]*right:\s*0\.75rem/);
		expect(source).toMatch(
			/\.topbar-mobile-menu\s*\{[\s\S]*width:\s*min\(19rem, calc\(100vw - 1\.5rem\)\)/,
		);
		expect(source).not.toContain('class="topbar-mobile-menu-content"');
		expect(source).not.toContain('class="topbar-mobile-menu-stop');
		expect(source).not.toContain('class="topbar-mobile-menu-line');
		expect(brand).toMatch(
			/@media \(max-width:\s*760px\)[\s\S]*\.topbar-brand-mark\s*\{[\s\S]*display:\s*none/,
		);
		expect(brand).toMatch(
			/@media \(max-width:\s*760px\)[\s\S]*\.topbar-divider\s*\{[\s\S]*display:\s*none/,
		);
		expect(source).not.toMatch(
			/\.topbar-mobile-menu\s*\{[\s\S]*position:\s*fixed[\s\S]*inset:\s*0/,
		);
		expect(source).toMatch(
			/\.topbar-mobile-house-wordmark\s*\{[\s\S]*display:\s*inline-flex[\s\S]*white-space:\s*nowrap/,
		);
		expect(brand).not.toMatch(
			/@media \(max-width:\s*400px\)[\s\S]*\.topbar-product\s*\{[\s\S]*display:\s*none/,
		);
		expect(source).toContain('data-slot="topbar-mobile-menu-toggle"');
	});
});

function readSource(): string {
	return readFileSync(resolve(process.cwd(), 'src/lib/components/shell/TopBar.svelte'), 'utf-8');
}

function readBrandClusterSource(): string {
	return readFileSync(
		resolve(process.cwd(), 'src/lib/components/brand/BrandCluster.svelte'),
		'utf-8',
	);
}
