// DetailShell.svelte.test.ts — DOM + source gate for the ONE detail-page shell (P5.4c).
//
// Guards: the header rides the full-bleed `.detail-header-grid` band; the hazard tape
// closes it; all slots render in their wrapper zones; the grid is 2-col without a right
// rail and `1fr 2fr 1fr` (gap 2rem, 2.5rem block padding) at the yesid 1024 breakpoint;
// the rails are sticky off the single --chrome-offset knob (never a literal); the mobile
// summary strip is opt-in; and the floating TocPill renders only when there are entries.
// Layout + wiring only — no data-mark assertions.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import DetailShell from './DetailShell.svelte';
import type { TocEntry } from '$lib/components/shared/toc';

const mk = (id: string) =>
	createRawSnippet(() => ({ render: () => `<div data-testid="${id}">${id}</div>` }));

const OPEN_ARIA = 'TOC-OPEN-TEST';
const CLOSE_ARIA = 'TOC-CLOSE-TEST';
const entries: TocEntry[] = [{ id: 'sec-a', title: 'Section A', level: 2, children: [] }];

const baseProps = {
	header: mk('header'),
	left: mk('left'),
	center: mk('center'),
	right: mk('right'),
	mobileSummary: mk('summary'),
	tocEntries: entries,
	onNavigate: () => {},
	tocOpenAria: OPEN_ARIA,
	tocCloseAria: CLOSE_ARIA,
};

const src = () =>
	readFileSync(resolve(process.cwd(), 'src/lib/components/layout/DetailShell.svelte'), 'utf-8');

describe('DetailShell — slots render in their zones', () => {
	it('renders header inside the full-bleed dot-grid band', () => {
		const { container } = render(DetailShell, { props: baseProps });
		const band = container.querySelector('[data-slot="detail-shell-header"]');
		expect(band?.classList.contains('detail-header-grid')).toBe(true);
		expect(band?.querySelector('[data-testid="header"]')).not.toBeNull();
	});

	it('renders left, center and right into their wrapper elements', () => {
		const { container } = render(DetailShell, { props: baseProps });
		const left = container.querySelector('[data-slot="detail-shell-left"]');
		expect(left?.tagName.toLowerCase()).toBe('aside');
		expect(left?.querySelector('[data-testid="left"]')).not.toBeNull();
		expect(
			container.querySelector('[data-slot="detail-shell-center"] [data-testid="center"]'),
		).not.toBeNull();
		const right = container.querySelector('[data-slot="detail-shell-right"]');
		expect(right?.tagName.toLowerCase()).toBe('aside');
		expect(right?.querySelector('[data-testid="right"]')).not.toBeNull();
	});

	it('renders the mobile summary strip when provided, omits it when absent', () => {
		const { container } = render(DetailShell, { props: baseProps });
		expect(
			container.querySelector('[data-slot="detail-shell-mobile-summary"] [data-testid="summary"]'),
		).not.toBeNull();

		const { mobileSummary: _drop, ...rest } = baseProps;
		const { container: c2 } = render(DetailShell, { props: rest });
		expect(c2.querySelector('[data-slot="detail-shell-mobile-summary"]')).toBeNull();
	});

	it('is a 2-column grid (no right rail) when the right snippet is absent', () => {
		const { right: _drop, ...rest } = baseProps;
		const { container } = render(DetailShell, { props: rest });
		const grid = container.querySelector('.detail-shell-grid');
		expect(grid?.classList.contains('detail-shell-grid--two')).toBe(true);
		expect(container.querySelector('[data-slot="detail-shell-right"]')).toBeNull();
	});
});

describe('DetailShell — hazard tape + floating pill', () => {
	it('closes the header with an edge-to-edge hazard Separator', () => {
		const { container } = render(DetailShell, { props: baseProps });
		// The Separator lands after the header band; it carries the shell tape class.
		expect(container.querySelector('.detail-shell-tape')).not.toBeNull();
	});

	it('renders the floating TocPill when there are entries', () => {
		const { container } = render(DetailShell, { props: baseProps });
		expect(container.querySelector(`button[aria-label*="${OPEN_ARIA}"]`)).not.toBeNull();
	});

	it('omits the TocPill when there are no entries', () => {
		const { container } = render(DetailShell, { props: { ...baseProps, tocEntries: [] } });
		expect(container.querySelector(`button[aria-label*="${OPEN_ARIA}"]`)).toBeNull();
	});
});

describe('DetailShell — grid + sticky (source contract)', () => {
	it('is a 1fr 2fr 1fr grid at 2rem gap / 2.5rem block padding on the ≥1024 breakpoint', () => {
		const s = src();
		expect(s).toMatch(/@media\s*\(min-width:\s*1024px\)/);
		expect(s).toMatch(
			/\.detail-shell-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr\s+2fr\s+1fr[\s\S]*?gap:\s*2rem[\s\S]*?padding-block:\s*2\.5rem/,
		);
	});

	it('parks the rails sticky off the single --chrome-offset knob (never a literal)', () => {
		const s = src();
		expect(s).toMatch(/position:\s*sticky[\s\S]*?top:\s*var\(--chrome-offset\)/);
		expect(s).not.toMatch(/top:\s*5(\.5)?rem/);
	});
});
