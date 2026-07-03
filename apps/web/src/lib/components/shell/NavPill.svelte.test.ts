import { fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import NavPill from './NavPill.svelte';

function readSource(): string {
	return readFileSync(resolve(process.cwd(), 'src/lib/components/shell/NavPill.svelte'), 'utf-8');
}

describe('NavPill — structure', () => {
	it('renders the floating pill with the four primary links in wayfinding order', () => {
		const { getByTestId, getByRole } = render(NavPill, {
			props: { locale: 'en', url: new URL('https://transit.local/lines') },
		});

		const pill = getByTestId('nav-pill');
		expect(pill).toBeInTheDocument();

		// Brand wordmark routes to the product home (not the external house site).
		const brand = within(pill).getByRole('link', { name: /yesid/ });
		expect(brand).toHaveAttribute('href', '/');

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

describe('NavPill — the Audit menu', () => {
	it('opens a menu grouping the six audit surfaces + the externalized house link', async () => {
		const { getByRole, queryByTestId } = render(NavPill, {
			props: { locale: 'en', url: new URL('https://transit.local/map') },
		});

		expect(queryByTestId('nav-menu')).not.toBeInTheDocument();

		await fireEvent.click(getByRole('button', { name: 'Open menu' }));

		const menu = queryByTestId('nav-menu') as HTMLElement;
		expect(menu).toBeInTheDocument();

		// The Audit group holds the six accountability surfaces.
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

		// The parent-brand house link is externalized.
		const yesid = within(menu).getByRole('link', { name: 'yesid.' });
		expect(yesid).toHaveAttribute('href', 'https://yesid.dev');
		expect(yesid).toHaveAttribute('target', '_blank');
		expect(yesid).toHaveAttribute('rel', 'noopener noreferrer');
	});

	it('localizes the Audit group heading + hrefs in French', async () => {
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

	it('hides the in-pill primary links below lg, shown ≥lg (source)', () => {
		const source = readSource();
		// Base rule hides .nav-links; the ≥lg media query restores display:flex.
		expect(source).toMatch(/\.nav-links\s*\{[\s\S]*display:\s*none;/);
		expect(source).toMatch(
			/@media \(min-width: 1024px\)\s*\{[\s\S]*\.nav-links\s*\{[\s\S]*display:\s*flex;/,
		);
	});

	it('carries a search group in the menu sheet (the <lg search entry)', async () => {
		const { getByRole, queryByTestId } = render(NavPill, {
			props: { locale: 'en', url: new URL('https://transit.local/map') },
		});
		await fireEvent.click(getByRole('button', { name: 'Open menu' }));
		const menu = queryByTestId('nav-menu') as HTMLElement;
		expect(within(menu).getByRole('group', { name: 'Search' })).toBeInTheDocument();
		expect(menu.querySelector('[data-slot="nav-menu-search-input"]')).toBeInTheDocument();
	});
});

describe('NavPill — search', () => {
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
		expect(getByRole('searchbox', { name: 'Search the network' })).toHaveAttribute(
			'autocomplete',
			'off',
		);
	});

	it('scopes the search placeholder + aria-label to the line catalogue', () => {
		const { getByRole } = render(NavPill, { props: { locale: 'en', searchScope: 'route' } });
		expect(getByRole('searchbox', { name: 'Search a line' })).toHaveAttribute(
			'placeholder',
			'Search a line…',
		);
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

	it('dresses both menu presentations in .glass-chrome (sheet ≤767, dropdown ≥768)', () => {
		const source = readSource();
		expect(source).toMatch(/class="nav-menu glass-chrome"/);
		// ≥768 is an anchored dropdown pinned under the pill (top uses --pill-h + 8px).
		expect(source).toMatch(
			/@media \(min-width: 768px\)\s*\{[\s\S]*\.nav-menu\s*\{[\s\S]*var\(--pill-h\) \+ 8px\)/,
		);
	});
});
