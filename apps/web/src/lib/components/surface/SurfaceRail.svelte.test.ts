// SurfaceRail.svelte.test.ts — the shared bare desktop rail + merged mobile sheet (P5.4).
//
// Guards: the desktop rail renders the `rail` snippet without page-local card chrome; the mobile pill is a labelled
// disclosure (closed by default); tapping it opens ONE sheet (role="dialog") that renders the
// SAME rail content (grain/filters + ToC together — one menu); a ToC jump link auto-closes the
// sheet while a filter tap does not; Escape closes.

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, fireEvent, waitFor, within } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { responsiveLayoutHarness } from './__fixtures__/ResponsiveLayoutHarness.svelte';

vi.mock('$lib/nav/layout.svelte', async () => ({
	layout: (await import('./__fixtures__/ResponsiveLayoutHarness.svelte')).responsiveLayoutHarness,
}));

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

beforeEach(() => responsiveLayoutHarness.setDesktop(false));
afterEach(() => document.body.style.removeProperty('overflow'));

describe('SurfaceRail — desktop article rail', () => {
	it('matches the yesid article/listing system with a bare no-glow desktop rail', () => {
		const openingTag = source.match(/<aside[\s\S]*?>/)?.[0] ?? '';
		const desktopRule =
			Array.from(source.matchAll(/\.surface-rail\s*\{([\s\S]*?)\}/g), ([, rule]) => rule).find(
				(rule) => /^\s*overflow-y\s*:/m.test(rule),
			) ?? '';

		expect(openingTag).not.toMatch(/glass-chrome/);
		expect(desktopRule).not.toMatch(
			/(?:background|border(?:-radius)?|box-shadow|backdrop-filter|padding)\s*:/,
		);
		expect(desktopRule).toMatch(/gap:\s*1rem/);
	});

	it('keeps direct rail children at natural height while the outer rail owns vertical scrolling', () => {
		const desktopRailRule =
			Array.from(source.matchAll(/\.surface-rail\s*\{([\s\S]*?)\}/g), ([, rule]) => rule).find(
				(rule) => /^\s*overflow-y\s*:/m.test(rule),
			) ?? '';
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

	it('mounts one rail body whose presentation follows the viewport', async () => {
		responsiveLayoutHarness.setDesktop(true);
		let mountCount = 0;
		const received: Array<'desktop' | 'mobile'> = [];
		const contextualRail = createRawSnippet<
			[{ closeSheet: () => void; presentation: 'desktop' | 'mobile' }]
		>((getArgs) => ({
			render: () => {
				mountCount += 1;
				return '<div><button type="button" data-testid="contextual-rail">Read context</button></div>';
			},
			setup: (el) => {
				el.querySelector('[data-testid="contextual-rail"]')?.addEventListener('click', () => {
					received.push(getArgs().presentation);
				});
			},
		}));
		const { container } = render(SurfaceRail, {
			props: { ...baseProps, rail: contextualRail },
		});
		const railBody = container.querySelector('[data-testid="contextual-rail"]') as HTMLElement;

		await fireEvent.click(railBody);
		expect(received).toEqual(['desktop']);
		expect(mountCount).toBe(1);

		responsiveLayoutHarness.setDesktop(false);
		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		await fireEvent.click(mobile.querySelector(':scope > button') as HTMLButtonElement);
		const dialog = mobile.querySelector('[role="dialog"]') as HTMLElement;

		expect(dialog.querySelector('[data-testid="contextual-rail"]')).toBe(railBody);
		expect(container.querySelectorAll('[data-testid="contextual-rail"]')).toHaveLength(1);
		await fireEvent.click(railBody);
		expect(received).toEqual(['desktop', 'mobile']);
		expect(mountCount).toBe(1);
	});
});

describe('SurfaceRail — mobile pill + merged sheet', () => {
	it('can hide only the mobile presentation while preserving the desktop rail body', () => {
		const { container } = render(SurfaceRail, {
			props: { ...baseProps, mobileVisible: false },
		});

		expect(container.querySelector('[data-slot="surface-rail-mobile"]')).toBeNull();
		const aside = container.querySelector('[data-slot="surface-rail"]');
		expect(aside).not.toBeNull();
		expect(aside?.querySelector('[data-testid="rail-body"]')).not.toBeNull();
	});

	it('closes an open sheet when its mobile presentation becomes hidden', async () => {
		document.body.style.overflow = 'auto';
		const view = render(SurfaceRail, { props: baseProps });
		const mobile = view.container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		await fireEvent.click(mobile.querySelector('button[aria-expanded]') as HTMLButtonElement);
		expect(document.body.style.overflow).toBe('hidden');

		await view.rerender({ ...baseProps, mobileVisible: false });

		expect(view.container.querySelector('[data-slot="surface-rail-mobile"]')).toBeNull();
		expect(document.body.style.overflow).toBe('auto');
		expect(
			view.container.querySelector('[data-slot="surface-rail"] [data-testid="rail-body"]'),
		).not.toBeNull();
	});

	it('closes the sheet and moves focus into the desktop rail when crossing 1024px', async () => {
		responsiveLayoutHarness.setDesktop(false);
		const { container } = render(SurfaceRail, { props: baseProps });
		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		const pill = mobile.querySelector(':scope > button') as HTMLButtonElement;

		await fireEvent.click(pill);
		const sheet = mobile.querySelector('[role="dialog"]') as HTMLElement;
		const mobileFilter = within(sheet).getByTestId('rail-filter');
		mobileFilter.focus();
		expect(mobileFilter).toHaveFocus();

		responsiveLayoutHarness.setDesktop(true);

		await waitFor(() => expect(mobile.querySelector('[role="dialog"]')).toBeNull());
		const desktopRail = container.querySelector('[data-slot="surface-rail"]') as HTMLElement;
		expect(within(desktopRail).getByTestId('rail-filter')).toHaveFocus();
		responsiveLayoutHarness.setDesktop(false);
	});

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
		expect(pill).toHaveAccessibleName('View TODAY · Open controls');
		expect(mobile.querySelector('[role="dialog"]')).toBeNull();
	});

	it('opens one sheet by moving the existing rail content into it', async () => {
		const { container } = render(SurfaceRail, { props: baseProps });
		const railBody = container.querySelector('[data-testid="rail-body"]') as HTMLElement;
		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		const pill = mobile.querySelector('button') as HTMLButtonElement;
		await fireEvent.click(pill);
		expect(pill.getAttribute('aria-expanded')).toBe('true');
		expect(pill).toHaveAccessibleName('View TODAY · Close controls');
		const sheet = mobile.querySelector('[role="dialog"]') as HTMLElement;
		expect(sheet).not.toBeNull();
		expect(sheet).toHaveAttribute('aria-modal', 'true');
		expect(sheet).toHaveAccessibleName('View');
		// The dialog receives the already-mounted caller content rather than creating a copy.
		expect(sheet.querySelector('[data-testid="rail-body"]')).toBe(railBody);
		expect(container.querySelectorAll('[data-testid="rail-body"]')).toHaveLength(1);
		expect(sheet.querySelector('[data-testid="rail-filter"]')).not.toBeNull();
		expect(sheet.querySelector('[data-slot="section-toc"]')).not.toBeNull();
	});

	it('traps focus inside the modal sheet and marks the background inert', async () => {
		const { container } = render(SurfaceRail, { props: baseProps });
		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		const pill = mobile.querySelector('button[aria-expanded]') as HTMLButtonElement;

		await fireEvent.click(pill);
		const dialog = mobile.querySelector('[role="dialog"]') as HTMLElement;
		const first = within(dialog).getByTestId('rail-filter');
		const last = within(dialog).getByTestId('rail-jump');

		await waitFor(() => expect(first).toHaveFocus());
		expect(pill).toHaveAttribute('inert');

		last.focus();
		await fireEvent.keyDown(document, { key: 'Tab' });
		expect(first).toHaveFocus();

		await fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
		expect(last).toHaveFocus();
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

	it('locks background scrolling until the backdrop dismisses the sheet', async () => {
		document.body.style.overflow = 'auto';
		const { container } = render(SurfaceRail, { props: baseProps });
		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		const pill = mobile.querySelector('button[aria-expanded]') as HTMLButtonElement;

		await fireEvent.click(pill);
		expect(document.body.style.overflow).toBe('hidden');

		await fireEvent.click(mobile.querySelector('.surface-rail-backdrop') as HTMLButtonElement);
		expect(mobile.querySelector('[role="dialog"]')).toBeNull();
		expect(document.body.style.overflow).toBe('auto');
		expect(pill).toHaveFocus();
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
