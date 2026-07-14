// SurfaceRail.svelte.test.ts — the map-style glass left rail + merged mobile sheet (P5.4).
//
// Guards: the desktop glass rail renders the `rail` snippet; the mobile pill is a labelled
// disclosure (closed by default); tapping it opens ONE sheet (role="dialog") that renders the
// SAME rail content (grain/filters + ToC together — one menu); a ToC jump link auto-closes the
// sheet while a filter tap does not; Escape closes.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, fireEvent } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import SurfaceRail from './SurfaceRail.svelte';

const source = readFileSync(
	resolve(process.cwd(), 'src/lib/components/surface/SurfaceRail.svelte'),
	'utf-8',
);

// The rail content: a filter button + a ToC jump link, so we can prove the sheet renders both
// and that a link closes the sheet while the button does not. The snippet receives the shared
// rail context (unused here; the seam and presentation tests below inspect it).
const rail = createRawSnippet(() => ({
	render: () =>
		`<div data-testid="rail-body">
			<button type="button" data-testid="rail-filter">Day</button>
			<nav data-slot="section-toc"><a href="#sec-a" data-testid="rail-jump">Section A</a></nav>
		</div>`,
}));

// A rail that wires the snippet's { closeSheet } param onto a component-style ToC button —
// the EXPLICIT dismissal seam TocNav consumers use (onNavigate → closeSheet), replacing the
// old private `.toc-item` class sniffing.
const railWithSeam = createRawSnippet<
	[{ closeSheet: () => void; presentation: 'desktop' | 'mobile' }]
>((getArgs) => ({
	render: () =>
		`<div data-testid="rail-body">
			<button type="button" data-testid="rail-seam-jump">Section A</button>
		</div>`,
	setup: (el) => {
		const btn = el.querySelector('[data-testid="rail-seam-jump"]') as HTMLButtonElement;
		btn.addEventListener('click', () => getArgs().closeSheet());
	},
}));

const baseProps = {
	rail,
	label: 'View',
	summary: 'TODAY',
	openAria: 'Open controls',
	closeAria: 'Close controls',
};

describe('SurfaceRail — desktop glass rail', () => {
	it('keeps direct rail children at natural height while the outer rail owns vertical scrolling', () => {
		const desktopRailRule = Array.from(
			source.matchAll(/\.surface-rail\s*\{([\s\S]*?)\}/g),
			([, rule]) => rule,
		).find((rule) => /^\s*overflow-y\s*:/m.test(rule)) ?? '';
		const directChildRule =
			source.match(/\.surface-rail\s*>\s*:global\(\*\)\s*\{([\s\S]*?)\}/)?.[1] ?? '';
		const overflowY = Array.from(
			desktopRailRule.matchAll(/^\s*overflow-y\s*:\s*([^;]+)\s*;/gm),
			([, value]) => value.trim(),
		);

		expect(overflowY).toEqual(['auto']);
		expect(desktopRailRule).not.toMatch(/^\s*overflow\s*:[^;]*(?:hidden|clip)[^;]*;/m);
		expect(desktopRailRule).not.toMatch(/^\s*height\s*:/m);
		expect(directChildRule).toMatch(/(?:^|[;\s])(?:flex:\s*none|flex-shrink:\s*0)\s*;/);
	});

	it('renders the rail content in the sticky aside', () => {
		const { container } = render(SurfaceRail, { props: baseProps });
		const aside = container.querySelector('[data-slot="surface-rail"]');
		expect(aside?.tagName.toLowerCase()).toBe('aside');
		expect(aside?.querySelector('[data-testid="rail-body"]')).not.toBeNull();
	});

	it('identifies the always-mounted rail as desktop and the sheet copy as mobile', async () => {
		const received: Array<{
			closeSheet: () => void;
			presentation: 'desktop' | 'mobile';
		}> = [];
		const contextualRail = createRawSnippet<
			[{ closeSheet: () => void; presentation: 'desktop' | 'mobile' }]
		>((getArgs) => ({
			render: () => {
				received.push({ ...getArgs() });
				return '<div data-testid="contextual-rail"></div>';
			},
		}));
		const { container } = render(SurfaceRail, {
			props: { ...baseProps, rail: contextualRail },
		});

		expect(received.map(({ presentation }) => presentation)).toEqual(['desktop']);

		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		await fireEvent.click(mobile.querySelector(':scope > button') as HTMLButtonElement);
		expect(received.map(({ presentation }) => presentation)).toEqual(['desktop', 'mobile']);
	});
});

describe('SurfaceRail — mobile pill + merged sheet', () => {
	it('keeps direct sheet children at natural height while the sheet owns vertical scrolling', () => {
		const sheetRule = source.match(/\.surface-rail-sheet\s*\{([\s\S]*?)\}/)?.[1] ?? '';
		const directChildRule =
			source.match(/\.surface-rail-sheet\s*>\s*:global\(\*\)\s*\{([\s\S]*?)\}/)?.[1] ?? '';
		const overflowY = Array.from(
			sheetRule.matchAll(/^\s*overflow-y\s*:\s*([^;]+)\s*;/gm),
			([, value]) => value.trim(),
		);

		expect(overflowY).toEqual(['auto']);
		expect(sheetRule).not.toMatch(/^\s*overflow\s*:[^;]*(?:hidden|clip)[^;]*;/m);
		expect(sheetRule).not.toMatch(/^\s*height\s*:/m);
		expect(directChildRule).toMatch(/(?:^|[;\s])(?:flex:\s*none|flex-shrink:\s*0)\s*;/);
	});

	it('labels the pill with the heading + summary, and the sheet is closed by default', () => {
		const { container } = render(SurfaceRail, { props: baseProps });
		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		const pill = mobile.querySelector('button') as HTMLButtonElement;
		expect(pill.getAttribute('aria-expanded')).toBe('false');
		expect(pill.textContent).toContain('View');
		expect(pill.textContent).toContain('TODAY');
		expect(mobile.querySelector('[role="dialog"]')).toBeNull();
	});

	it('opens ONE sheet with the SAME rail content (grain + ToC together) on tap', async () => {
		const { container } = render(SurfaceRail, { props: baseProps });
		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		const pill = mobile.querySelector('button') as HTMLButtonElement;
		await fireEvent.click(pill);
		expect(pill.getAttribute('aria-expanded')).toBe('true');
		const sheet = mobile.querySelector('[role="dialog"]') as HTMLElement;
		expect(sheet).not.toBeNull();
		// The sheet renders the caller's rail content — the filter AND the ToC in one menu.
		expect(sheet.querySelector('[data-testid="rail-filter"]')).not.toBeNull();
		expect(sheet.querySelector('[data-slot="section-toc"]')).not.toBeNull();
	});

	it('a ToC jump link closes the sheet; a filter tap leaves it open', async () => {
		const { container } = render(SurfaceRail, { props: baseProps });
		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		const pill = mobile.querySelector('button') as HTMLButtonElement;

		await fireEvent.click(pill);
		// A filter tap does NOT close the sheet (filters can be changed freely).
		await fireEvent.click(mobile.querySelector('[data-testid="rail-filter"]') as HTMLElement);
		expect(mobile.querySelector('[role="dialog"]')).not.toBeNull();
		expect(document.activeElement).toBe(
			mobile.querySelector('[data-testid="rail-filter"]') as HTMLElement,
		);

		// A ToC jump link (in-page #anchor) DOES close the sheet so the reader lands on the section.
		await fireEvent.click(mobile.querySelector('[data-testid="rail-jump"]') as HTMLElement);
		expect(mobile.querySelector('[role="dialog"]')).toBeNull();
		expect(document.activeElement).toBe(pill);
	});

	it('a component ToC tap dismisses the sheet through the explicit closeSheet seam', async () => {
		const { container } = render(SurfaceRail, { props: { ...baseProps, rail: railWithSeam } });
		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		const pill = mobile.querySelector('button') as HTMLButtonElement;

		await fireEvent.click(pill);
		expect(mobile.querySelector('[role="dialog"]')).not.toBeNull();

		// The seam button is a plain <button> (NOT an #anchor, NOT any special class) —
		// only the snippet-param wiring closes the sheet, proving the seam is explicit.
		const sheet = mobile.querySelector('[role="dialog"]') as HTMLElement;
		await fireEvent.click(sheet.querySelector('[data-testid="rail-seam-jump"]') as HTMLElement);
		expect(mobile.querySelector('[role="dialog"]')).toBeNull();
		expect(document.activeElement).toBe(pill);
	});

	it('Escape closes the open sheet', async () => {
		const { container } = render(SurfaceRail, { props: baseProps });
		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		const pill = mobile.querySelector('button') as HTMLButtonElement;
		await fireEvent.click(pill);
		expect(mobile.querySelector('[role="dialog"]')).not.toBeNull();
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(mobile.querySelector('[role="dialog"]')).toBeNull();
	});
});
