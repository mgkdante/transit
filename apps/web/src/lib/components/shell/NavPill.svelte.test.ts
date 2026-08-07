import { fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tick } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chromeSearchResults } from '$lib/search/chromeSearch';
import type { TransitModeKey } from '$lib/search/stopMode';
import type { RouteIndexEntry } from '$lib/v1/schemas';
import NavPill from './NavPill.svelte';

function readSource(): string {
	return readFileSync(resolve(process.cwd(), 'src/lib/components/shell/NavPill.svelte'), 'utf-8');
}

function baseMenuRule(source: string): string {
	return source.match(/\n\t\.nav-menu\s*\{([^}]*)\}/)?.[1] ?? '';
}

function fireTransitionEnd(element: Element, propertyName: string): Promise<boolean> {
	const event = new Event('transitionend', { bubbles: true });
	Object.defineProperty(event, 'propertyName', { value: propertyName });
	return fireEvent(element, event);
}

afterEach(() => vi.restoreAllMocks());

describe('NavPill — structure', () => {
	it('renders the floating pill with the four primary links in wayfinding order', () => {
		const { getByTestId, getByRole } = render(NavPill, {
			props: { locale: 'en', url: new URL('https://transit.local/lines') },
		});

		const pill = getByTestId('nav-pill');
		expect(pill).toBeInTheDocument();

		// Brand wordmark reads "Transit" and routes to the product home (not the
		// external house site).
		const brand = within(pill).getByRole('link', { name: /Transit/ });
		expect(brand).toHaveAttribute('href', '/');
		expect(brand).toHaveTextContent('Transit');

		// The four primaries, in order.
		expect(within(pill).getByRole('link', { name: 'Map' })).toHaveAttribute('href', '/map');
		expect(within(pill).getByRole('link', { name: 'Lines' })).toHaveAttribute('href', '/lines');
		expect(within(pill).getByRole('link', { name: 'Stops' })).toHaveAttribute('href', '/stops');
		expect(within(pill).getByRole('link', { name: 'Network' })).toHaveAttribute('href', '/network');

		// The pill is centred inside a fixed, pointer-events-none rail (viewport chrome).
		expect(getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
	});

	it('localizes the primary links + hrefs in French', () => {
		const { getByRole } = render(NavPill, {
			props: { locale: 'fr', url: new URL('https://transit.local/fr/network') },
		});
		expect(getByRole('link', { name: 'Carte' })).toHaveAttribute('href', '/fr/map');
		expect(getByRole('link', { name: 'Réseau' })).toHaveAttribute('href', '/fr/network');
		expect(getByRole('link', { name: 'Rechercher dans le réseau' })).toHaveAttribute(
			'href',
			'/fr/search',
		);
	});

	it('places compact Search between Refresh and Theme as a 44px native link', () => {
		const { getByRole } = render(NavPill, {
			props: { locale: 'en', url: new URL('https://transit.local/map') },
		});
		const search = getByRole('link', { name: 'Search the network' });
		expect(search).toHaveAttribute('href', '/search');
		expect(search).toHaveClass('nav-control', 'nav-compact-search');

		const controls = search.closest('[data-slot="nav-controls"]');
		expect(controls).not.toBeNull();
		expect(Array.from(controls!.children).indexOf(search)).toBe(1);
	});

	it('keeps a localized language route in the menu for ultra-narrow phones', async () => {
		const { getByRole, queryByTestId } = render(NavPill, {
			props: {
				locale: 'en',
				url: new URL('https://transit.local/alerts?from=2026-07-01#service'),
			},
		});
		const wideSwitch = getByRole('link', { name: 'Switch language: Français' });
		expect(wideSwitch).toHaveAttribute('href', '/fr/alerts?from=2026-07-01#service');
		expect(wideSwitch).toHaveAttribute('data-sveltekit-reload');

		await fireEvent.click(getByRole('button', { name: 'Open menu' }));
		const menu = queryByTestId('nav-menu') as HTMLElement;
		const compactSwitch = within(menu).getByRole('link', {
			name: 'Switch language: Français',
		});
		expect(compactSwitch).toHaveAttribute('href', '/fr/alerts?from=2026-07-01#service');
		expect(compactSwitch).toHaveAttribute('data-sveltekit-reload');
		expect(readSource()).toMatch(
			/@media \(max-width: 359px\)[\s\S]*\[data-slot='lang-switch'\][\s\S]*display:\s*none;[\s\S]*\.nav-menu-language[\s\S]*display:\s*flex;/,
		);
	});

	it('marks the active surface with aria-current on the matching link', () => {
		const { getByRole } = render(NavPill, {
			props: { locale: 'en', url: new URL('https://transit.local/lines/161') },
		});
		// /lines/161 keeps the Lines primary active (nested prefix).
		expect(getByRole('link', { name: 'Lines' })).toHaveAttribute('aria-current', 'page');
		expect(getByRole('link', { name: 'Map' })).not.toHaveAttribute('aria-current');
	});
});

describe('NavPill — active "you are here" dot', () => {
	it('draws the 3×3 amber dot at bottom 4px on the active link only', () => {
		const source = readSource();
		// Amber dot (--accent), 3×3, bottom 4px, on aria-current='page'.
		expect(source).toMatch(
			/\.nav-pill-link\[aria-current='page'\]::after\s*\{[\s\S]*bottom:\s*4px;[\s\S]*width:\s*3px;[\s\S]*height:\s*3px;[\s\S]*background:\s*var\(--accent\);/,
		);
		// NO text-shadow CSS declaration anywhere (glow-never-text ruling upheld over
		// yesid's own nav-link text-shadow). Matches a real `text-shadow: …;` rule,
		// not the prose in the doc comments.
		expect(source).not.toMatch(/text-shadow\s*:/);
	});
});

describe('NavPill — the flat menu', () => {
	it('opens a flat menu of the six audit destinations + the externalized Yesid link', async () => {
		const { getByRole, queryByTestId } = render(NavPill, {
			props: { locale: 'en', url: new URL('https://transit.local/map') },
		});

		expect(queryByTestId('nav-menu')).not.toBeInTheDocument();

		await fireEvent.click(getByRole('button', { name: 'Open menu' }));

		const menu = queryByTestId('nav-menu') as HTMLElement;
		expect(menu).toBeInTheDocument();

		// FLAT list — no visible "Audit" text heading (the group aria-label survives
		// for AT, but there is no rendered SectionLabel heading).
		expect(within(menu).queryByText('Audit')).not.toBeInTheDocument();
		expect(within(menu).queryByText('Explore')).not.toBeInTheDocument();

		// The Audit group (aria-labelled) holds the six accountability surfaces.
		const audit = within(menu).getByRole('group', { name: 'Audit' });
		expect(within(audit).getByRole('link', { name: 'How we measure' })).toHaveAttribute(
			'href',
			'/metrics',
		);
		expect(within(audit).getByRole('link', { name: 'Data health' })).toHaveAttribute(
			'href',
			'/status',
		);
		expect(within(audit).getByRole('link', { name: 'Hotspots' })).toHaveAttribute(
			'href',
			'/hotspots',
		);
		expect(within(audit).getByRole('link', { name: 'Daily receipt' })).toHaveAttribute(
			'href',
			'/receipt',
		);
		expect(within(audit).getByRole('link', { name: 'Repeat offenders' })).toHaveAttribute(
			'href',
			'/repeat-offenders',
		);
		expect(within(audit).getByRole('link', { name: 'Alerts' })).toHaveAttribute('href', '/alerts');

		// Owner decision 2026-08-03: legal destinations are footer-only on every route.
		expect(within(menu).queryByRole('group', { name: 'Legal' })).not.toBeInTheDocument();
		expect(within(menu).queryByRole('link', { name: 'Privacy' })).not.toBeInTheDocument();
		expect(within(menu).queryByRole('link', { name: 'Terms' })).not.toBeInTheDocument();

		// The parent-brand "Yesid" link is externalized (final menu row, external ↗).
		const yesid = within(menu).getByRole('link', { name: /Yesid/ });
		expect(yesid).toHaveTextContent('Yesid');
		expect(yesid).toHaveAttribute('href', 'https://yesid.dev');
		expect(yesid).toHaveAttribute('target', '_blank');
		expect(yesid).toHaveAttribute('rel', 'noopener noreferrer');
		expect(yesid).toHaveAccessibleName('Yesid (opens in a new tab)');
	});

	it.each([768, 1512])(
		'resynchronizes the settled menu anchor at %ipx after the pill padding transition',
		async (viewportWidth) => {
			const { getByRole, getByTestId, queryByTestId } = render(NavPill, {
				props: { locale: 'en', url: new URL('https://transit.local/map') },
			});
			const root = getByRole('navigation', { name: 'Primary navigation' });
			const pill = getByTestId('nav-pill');
			const brand = within(pill).getByRole('link', { name: /Transit/ });
			let pillRight = viewportWidth - 96;
			vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(viewportWidth);
			vi.spyOn(pill, 'getBoundingClientRect').mockImplementation(
				() =>
					({
						x: pillRight - 480,
						y: 16,
						left: pillRight - 480,
						top: 16,
						right: pillRight,
						bottom: 88,
						width: 480,
						height: 72,
						toJSON: () => ({}),
					}) as DOMRect,
			);

			await fireEvent.click(getByRole('button', { name: 'Open menu' }));
			const menuRail = queryByTestId('nav-menu')?.parentElement;
			expect(menuRail).not.toBeNull();
			vi.spyOn(menuRail!, 'getBoundingClientRect').mockReturnValue({
				x: 0,
				y: 0,
				left: 0,
				top: 0,
				right: viewportWidth,
				bottom: 900,
				width: viewportWidth,
				height: 900,
				toJSON: () => ({}),
			} as DOMRect);
			await fireEvent(window, new Event('resize'));
			await waitFor(() => expect(root.style.getPropertyValue('--nav-pill-right')).toBe('96px'));

			pillRight -= 8;
			await fireTransitionEnd(pill, 'box-shadow');
			expect(root.style.getPropertyValue('--nav-pill-right')).toBe('96px');
			await fireTransitionEnd(brand, 'padding-right');
			expect(root.style.getPropertyValue('--nav-pill-right')).toBe('96px');

			await fireTransitionEnd(pill, 'padding-right');
			expect(root.style.getPropertyValue('--nav-pill-right')).toBe('104px');
		},
	);

	it.each([
		{ offset: 560, viewportRight: 1512, wrapperRight: 952, pillRight: 900, expected: '52px' },
		{ offset: 0, viewportRight: 1512, wrapperRight: 1512, pillRight: 1416, expected: '96px' },
	])(
		'publishes the menu-wrapper-relative anchor with a $offset px rail offset',
		async ({ offset, viewportRight, wrapperRight, pillRight, expected }) => {
			const { getByRole, getByTestId, queryByTestId } = render(NavPill, {
				props: { locale: 'en', url: new URL('https://transit.local/map') },
			});
			const root = getByRole('navigation', { name: 'Primary navigation' });
			const pill = getByTestId('nav-pill');
			root.style.setProperty('--app-effective-rail-offset', `${offset}px`);
			vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(viewportRight);
			vi.spyOn(pill, 'getBoundingClientRect').mockReturnValue({
				x: pillRight - 480,
				y: 16,
				left: pillRight - 480,
				top: 16,
				right: pillRight,
				bottom: 88,
				width: 480,
				height: 72,
				toJSON: () => ({}),
			} as DOMRect);

			await fireEvent.click(getByRole('button', { name: 'Open menu' }));
			const menuRail = queryByTestId('nav-menu')?.parentElement;
			expect(menuRail).not.toBeNull();
			vi.spyOn(menuRail!, 'getBoundingClientRect').mockReturnValue({
				x: 0,
				y: 0,
				left: 0,
				top: 0,
				right: wrapperRight,
				bottom: 900,
				width: wrapperRight,
				height: 900,
				toJSON: () => ({}),
			} as DOMRect);

			await fireEvent(window, new Event('resize'));
			await waitFor(() => expect(root.style.getPropertyValue('--nav-pill-right')).toBe(expected));
		},
	);

	it('uses the footer-owned Audit label in French and localizes the Yesid new-tab affordance', async () => {
		const { getByRole, queryByTestId } = render(NavPill, {
			props: { locale: 'fr', url: new URL('https://transit.local/fr/map') },
		});
		await fireEvent.click(getByRole('button', { name: 'Ouvrir le menu' }));
		const menu = queryByTestId('nav-menu') as HTMLElement;
		const audit = within(menu).getByRole('group', { name: 'Vérification' });
		expect(within(audit).getByRole('link', { name: 'Récidivistes' })).toHaveAttribute(
			'href',
			'/fr/repeat-offenders',
		);
		expect(within(menu).queryByRole('group', { name: 'Juridique' })).not.toBeInTheDocument();
		expect(within(menu).queryByRole('link', { name: 'Confidentialité' })).not.toBeInTheDocument();
		expect(
			within(menu).queryByRole('link', { name: 'Conditions d’utilisation' }),
		).not.toBeInTheDocument();
		// The parent-brand link stays "Yesid" (brand name, not localized) with a FR
		// new-tab affordance, and still points at the external house site.
		const yesid = within(menu).getByRole('link', { name: /Yesid/ });
		expect(yesid).toHaveAttribute('href', 'https://yesid.dev');
		expect(yesid).toHaveAccessibleName('Yesid (nouvel onglet)');
	});

	it('closes the menu and returns focus to the hamburger via Escape', async () => {
		const { getByRole, queryByTestId } = render(NavPill, {
			props: { locale: 'en', url: new URL('https://transit.local/map') },
		});

		const toggle = getByRole('button', { name: 'Open menu' });
		await fireEvent.click(toggle);
		expect(queryByTestId('nav-menu')).toBeInTheDocument();

		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(queryByTestId('nav-menu')).not.toBeInTheDocument();
		expect(document.activeElement).toBe(toggle);
	});

	it('returns focus to the toggle when an Audit link closes the menu', async () => {
		const { getByRole, queryByTestId } = render(NavPill, {
			props: { locale: 'en', url: new URL('https://transit.local/map') },
		});

		const toggle = getByRole('button', { name: 'Open menu' });
		await fireEvent.click(toggle);
		const menu = queryByTestId('nav-menu') as HTMLElement;
		const audit = within(menu).getByRole('group', { name: 'Audit' });

		await fireEvent.click(within(audit).getByRole('link', { name: 'Hotspots' }));
		expect(queryByTestId('nav-menu')).not.toBeInTheDocument();
		expect(document.activeElement).toBe(toggle);
	});

	it('carries the four primary surfaces in the sheet (the <lg wayfinding entry)', async () => {
		// Regression guard: below lg the in-pill .nav-links row is hidden, so the
		// hamburger sheet MUST carry Map/Lines/Stops/Network or compact-width nav is a
		// dead-end (the hamburger reached only Audit + Search).
		const { getByRole, queryByTestId } = render(NavPill, {
			props: { locale: 'en', url: new URL('https://transit.local/map') },
		});
		await fireEvent.click(getByRole('button', { name: 'Open menu' }));
		const menu = queryByTestId('nav-menu') as HTMLElement;
		const explore = within(menu).getByRole('group', { name: 'Explore' });
		expect(within(explore).getByRole('link', { name: 'Map' })).toHaveAttribute('href', '/map');
		expect(within(explore).getByRole('link', { name: 'Lines' })).toHaveAttribute('href', '/lines');
		expect(within(explore).getByRole('link', { name: 'Stops' })).toHaveAttribute('href', '/stops');
		expect(within(explore).getByRole('link', { name: 'Network' })).toHaveAttribute(
			'href',
			'/network',
		);
	});

	it('localizes the Explore (primary) sheet group in French', async () => {
		const { getByRole, queryByTestId } = render(NavPill, {
			props: { locale: 'fr', url: new URL('https://transit.local/fr/map') },
		});
		await fireEvent.click(getByRole('button', { name: 'Ouvrir le menu' }));
		const menu = queryByTestId('nav-menu') as HTMLElement;
		const explore = within(menu).getByRole('group', { name: 'Explorer' });
		expect(within(explore).getByRole('link', { name: 'Réseau' })).toHaveAttribute(
			'href',
			'/fr/network',
		);
	});

	it('stages full links and compact search from the named pill rail (source)', () => {
		const source = readSource();
		expect(source.match(/class="nav-(?:menu-)?rail"/g)).toHaveLength(2);
		expect(source).toMatch(/class="nav-rail"\s+data-slot="nav-rail"/);
		expect(source).toMatch(
			/\.nav-rail\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*var\(--z-nav\);[^}]*width:\s*calc\(100vw - var\(--app-effective-rail-offset, 0px\)\);[^}]*display:\s*flex;[^}]*justify-content:\s*center;[^}]*container-type:\s*inline-size;[^}]*container-name:\s*nav-rail;/,
		);
		expect(source).toMatch(
			/\.nav-pill\s*\{[^}]*max-width:\s*calc\(100cqi - 1\.5rem\);[^}]*transform:\s*translateX\(calc\(var\(--app-effective-rail-offset, 0px\) \* -0\.5\)\);/,
		);
		expect(source).toMatch(/\.nav-search-input\s*\{[^}]*width:\s*clamp\(11rem, 22cqi, 20rem\);/);
		expect(source).toMatch(
			/@container nav-rail \(width < 1024px\)\s*\{[\s\S]*?\.nav-search\s*\{\s*display:\s*none;\s*\}[\s\S]*?\.nav-compact-search\s*\{\s*display:\s*inline-flex;\s*\}/,
		);
	});

	it('pins the tightened and folded stages plus the isolated menu rail (source)', () => {
		const source = readSource();
		expect(source).toMatch(/:root\s*\{[^}]*--app-effective-rail-offset:\s*0px;/);
		expect(source).toMatch(
			/\.nav-menu-rail\s*\{\s*position:\s*fixed;\s*inset-block:\s*0;\s*inset-inline-start:\s*0;\s*width:\s*calc\(100vw - var\(--app-effective-rail-offset, 0px\)\);\s*pointer-events:\s*none;\s*z-index:\s*var\(--z-menu\);\s*container-type:\s*inline-size;\s*container-name:\s*nav-rail;\s*\}/,
		);
		expect(source).toMatch(
			/\.nav-pill\s*\{[^}]*transition:[^}]*transform var\(--app-rail-offset-duration, var\(--duration-normal\)\) var\(--ease-default\);/,
		);
		expect(source).toMatch(
			/event\.propertyName === 'transform' \|\| event\.propertyName\.startsWith\('padding'\)/,
		);
		expect(source).toMatch(
			/@container nav-rail \(width < 799px\)\s*\{[\s\S]*?\.nav-pill\s*\{\s*padding:\s*12px 20px;\s*\}[\s\S]*?\.nav-divider\s*\{\s*margin-inline:\s*12px;\s*\}[\s\S]*?\.nav-links\s*\{\s*gap:\s*18px;\s*\}/,
		);
		expect(source).toMatch(
			/@container nav-rail \(width < 705px\)\s*\{[\s\S]*?\.nav-links\s*\{\s*display:\s*none;\s*\}[\s\S]*?\.nav-divider-collapsible\s*\{\s*display:\s*none;\s*\}[\s\S]*?\.nav-menu-primary-group\s*\{\s*display:\s*grid;\s*\}[\s\S]*?\.nav-menu-group\s*\{\s*margin-top:\s*0\.5rem;\s*padding-top:\s*0\.5rem;\s*border-top:\s*1px solid var\(--border-subtle\);\s*\}/,
		);
		expect(source.indexOf('@container nav-rail (width < 1024px)')).toBeGreaterThan(
			source.indexOf('@media (min-width: 1024px)'),
		);
	});

	it('keeps Search out of the burger menu because the top control owns it', async () => {
		const { getByRole, queryByTestId } = render(NavPill, {
			props: { locale: 'en', url: new URL('https://transit.local/map') },
		});
		await fireEvent.click(getByRole('button', { name: 'Open menu' }));
		const menu = queryByTestId('nav-menu') as HTMLElement;
		expect(within(menu).queryByRole('group', { name: 'Search' })).not.toBeInTheDocument();
		expect(menu.querySelector('[data-slot="nav-menu-search-input"]')).not.toBeInTheDocument();
	});
});

describe('NavPill — search', () => {
	it.each([
		['en', 'Your searches are sent to our server and its geocoding providers (Google, geo.ca).'],
		[
			'fr',
			'Vos recherches sont envoyées à notre serveur et à ses fournisseurs de géocodage (Google, geo.ca).',
		],
	] as const)(
		'renders the %s chrome collection notice beside the search input',
		(locale, notice) => {
			const { getByRole } = render(NavPill, { props: { locale } });
			const search = getByRole('search');
			const nodes = within(search).getAllByText(notice);
			expect(nodes).toHaveLength(2);
			const target = nodes.find((n) => n.id === 'nav-search-notice');
			expect(target).toHaveClass('sr-only');
			expect(nodes.find((n) => n !== target)).toHaveAttribute('aria-hidden', 'true');
			expect(within(search).getByRole('searchbox')).toBeInTheDocument();
		},
	);

	it('keeps search results below the chrome collection notice', () => {
		const source = readSource();
		// The two used to be anchored INDEPENDENTLY (0.25rem for the disclosure vs
		// 1.75rem for the results) — which is precisely how the disclosure ended up
		// painting on the pill while the results cleared it. One dropdown now owns
		// the anchor, so the ordering is structural: the disclosure card is markup-
		// before the result list, and the list no longer positions itself at all.
		expect(source).toMatch(/\.nav-search-panel\s*\{[^}]*top:\s*calc\(100% \+ 1\.75rem\)/);
		expect(source).not.toMatch(/\.nav-search-results\s*\{[^}]*position:\s*absolute/);
		const panel = source.slice(source.indexOf('<div class="nav-search-panel"'));
		expect(panel.indexOf('<SearchControls')).toBeGreaterThanOrEqual(0);
		expect(panel.indexOf('<SearchControls')).toBeLessThan(
			panel.indexOf('class="nav-search-results"'),
		);
	});

	it('gates the collection notice on search use (opacity-only fade)', () => {
		const source = readSource();
		// Idle: the dropdown holding the visible disclosure is hidden; the sr-only
		// describedby target stays in the tree so browse mode can still find it.
		expect(source).toMatch(/\.nav-search-panel\s*\{[^}]*opacity:\s*0;[^}]*visibility:\s*hidden/);
		expect(source).toMatch(/id="nav-search-notice"\s+class="sr-only"/);
		// In use: focus anywhere in the form OR the results list open reveals it —
		// the SAME two-armed gate, now carried by the dropdown that holds the copy.
		expect(source).toMatch(
			/\.nav-search:focus-within\s+\.nav-search-panel,\s*\.nav-search:has\(\.nav-search-results\)\s+\.nav-search-panel\s*\{[^}]*opacity:\s*1;[^}]*visibility:\s*visible/,
		);
		// No movement in the gated rule — the fade stays reduced-motion-safe.
		expect(source).not.toMatch(/\.nav-search-panel\s*\{[^}]*(?:transform|translate|scale|rotate):/);
		// House precedent: the transition is disabled under reduced motion.
		expect(source).toMatch(/prefers-reduced-motion[\s\S]{0,400}\.nav-search-panel,/);
	});

	it('renders selectable grouped chrome search results and fires select', async () => {
		const onresultselect = vi.fn();
		const { getByRole } = render(NavPill, {
			props: {
				locale: 'en',
				search: '161',
				searchResults: [
					{ kind: 'route', id: '161', label: '161 Van Horne', priority: 0 },
					{ kind: 'vehicle', id: '40061', label: '40061', meta: 'Route 161', priority: 20 },
				],
				onresultselect,
			},
		});

		expect(getByRole('button', { name: 'Route 161 Van Horne' })).toHaveTextContent('Route');
		await fireEvent.click(getByRole('button', { name: 'Route 161 Van Horne' }));
		expect(onresultselect).toHaveBeenCalledWith({
			kind: 'route',
			id: '161',
			label: '161 Van Horne',
			priority: 0,
		});
	});

	it('turns browser autofill off on the in-pill search box', () => {
		const { getByRole } = render(NavPill, { props: { locale: 'en' } });
		const searchbox = getByRole('searchbox', { name: 'Search the network' });
		expect(searchbox).toHaveAttribute('autocomplete', 'off');
		expect(searchbox).toHaveAttribute('name', 'network-search');
	});

	it('scopes the search placeholder + aria-label to the line catalogue', () => {
		const { getByRole } = render(NavPill, { props: { locale: 'en', searchScope: 'route' } });
		expect(getByRole('searchbox', { name: 'Search a line' })).toHaveAttribute(
			'placeholder',
			'Search a line…',
		);
	});

	it('shows the collection notice only where searches actually transmit (S5-377 B3)', () => {
		// map/all scopes fire the geocode fetch; route/stop scopes never do, so the
		// notice there would claim transmission that does not happen.
		for (const searchScope of ['map', 'all'] as const) {
			const { getAllByText, getByRole, unmount } = render(NavPill, {
				props: { locale: 'en', searchScope },
			});
			const notices = getAllByText(
				'Your searches are sent to our server and its geocoding providers (Google, geo.ca).',
			);
			expect(notices).toHaveLength(2);
			const target = notices.find((n) => n.id === 'nav-search-notice');
			expect(target).toBeDefined();
			expect(target).toHaveClass('sr-only');
			expect(notices.find((n) => n !== target)).toHaveAttribute('aria-hidden', 'true');
			expect(getByRole('searchbox', { name: 'Search the network' })).toHaveAttribute(
				'aria-describedby',
				'nav-search-notice',
			);
			unmount();
		}
		for (const searchScope of ['route', 'stop'] as const) {
			const { queryByText, getByRole, unmount } = render(NavPill, {
				props: { locale: 'en', searchScope },
			});
			expect(queryByText(/searches are sent/i)).toBeNull();
			expect(getByRole('searchbox')).not.toHaveAttribute('aria-describedby');
			unmount();
		}
	});

	it('closes desktop search suggestions when the user clicks outside', async () => {
		const { getByRole, queryByRole } = render(NavPill, {
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

		await waitFor(() =>
			expect(
				queryByRole('button', {
					name: 'Address 5333 Avenue Casgrain, Montréal, Quebec Address',
				}),
			).not.toBeInTheDocument(),
		);
	});
});

describe('NavPill — the pill chassis + --pill-h contract (source)', () => {
	it('is a fixed, pointer-events-none rail centring an intrinsic pointer-events-auto pill', () => {
		const source = readSource();
		expect(source).toMatch(
			/\.nav-root\s*\{[\s\S]*position:\s*fixed;[\s\S]*pointer-events:\s*none;/,
		);
		expect(source).toMatch(
			/\.nav-root\s*\{[\s\S]*inset-block-start:\s*calc\(1rem \+ env\(safe-area-inset-top/,
		);
		expect(source).toMatch(/\.nav-root\s*\{[\s\S]*z-index:\s*var\(--z-nav\);/);
		expect(source).toMatch(/\.nav-pill\s*\{[\s\S]*pointer-events:\s*auto;/);
	});

	it('builds the exact yesid pill chassis (radius-pill, 2px brand border, 92% mix, blur16, shadow-nav)', () => {
		const source = readSource();
		expect(source).toMatch(/\.nav-pill\s*\{[\s\S]*border-radius:\s*var\(--radius-pill\);/);
		expect(source).toMatch(/\.nav-pill\s*\{[\s\S]*border:\s*2px solid var\(--border-brand\);/);
		expect(source).toMatch(
			/\.nav-pill\s*\{[\s\S]*background:\s*color-mix\(in srgb, var\(--background\) 92%, transparent\);/,
		);
		expect(source).toMatch(/\.nav-pill\s*\{[\s\S]*box-shadow:\s*var\(--shadow-nav\);/);
		expect(source).toMatch(/\.nav-pill\s*\{[\s\S]*backdrop-filter:\s*blur\(16px\)/);
		// The measured padding tiers: 12/28 desktop → 8/16 ≤767 → 6/8 ≤479.
		expect(source).toMatch(/\.nav-pill\s*\{[\s\S]*padding:\s*12px 28px;/);
		expect(source).toMatch(/padding:\s*8px 16px;/);
		expect(source).toMatch(/padding:\s*6px 8px;/);
	});

	it('publishes --pill-h per breakpoint on :root (deterministic, no JS measurement)', () => {
		const source = readSource();
		// 44 + 2·12 + 2·2 = 72; 44 + 2·8 + 4 = 64; 44 + 2·6 + 4 = 60.
		expect(source).toMatch(/:root\s*\{[\s\S]*--pill-h:\s*72px;/);
		expect(source).toMatch(/@media \(max-width: 767px\)\s*\{[\s\S]*--pill-h:\s*64px;/);
		expect(source).toMatch(/@media \(max-width: 479px\)\s*\{[\s\S]*--pill-h:\s*60px;/);
	});

	it('draws 2×18px brand dividers with 20px inline margin, and a 28px→18px link gap', () => {
		const source = readSource();
		expect(source).toMatch(
			/\.nav-divider\s*\{[\s\S]*width:\s*2px;[\s\S]*height:\s*18px;[\s\S]*margin-inline:\s*20px;[\s\S]*background:\s*var\(--border-brand\);/,
		);
		expect(source).toMatch(/\.nav-links\s*\{[\s\S]*gap:\s*28px;/);
		expect(source).toMatch(
			/@media \(max-width: 1023\.98px\)\s*\{[\s\S]*\.nav-links\s*\{[\s\S]*gap:\s*18px;/,
		);
	});

	it('gives every pill hit area ≥44px (links, controls, hamburger)', () => {
		const source = readSource();
		expect(source).toMatch(/\.nav-pill-link\s*\{[\s\S]*min-height:\s*44px;/);
		expect(source).toMatch(
			/\.nav-controls :global\(\.nav-control\)\s*\{[\s\S]*min-width:\s*44px;[\s\S]*min-height:\s*44px;/,
		);
		expect(source).toMatch(/\.nav-menu-toggle\s*\{[\s\S]*width:\s*44px;[\s\S]*height:\s*44px;/);
	});

	it('uses one anchored rounded dropdown at every width', () => {
		const source = readSource();
		const menuRule = baseMenuRule(source);

		expect(source).toMatch(/class="nav-menu glass-chrome"/);
		// Amendment K: absolute-in-fixed-wrapper is the deterministic anchor mechanism —
		// a silent revert to `fixed` re-resolves against the viewport (the V−87 defect).
		expect(menuRule).toContain('position: absolute;');
		expect(menuRule).toContain('inset-block: auto;');
		expect(menuRule).toContain(
			'inset-block-start: calc(1rem + env(safe-area-inset-top, 0px) + var(--pill-h) + 8px);',
		);
		expect(menuRule).toContain('inset-inline-end: var(--nav-pill-right, 0.75rem);');
		expect(menuRule).toContain('width: min(19rem, calc(100vw - 1.5rem));');
		expect(menuRule).toContain('padding: 0.65rem;');
		expect(menuRule).toContain('border-radius: var(--radius-xl);');
		expect(menuRule).toMatch(/max-height:\s*min\([\s\S]*42rem\s*\);/);
		expect(menuRule).not.toContain('inset-block: 0;');
		expect(menuRule).not.toContain('max-height: 100dvh;');
		expect(menuRule).not.toContain('border-radius: 0;');
		expect(source).toMatch(
			/@media \(min-width: 768px\)\s*\{\s*\.nav-menu\s*\{\s*max-height:\s*min\(calc\(100dvh - var\(--pill-h\) - 3rem\), 34rem\);/,
		);
	});
});

// ── M6i · F25 + F26 — the disclosure gets a real home ───────────────────────────
//
// RECEIPT CLASS: SOURCE + DOM contracts. happy-dom performs NO layout
// (getBoundingClientRect() is all zeros here), so a measured-overlap assertion in
// this file would be a false receipt. What IS checkable is the ARITHMETIC over the
// box model the pill declares in plain CSS: at the only widths where the in-pill
// field renders (viewport ≥1024px AND rail ≥1024px) the pill is 2px border + 12px
// pad + a 44px control band + 12px pad + 2px border = --pill-h 72px, and the 36px
// field is centred in that band. So the field's bottom edge sits 54px below the
// pill's top and the pill's own bottom edge is a further 18px down: a dropdown
// anchored inside .nav-search at `top: calc(100% + X)` PAINTS ON THE PILL for
// every X < 18px. The shipped notice used X = 0.25rem = 4px, which is exactly the
// 448×14 overlap the browser lane measured. Real pixels stay in the browser lane;
// this pins the constant that produces them.
const PILL_EDGE_BELOW_FIELD_PX = 18;
const NOTICE_EN =
	'Your searches are sent to our server and its geocoding providers (Google, geo.ca).';

function ruleFor(source: string, selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return source.match(new RegExp(`\\n\\t${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

function renderWithResults() {
	return render(NavPill, {
		props: {
			locale: 'en',
			search: '161',
			searchScope: 'all',
			searchResults: [{ kind: 'route', id: '161', label: '161 Van Horne', priority: 0 }],
		},
	});
}

describe('NavPill — the focus dropdown that houses the disclosure (M6i F25/F26)', () => {
	it('anchors the focus dropdown clear of the pill instead of painting on it', () => {
		const source = readSource();
		const panel = ruleFor(source, '.nav-search-panel');
		expect(panel, '.nav-search-panel must exist as the one focus dropdown').not.toBe('');
		expect(panel).toMatch(/position:\s*absolute;/);

		const anchor = panel.match(/top:\s*calc\(100% \+ ([\d.]+)rem\)/);
		expect(anchor, '.nav-search-panel must anchor at top: calc(100% + <n>rem)').not.toBeNull();
		expect(Number(anchor![1]) * 16).toBeGreaterThanOrEqual(PILL_EDGE_BELOW_FIELD_PX);

		// The 4px anchor that produced the 448×14 overlap must not survive anywhere.
		expect(source).not.toMatch(/top:\s*calc\(100% \+ 0\.25rem\)/);
	});

	it('parks the visible disclosure inside that dropdown, ahead of the results', () => {
		const { getByRole } = renderWithResults();
		const form = getByRole('search');
		const panel = form.querySelector<HTMLElement>('[data-slot="nav-search-panel"]');
		expect(panel).not.toBeNull();

		const notice = within(panel!).getByText(NOTICE_EN);
		expect(notice).toHaveAttribute('aria-hidden', 'true');
		const results = panel!.querySelector('.nav-search-results');
		expect(results).not.toBeNull();
		// DOM order is the layout-independent statement of "results below the notice".
		expect(
			notice.compareDocumentPosition(results!) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();

		// PR #392 pin: the describedby target stays UNIQUE and outside the dropdown.
		expect(document.querySelectorAll('#nav-search-notice')).toHaveLength(1);
		expect(panel!.querySelector('#nav-search-notice')).toBeNull();
	});

	it('carries the search page scope + mode filters in the dropdown (F26)', () => {
		const { getByRole } = renderWithResults();
		const panel = getByRole('search').querySelector<HTMLElement>('[data-slot="nav-search-panel"]');
		expect(panel).not.toBeNull();
		expect(within(panel!).getByRole('radiogroup', { name: 'Show' })).toBeInTheDocument();
		for (const mode of ['Métro', 'Tram', 'Bus', 'Train', 'Ferry']) {
			expect(within(panel!).getByRole('button', { name: mode })).toBeInTheDocument();
		}
		// Never a second search form (PR #392 pin).
		expect(document.querySelectorAll('form[role="search"]')).toHaveLength(1);
	});

	it('narrows the visible results when a dropdown scope segment is picked', async () => {
		const { getByRole, queryByRole } = render(NavPill, {
			props: {
				locale: 'en',
				search: 'van horne',
				searchScope: 'all',
				searchResults: [
					{ kind: 'route', id: '161', label: '161 Van Horne', priority: 0 },
					{ kind: 'stop', id: '57191', label: 'Van Horne / Rockland', meta: '57191', priority: 4 },
				],
			},
		});
		expect(getByRole('button', { name: 'Route 161 Van Horne' })).toBeInTheDocument();
		expect(getByRole('button', { name: /Stop Van Horne \/ Rockland/ })).toBeInTheDocument();

		await fireEvent.click(getByRole('radio', { name: /Lines \(1\)/ }));

		expect(getByRole('button', { name: 'Route 161 Van Horne' })).toBeInTheDocument();
		expect(queryByRole('button', { name: /Stop Van Horne \/ Rockland/ })).toBeNull();
	});

	// The Google Places attribution is a THIRD-PARTY obligation, so it is pinned to
	// what is actually on screen — in both directions. Gating it on the unfiltered
	// blend leaves a bare "Powered by Google" after the family narrowing drops every
	// Google row; gating it too tightly hides it while a Google row is still shown.
	it('keeps the Google attribution with the visible Google-sourced rows — never without, never missing', async () => {
		const { getByLabelText, queryByLabelText, getByRole, queryByRole } = render(NavPill, {
			props: {
				locale: 'en',
				search: 'casgrain',
				searchScope: 'all',
				searchResults: [
					{ kind: 'route', id: '161', label: '161 Van Horne', priority: 0 },
					{
						kind: 'address',
						id: 'google:casgrain',
						label: '5333 Avenue Casgrain, Montréal, Quebec',
						meta: 'Address',
						priority: 30,
						attribution: 'google',
					},
				],
			},
		});
		// A visible Google-sourced row ALWAYS carries the attribution.
		expect(getByRole('button', { name: /5333 Avenue Casgrain/ })).toBeInTheDocument();
		expect(getByLabelText('Powered by Google')).toBeInTheDocument();
		// Narrowing the family away drops the row AND its attribution together —
		// never a bare attribution with no Google content on screen.
		await fireEvent.click(getByRole('radio', { name: /Lines \(1\)/ }));
		expect(queryByRole('button', { name: /5333 Avenue Casgrain/ })).toBeNull();
		expect(queryByLabelText('Powered by Google')).toBeNull();
	});

	// ── REGATE-m6i §5 cure — a narrowing must never outlive its on-screen control ──
	//
	// NavPill is PERSISTENT chrome: client-side navigation changes `searchScope` on
	// the SAME instance, and the family/mode controls are drawn only where the blend
	// is mixed (`filters={blendIsMixed}`). The re-gate's FIRE: a family or mode
	// picked on /map kept filtering the /lines catalogue after navigation removed
	// `SearchControls` — an empty result list with no visible cause and no control
	// left to clear it. Invariant pinned here: the filter applies ONLY while its
	// controlling surface is rendered; when the control unmounts, the state resets.

	it('drops the family narrowing when navigation leaves the mixed blend (REGATE-m6i §5b)', async () => {
		const route161 = { kind: 'route', id: '161', label: '161 Van Horne', priority: 0 } as const;
		const stop57191 = {
			kind: 'stop',
			id: '57191',
			label: 'Van Horne / Rockland',
			meta: '57191',
			priority: 4,
		} as const;
		const { getByRole, queryByRole, rerender, container } = render(NavPill, {
			props: {
				locale: 'en',
				search: 'van horne',
				searchScope: 'all',
				searchResults: [route161, stop57191],
			},
		});
		await fireEvent.click(getByRole('radio', { name: /Stops \(1\)/ }));
		expect(getByRole('button', { name: /Stop Van Horne \/ Rockland/ })).toBeInTheDocument();
		expect(queryByRole('button', { name: 'Route 161 Van Horne' })).toBeNull();

		// Client-side navigation to /lines: SAME instance, new scope, route-only blend.
		await rerender({
			locale: 'en',
			search: 'van horne',
			searchScope: 'route',
			searchResults: [route161],
		});

		// The controlling surface is gone from this scope —
		expect(container.querySelector('[data-slot="search-controls"]')).toBeNull();
		expect(queryByRole('radiogroup', { name: 'Show' })).toBeNull();
		// — so the blend must be un-narrowed: the catalogue's match is on screen.
		expect(getByRole('button', { name: 'Route 161 Van Horne' })).toBeInTheDocument();

		// Round trip back to the mixed surface: the family was RESET, not parked —
		// the control returns at "All" with the whole blend visible.
		await rerender({
			locale: 'en',
			search: 'van horne',
			searchScope: 'all',
			searchResults: [route161, stop57191],
		});
		expect(getByRole('radio', { name: 'All' })).toBeChecked();
		expect(getByRole('button', { name: 'Route 161 Van Horne' })).toBeInTheDocument();
		expect(getByRole('button', { name: /Stop Van Horne \/ Rockland/ })).toBeInTheDocument();
	});

	it('clears the mode set the moment its chips have no surface — no control, no narrowing (REGATE-m6i §5c)', async () => {
		const modes = new SvelteSet<TransitModeKey>(['metro']);
		const routes: RouteIndexEntry[] = [{ id: '161', short: '161', long: 'Van Horne', type: 3 }];
		// The sticky set narrows the scoped blend even though this scope draws no chips:
		expect(chromeSearchResults('161', { routes }, { scope: 'route', modes })).toEqual([]);

		const { container } = render(NavPill, {
			props: {
				locale: 'en',
				search: '161',
				searchScope: 'route',
				searchResults: [],
				searchModes: modes,
			},
		});
		await tick();

		// No SearchControls and no chips exist on this scope —
		expect(container.querySelector('[data-slot="search-controls"]')).toBeNull();
		expect(container.querySelector('.search-mode-chip')).toBeNull();
		// — so the chrome must have dropped the set: the absence of the control
		// implies an un-narrowed blend (the exact class REGATE-m6i §5e found missing).
		expect(modes.size).toBe(0);
		expect(
			chromeSearchResults('161', { routes }, { scope: 'route', modes }).map((r) => r.id),
		).toEqual(['161']);
	});

	// MERGEGATE-414 trigger 4: the reset must not OVER-fire. This is the oracle for
	// the other direction of the invariant — while the chips ARE on screen (mixed
	// scope), a picked mode survives. Without it, an effect that also clears the
	// set on mixed scopes makes every chrome chip inert with the whole suite green.
	it('keeps a picked mode while its chips are on screen (mixed scope)', async () => {
		const modes = new SvelteSet<TransitModeKey>();
		const { getByRole } = render(NavPill, {
			props: {
				locale: 'en',
				search: '161',
				searchScope: 'all',
				searchResults: [{ kind: 'route', id: '161', label: '161 Van Horne', priority: 0 }],
				searchModes: modes,
			},
		});
		await fireEvent.click(getByRole('button', { name: 'Métro' })); // ← the pin
		expect(modes.size).toBe(1); // ← the pin
	});

	it('omits the filter row where the blend is already one family (honesty)', () => {
		const { getByRole } = render(NavPill, {
			props: {
				locale: 'en',
				searchScope: 'route',
				search: '161',
				searchResults: [{ kind: 'route', id: '161', label: '161 Van Horne', priority: 0 }],
			},
		});
		const panel = getByRole('search').querySelector<HTMLElement>('[data-slot="nav-search-panel"]');
		expect(panel).not.toBeNull();
		expect(within(panel!).queryByRole('radiogroup', { name: 'Show' })).toBeNull();
		expect(within(panel!).queryByRole('button', { name: 'Métro' })).toBeNull();
		// A scoped catalogue also transmits nothing, so the control surface has
		// neither a disclosure nor a filter to draw — and must not paint an empty
		// card in the dropdown for it.
		expect(panel!.querySelector('[data-slot="search-controls"]')).toBeNull();
	});
});
