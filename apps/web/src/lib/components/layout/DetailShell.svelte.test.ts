// DetailShell.svelte.test.ts — DOM + source gate for the ONE detail-page shell (P5.4c).
//
// Guards: the header rides the full-bleed `.detail-header-grid` band; the hazard tape
// closes it; all slots render in their wrapper zones; the grid is 2-col without a right
// rail and `1fr 2fr 1fr` (gap 2rem, 2.5rem block padding) at the yesid 1024 breakpoint;
// the rails are sticky off the single --chrome-offset knob (never a literal); the mobile
// summary strip is opt-in; and the floating TocPill renders only when there are entries.
// Layout + wiring only — no data-mark assertions.

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';

const tocObserver = vi.hoisted(() => ({
	observe: vi.fn(),
	cleanups: [] as ReturnType<typeof vi.fn>[],
}));

vi.mock('$lib/components/shared/toc', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/components/shared/toc')>();
	return { ...actual, observeActiveToc: tocObserver.observe };
});

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

const combinedRail = createRawSnippet<[{ closeSheet: () => void }]>((getArgs) => ({
	render: () =>
		`<div data-testid="combined-rail">
			<button type="button" data-testid="combined-control">Weekday</button>
			<nav data-slot="section-toc">
				<a href="#sec-a" data-testid="combined-jump">Section A</a>
			</nav>
			<button type="button" data-testid="combined-seam-jump">Close and jump</button>
		</div>`,
	setup: (el) => {
		const button = el.querySelector('[data-testid="combined-seam-jump"]') as HTMLButtonElement;
		button.addEventListener('click', () => getArgs().closeSheet());
	},
}));

const combinedRailConfig = {
	label: 'Article controls',
	summary: 'Weekday · Section A',
	openAria: 'Open article controls',
	closeAria: 'Close article controls',
	class: 'article-controls',
};

const combinedProps = {
	header: mk('header'),
	center: mk('center'),
	right: mk('right'),
	mobileSummary: mk('summary'),
	tocEntries: entries,
	combinedRail,
	combinedRailConfig,
};

const src = () =>
	readFileSync(resolve(process.cwd(), 'src/lib/components/layout/DetailShell.svelte'), 'utf-8');

beforeEach(() => {
	tocObserver.cleanups = [];
	tocObserver.observe.mockReset();
	tocObserver.observe.mockImplementation(() => {
		const cleanup = vi.fn();
		tocObserver.cleanups.push(cleanup);
		return cleanup;
	});
});

describe('DetailShell — slots render in their zones', () => {
	it('lets articleHeader replace the default band while preserving tape and body slots', () => {
		const { container } = render(DetailShell, {
			props: { ...baseProps, articleHeader: mk('article-header') },
		});

		expect(container.querySelector('[data-testid="article-header"]')).not.toBeNull();
		expect(container.querySelector('[data-slot="detail-shell-header"]')).toBeNull();
		expect(container.querySelector('.detail-shell-tape')).not.toBeNull();
		expect(
			container.querySelector('[data-slot="detail-shell-left"] [data-testid="left"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[data-slot="detail-shell-center"] [data-testid="center"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[data-slot="detail-shell-right"] [data-testid="right"]'),
		).not.toBeNull();
	});

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

describe('DetailShell — opt-in combined rail', () => {
	it('renders the named rail snippet inside one desktop SurfaceRail', () => {
		const { container } = render(DetailShell, { props: combinedProps });
		const rails = container.querySelectorAll('[data-slot="surface-rail"]');

		expect(rails).toHaveLength(1);
		expect(rails[0]?.getAttribute('aria-label')).toBe(combinedRailConfig.label);
		expect(rails[0]?.querySelector('[data-testid="combined-rail"]')).not.toBeNull();
	});

	it('uses one center column when the combined rail config is absent', () => {
		const { container } = render(DetailShell, {
			props: { ...combinedProps, right: undefined, combinedRailConfig: undefined },
		});
		const grid = container.querySelector('.detail-shell-grid');

		expect(container.querySelector('[data-slot="surface-rail"]')).toBeNull();
		expect(container.querySelector('[data-slot="surface-rail-mobile"]')).toBeNull();
		expect(grid).toHaveClass('detail-shell-grid--single');
		expect(grid).not.toHaveClass('detail-shell-grid--two');
		expect(
			container.querySelector('[data-slot="detail-shell-center"] [data-testid="center"]'),
		).not.toBeNull();
		expect(src()).toMatch(
			/@media\s*\(min-width:\s*1024px\)[\s\S]*?\.detail-shell-grid--single\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
		);
	});

	it('omits the legacy left-rail wrapper', () => {
		const { container } = render(DetailShell, { props: combinedProps });

		expect(container.querySelector('[data-slot="detail-shell-left"]')).toBeNull();
	});

	it('suppresses the legacy TocPill even when tocEntries are non-empty', () => {
		const { container } = render(DetailShell, { props: combinedProps });

		expect(combinedProps.tocEntries).not.toHaveLength(0);
		expect(container.querySelector('[data-testid="toc-pill"]')).toBeNull();
	});

	it('renders exactly one mobile SurfaceRail presentation', () => {
		const { container } = render(DetailShell, { props: combinedProps });

		expect(container.querySelectorAll('[data-slot="surface-rail-mobile"]')).toHaveLength(1);
	});

	it('opens one dialog containing both a real control and a ToC jump', async () => {
		const { container } = render(DetailShell, { props: combinedProps });
		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		const pill = mobile.querySelector('button[aria-expanded]') as HTMLButtonElement;

		await fireEvent.click(pill);

		const dialogs = container.querySelectorAll('[role="dialog"]');
		expect(dialogs).toHaveLength(1);
		expect(dialogs[0]?.querySelector('[data-testid="combined-control"]')).not.toBeNull();
		expect(dialogs[0]?.querySelector('[data-testid="combined-jump"]')).not.toBeNull();
	});

	it('closes the mobile dialog through the snippet closeSheet callback', async () => {
		const { container } = render(DetailShell, { props: combinedProps });
		const mobile = container.querySelector('[data-slot="surface-rail-mobile"]') as HTMLElement;
		const pill = mobile.querySelector('button[aria-expanded]') as HTMLButtonElement;

		await fireEvent.click(pill);
		const dialog = mobile.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog).not.toBeNull();

		await fireEvent.click(
			dialog.querySelector('[data-testid="combined-seam-jump"]') as HTMLButtonElement,
		);
		expect(mobile.querySelector('[role="dialog"]')).toBeNull();
	});

	it('keeps the legacy left snippet aside and TocPill unchanged', () => {
		const { container } = render(DetailShell, { props: baseProps });
		const left = container.querySelector('[data-slot="detail-shell-left"]');

		expect(left?.tagName.toLowerCase()).toBe('aside');
		expect(left?.querySelector('[data-testid="left"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="toc-pill"]')).not.toBeNull();
		expect(container.querySelector('[data-slot="surface-rail"]')).toBeNull();
	});
});

describe('DetailShell — dynamic ToC observation', () => {
	it('reconnects observation after conditional targets appear', async () => {
		const { rerender } = render(DetailShell, {
			props: { ...baseProps, tocEntries: [] },
		});
		await waitFor(() => expect(tocObserver.observe).toHaveBeenCalledTimes(1));
		const firstCleanup = tocObserver.cleanups[0];

		await rerender({ ...baseProps, tocEntries: entries });
		await tick();

		await waitFor(() => expect(tocObserver.observe).toHaveBeenCalledTimes(2));
		expect(firstCleanup).toHaveBeenCalledTimes(1);
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
