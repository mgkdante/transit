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

	it('keeps the persistent chrome rail in ONE stable DOM, switched by CSS not a JS isDesktop branch', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/shell/AppShell.svelte'),
			'utf-8',
		);

		// The flash-causing structural re-branch is GONE: no `{#if layout.isDesktop}`
		// (or `{#if isDesktop}`) wraps the chrome, and the resizable-pane machinery the
		// old desktop branch built is removed wholesale. The rail's EXISTENCE is no
		// longer gated on the (SSR-false, hydration-flipping) layout store.
		expect(source).not.toContain('$lib/components/ui/resizable');
		expect(source).not.toContain('ResizablePaneGroup');
		expect(source).not.toContain('ResizablePane');
		expect(source).not.toContain('ResizableHandle');
		expect(source).not.toContain("from 'paneforge'");
		expect(source).not.toContain('{#if isDesktop}');
		expect(source).not.toContain('const isDesktop = $derived(layout.isDesktop)');
		// No percent-sized pane state survives.
		expect(source).not.toContain('leftRailSize');
		expect(source).not.toContain('leftRailPane');
		expect(source).not.toContain('LEFT_RAIL_DEFAULT_SIZE');
		expect(source).not.toContain('syncLeftRailVisualState');
		expect(source).not.toContain('onLeftRailCollapse');
		expect(source).not.toContain('onLeftRailExpand');

		// The rail rides ONE overlay column, ALWAYS rendered (no isDesktop gate on its
		// markup), and its collapse is a pure local toggle that flips a data attribute.
		expect(source).toContain('class="app-shell-rail-overlay"');
		expect(source).toContain("data-rail-collapsed={leftRailCollapsed ? 'true' : 'false'}");
		expect(source).toContain('function toggleLeftRailCollapsed(): void');
		expect(source).toContain('leftRailCollapsed = !leftRailCollapsed');
	});

	it('drives the desktop-rail vs mobile-burger presentation purely by @media, correct on first paint', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/shell/AppShell.svelte'),
			'utf-8',
		);

		// The map stage is the stable full-bleed base; the rail overlay floats over it.
		expect(source).toContain(
			'class="app-shell-main relative min-w-0 flex-1 overflow-hidden bg-surface-0"',
		);
		expect(source).toMatch(/\.app-shell-row\s*\{[\s\S]*position:\s*relative;/);
		expect(source).toMatch(/\.app-shell-main\s*\{[\s\S]*position:\s*absolute;[\s\S]*inset:\s*0;/);

		// The rail offset the map chrome reads is a CSS variable (NOT a JS percent), so
		// it is correct in the FIRST paint. Default 0px (rail hidden below the
		// breakpoint), then the rail width at >=1024px, narrowing under data-rail-collapsed.
		expect(source).not.toContain('--app-left-rail-offset: ${');
		expect(source).toMatch(/\.app-shell-row\s*\{[\s\S]*--app-left-rail-offset:\s*0px;/);
		expect(source).toMatch(
			/\.app-shell-main:not\(:has\(:global\(\.map-hero\)\)\)\s*\{[\s\S]*padding-left:\s*var\(--app-left-rail-offset, 0px\);/,
		);

		// The rail overlay is in the DOM but display:none below the breakpoint, revealed
		// purely by @media (min-width:1024px) — never a {#if isDesktop} flip.
		expect(source).toMatch(/\.app-shell-rail-overlay\s*\{[\s\S]*display:\s*none;/);
		expect(source).toMatch(
			/@media \(min-width: 1024px\)\s*\{[\s\S]*\.app-shell-rail-overlay\s*\{[\s\S]*display:\s*block;/,
		);
		expect(source).toMatch(
			/@media \(min-width: 1024px\)\s*\{[\s\S]*--app-left-rail-offset:\s*var\(--app-rail-width-expanded\);/,
		);
		expect(source).toMatch(
			/\.app-shell-row\[data-rail-collapsed='true'\]\s*\{[\s\S]*--app-left-rail-offset:\s*var\(--app-rail-width-collapsed\);/,
		);
	});

	it('makes the expanded rail DRAGGABLE via an overlay handle that resizes only the CSS var, never the map', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/shell/AppShell.svelte'),
			'utf-8',
		);

		// The drag is a thin right-edge separator handle INSIDE the rail overlay (not a
		// paneforge pane — the rail never takes map layout). It is absent when collapsed
		// (the icon strip is fixed-width), and carries separator a11y + keyboard resize.
		expect(source).not.toContain('ResizableHandle');
		expect(source).toContain('class="app-shell-rail-handle"');
		expect(source).toMatch(/\{#if !leftRailCollapsed\}[\s\S]*app-shell-rail-handle/);
		expect(source).toContain('role="separator"');
		expect(source).toContain('onpointerdown={onRailHandlePointerDown}');
		expect(source).toContain('onkeydown={onRailHandleKeyDown}');

		// Dragging writes a CLAMPED px width into --app-rail-width-expanded on the row
		// element — the SAME var the desktop offset + overlay width read — so the rail
		// and the map chrome offset follow, but the map CANVAS (which sizes off its own
		// container, never the rail width) is mathematically untouched. The chosen width
		// persists across reloads.
		expect(source).toContain("rowEl?.style.setProperty('--app-rail-width-expanded'");
		expect(source).toContain('clampLeftRailWidth(');
		expect(source).toContain('readStoredLeftRailWidth()');
		expect(source).toContain('writeStoredLeftRailWidth(railWidthPx)');
		// The drag suppresses the width transition so the rail tracks the pointer 1:1.
		expect(source).toMatch(
			/\.app-shell-row\[data-rail-dragging='true'\]\s*\.app-shell-rail-overlay\s*\{[\s\S]*transition:\s*none;/,
		);
		// The handle is the map-detail-handle tone: idle --border, active --primary.
		expect(source).toMatch(/\.app-shell-rail-handle\s*\{[\s\S]*cursor:\s*col-resize;/);
		expect(source).toMatch(/\.app-shell-rail-handle\s*\{[\s\S]*background:\s*var\(--border\);/);
	});
});
