import { fireEvent, render, within } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRawSnippet } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import LeftRail from './LeftRail.svelte';

// A page-supplied custom rail body, e.g. /map or /lines filters.
const customRail = createRawSnippet(() => ({
	render: () => `<div data-testid="custom-rail-body">Page filters</div>`,
}));

describe('LeftRail', () => {
	it('renders default desktop navigation with the current page highlighted', () => {
		const { getByRole } = render(LeftRail, {
			props: {
				locale: 'en',
				url: new URL('https://transit.local/stops'),
			},
		});

		const rail = getByRole('navigation', { name: 'Network navigation' });
		expect(rail).toHaveTextContent('Next stations');
		expect(within(rail).getByRole('link', { name: 'Map live network' })).toHaveAttribute(
			'href',
			'/map',
		);
		expect(within(rail).getByRole('link', { name: 'Lines routes and directions' })).toHaveAttribute(
			'href',
			'/lines',
		);
		expect(
			within(rail).getByRole('link', { name: 'Stops departures and schedules' }),
		).toHaveAttribute('href', '/stops');
		expect(
			within(rail).getByRole('link', { name: 'Network reliability and health' }),
		).toHaveAttribute('href', '/network');
		expect(
			within(rail).getByRole('link', { name: 'Stops departures and schedules' }),
		).toHaveAttribute('aria-current', 'page');
		expect(rail).not.toHaveTextContent('No content yet');
	});

	it('exposes the Audit group below the primaries with localized, active-aware links', () => {
		const { getByRole } = render(LeftRail, {
			props: {
				locale: 'en',
				url: new URL('https://transit.local/hotspots'),
			},
		});

		// The group is a labelled landmark below the four primaries.
		const audit = getByRole('group', { name: 'Audit' });
		expect(audit).toHaveTextContent('Audit');
		// Its surfaces are reachable as links, and the active one is highlighted.
		const hotspots = within(audit).getByRole('link', { name: 'Hotspots' });
		expect(hotspots).toHaveAttribute('href', '/hotspots');
		expect(hotspots).toHaveAttribute('aria-current', 'page');
		expect(within(audit).getByRole('link', { name: 'Alerts' })).toHaveAttribute('href', '/alerts');
	});

	it('keeps the Audit group reachable below a page-supplied custom rail when expanded', () => {
		const { getByRole, getByTestId } = render(LeftRail, {
			props: {
				locale: 'en',
				url: new URL('https://transit.local/map'),
				children: customRail,
			},
		});

		// The page's own rail body renders…
		expect(getByTestId('custom-rail-body')).toBeInTheDocument();
		// …and the Audit group is STILL present below it (not swallowed by the
		// custom-rail branch), with its named, active-aware links.
		const audit = getByRole('group', { name: 'Audit' });
		expect(audit).toHaveTextContent('Audit');
		const map = within(audit).queryByRole('link', { name: 'Map' });
		expect(map).toBeNull(); // primaries are the page's job; Audit holds meta surfaces
		expect(within(audit).getByRole('link', { name: 'Hotspots' })).toHaveAttribute(
			'href',
			'/hotspots',
		);
	});

	it('localizes the Audit group heading + hrefs in French', () => {
		const { getByRole } = render(LeftRail, {
			props: { locale: 'fr', url: new URL('https://transit.local/fr/network') },
		});
		const audit = getByRole('group', { name: 'Vérification' });
		expect(within(audit).getByRole('link', { name: 'Récidivistes' })).toHaveAttribute(
			'href',
			'/fr/repeat-offenders',
		);
	});

	it('keeps Audit links accessible (named) but hides the heading text when collapsed', () => {
		const { getByRole } = render(LeftRail, {
			props: {
				locale: 'en',
				url: new URL('https://transit.local/map'),
				collapsed: true,
			},
		});
		const audit = getByRole('group', { name: 'Audit' });
		// Icon-only: the heading text is gone, but the links keep their aria-label.
		expect(audit).not.toHaveTextContent('Audit');
		expect(within(audit).getByRole('link', { name: 'Hotspots' })).toBeInTheDocument();
	});

	it('keeps the burger out of desktop by threading url into the left rail', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/shell/AppShell.svelte'),
			'utf-8',
		);
		const topbarSource = readFileSync(
			resolve(process.cwd(), 'src/lib/components/shell/TopBar.svelte'),
			'utf-8',
		);

		expect(source).toMatch(
			/<LeftRail[\s\S]*\{locale\}[\s\S]*\{url\}[\s\S]*heading=\{railHeading\}/,
		);
		expect(source).toContain('collapsed={leftRailCollapsed}');
		expect(source).toContain('ontogglecollapse={toggleLeftRailCollapsed}');
		expect(topbarSource).toMatch(/class="tap-press topbar-menu-toggle md:hidden"/);
		expect(topbarSource).toMatch(
			/@media \(min-width: 768px\)[\s\S]*\.topbar-menu-toggle[\s\S]*display: none/,
		);
	});

	it('lets the default left rail navigation render when no page rail is supplied', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/shell/AppShell.svelte'),
			'utf-8',
		);

		expect(source).toContain('{#if rail}');
		expect(source).toContain('{:else}');
		expect(source).toMatch(
			/\{:else\}[\s\S]*<LeftRail[\s\S]*\{locale\}[\s\S]*\{url\}[\s\S]*heading=\{railHeading\}[\s\S]*collapsed=\{leftRailCollapsed\}[\s\S]*ontogglecollapse=\{toggleLeftRailCollapsed\}[\s\S]*\/>/,
		);
	});

	it('collapses to icon-only navigation while keeping links accessible', async () => {
		const ontogglecollapse = vi.fn();
		const { container, getByRole } = render(LeftRail, {
			props: {
				locale: 'en',
				url: new URL('https://transit.local/map'),
				collapsed: true,
				ontogglecollapse,
			},
		});

		const rail = getByRole('navigation', { name: 'Network navigation' });
		expect(rail).toHaveAttribute('data-open', 'false');
		expect(getByRole('link', { name: 'Map live network' })).toHaveAttribute('aria-current', 'page');
		expect(container.querySelector('.left-rail-copy')).not.toBeInTheDocument();
		expect(rail).not.toHaveTextContent('Map');
		expect(rail).not.toHaveTextContent('live network');

		await fireEvent.click(getByRole('button', { name: 'Expand navigation' }));
		expect(ontogglecollapse).toHaveBeenCalledOnce();
	});

	it('keeps collapsed nav tiles symmetric in the rail', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/shell/LeftRail.svelte'),
			'utf-8',
		);

		expect(source).toContain('--left-rail-tile-size: 3.35rem');
		expect(source).toMatch(/\.left-rail-link \{[\s\S]*height: var\(--left-rail-tile-size\);/);
		expect(source).toMatch(
			/\.left-rail\[data-open='false'\] \.left-rail-link \{[\s\S]*width: var\(--left-rail-tile-size\);[\s\S]*height: var\(--left-rail-tile-size\);/,
		);
		expect(source).toMatch(
			/\.left-rail\[data-open='false'\] \.left-rail-head \{[\s\S]*justify-content: center;/,
		);
		expect(source).toMatch(
			/\.left-rail\[data-open='false'\] \.left-rail-nav \{[\s\S]*justify-items: center;/,
		);
	});

	it('uses the yesid.dev contact resizable split for the desktop chrome rail', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/shell/AppShell.svelte'),
			'utf-8',
		);

		expect(source).toContain(
			"import { ResizablePaneGroup, ResizablePane, ResizableHandle } from '$lib/components/ui/resizable'",
		);
		expect(source).toMatch(/<ResizablePaneGroup[\s\S]*direction="horizontal"/);
		expect(source).toContain('class="app-shell-resize-handle app-shell-rail-resize-handle"');
		expect(source).toMatch(
			/<ResizableHandle[\s\S]*withHandle[\s\S]*class="app-shell-resize-handle app-shell-rail-resize-handle"[\s\S]*\/>/,
		);
		expect(source).toContain('const LEFT_RAIL_COLLAPSED_SIZE = 5');
		expect(source).toContain('const LEFT_RAIL_MIN_SIZE = 7');
		expect(source).toContain('const LEFT_RAIL_DEFAULT_SIZE = 16');
		expect(source).toContain('const LEFT_RAIL_COMPACT_THRESHOLD = 9');
		expect(source).toContain('function syncLeftRailVisualState(size: number): void');
		expect(source).toContain('collapsible');
		expect(source).toContain('collapsedSize={LEFT_RAIL_COLLAPSED_SIZE}');
		expect(source).toContain('minSize={LEFT_RAIL_MIN_SIZE}');
		expect(source).toContain('defaultSize={LEFT_RAIL_DEFAULT_SIZE}');
		expect(source).toContain('onResize={(size) => syncLeftRailVisualState(size)}');
		expect(source).toContain('leftRailPane?.resize(LEFT_RAIL_DEFAULT_SIZE)');
		expect(source).toContain('function onLeftRailCollapse(): void');
		expect(source).toContain('onCollapse={onLeftRailCollapse}');
		expect(source).toContain('function onLeftRailExpand(): void');
		expect(source).toContain('onExpand={onLeftRailExpand}');
	});

	it('keeps the desktop map stage fixed while the left rail resizes above it', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/shell/AppShell.svelte'),
			'utf-8',
		);

		expect(source).toContain('let leftRailSize = $state(LEFT_RAIL_DEFAULT_SIZE)');
		expect(source).toContain('const leftRailOffset = $derived(`${leftRailSize}%`)');
		expect(source).toContain('style={`--app-left-rail-offset: ${leftRailOffset};`}');
		expect(source).toContain(
			'class="app-shell-main relative min-w-0 flex-1 overflow-hidden bg-surface-0"',
		);
		expect(source).toContain('class="app-shell-rail-overlay"');
		expect(source).toContain('class="app-shell-left-rail-pane"');
		expect(source).toContain('class="app-shell-map-hit-through-pane"');
		expect(source).toMatch(/\.app-shell-row\s*\{[\s\S]*position:\s*relative;/);
		expect(source).toMatch(/\.app-shell-main\s*\{[\s\S]*position:\s*absolute;[\s\S]*inset:\s*0;/);
		expect(source).toMatch(
			/\.app-shell-main:not\(:has\(:global\(\.map-hero\)\)\)\s*\{[\s\S]*padding-left:\s*var\(--app-left-rail-offset, 0px\);/,
		);
		expect(source).toMatch(
			/:global\(\.app-shell-rail-overlay\)\s*\{[\s\S]*position:\s*absolute;[\s\S]*pointer-events:\s*none;/,
		);
		expect(source).toMatch(
			/:global\(\.app-shell-left-rail-pane\),[\s\S]*:global\(\.app-shell-rail-resize-handle\)\s*\{[\s\S]*pointer-events:\s*auto;/,
		);
	});
});
