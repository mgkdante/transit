// TocNav.test.ts - the desktop table-of-contents card.
//
// Gates: it renders every non-rail entry as a nav button (rail entries are
// excluded; they live in the desktop side rail), marks the active entry with
// aria-current, renders the "SEC N / total" counter, and calls onNavigate with
// the clicked entry id.

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeHexAccessor, ratio, type Mode } from '@yesid/gates';
import TocNav from './TocNav.svelte';
import type { TocEntry } from './toc';

const entries: TocEntry[] = [
	{
		id: 'overview',
		title: 'Overview',
		level: 2,
		badge: { kind: 'icon', name: 'eye' },
		children: [],
	},
	{
		id: 'reliability',
		title: 'Reliability',
		level: 2,
		badge: { kind: 'number', value: 1 },
		children: [{ id: 'on-time', title: 'On time', level: 3, children: [] }],
	},
	{ id: 'sources', title: 'Sources', level: 2, rail: true, children: [] },
];

describe('TocNav', () => {
	it('renders the heading and one button per non-rail entry (+ sub-items)', () => {
		const { getByText, queryByText, container } = render(TocNav, {
			props: {
				entries,
				activeId: 'overview',
				onNavigate: () => {},
				heading: 'On this page',
			},
		});
		expect(getByText('On this page')).toBeTruthy();
		expect(getByText('Overview')).toBeTruthy();
		expect(getByText('Reliability')).toBeTruthy();
		expect(getByText('On time')).toBeTruthy();
		// rail:true entry is excluded from the desktop nav.
		expect(queryByText('Sources')).toBeNull();
		expect(container.querySelectorAll('.toc-item').length).toBe(3); // 2 parents + 1 sub
	});

	it('marks the active entry with aria-current="location"', () => {
		const { getByText } = render(TocNav, {
			props: {
				entries,
				activeId: 'reliability',
				onNavigate: () => {},
				heading: 'On this page',
			},
		});
		const active = getByText('Reliability').closest('button');
		expect(active?.getAttribute('aria-current')).toBe('location');
	});

	it('renders the counter prefix + position', () => {
		const { getByText } = render(TocNav, {
			props: {
				entries,
				activeId: 'overview',
				onNavigate: () => {},
				heading: 'On this page',
				counterPrefix: 'SEC',
			},
		});
		// 3 flattened non-rail entries (overview, reliability, on-time); overview is #1.
		// Zero-padded to match the numbered section chips (P5.4f: this footer counter is
		// the rail's ONE position readout — SectionProgress was retired).
		expect(getByText(/SEC\s*01\s*\/\s*03/)).toBeTruthy();
	});

	it('keeps a gapped canonical number run aligned with its badges', () => {
		const gappedEntries: TocEntry[] = [
			{
				id: 'freshness',
				title: 'Freshness',
				level: 2,
				badge: { kind: 'number', value: 2 },
				children: [],
			},
			{
				id: 'envelope',
				title: 'Build accountability',
				level: 2,
				badge: { kind: 'number', value: 8 },
				children: [],
			},
		];
		const { getByText } = render(TocNav, {
			props: {
				entries: gappedEntries,
				activeId: 'freshness',
				onNavigate: () => {},
				heading: 'Jump to a section',
				counterPrefix: 'SEC',
			},
		});

		expect(getByText(/SEC\s*02\s*\/\s*08/)).toBeTruthy();
	});

	it('calls onNavigate with the entry id on click', async () => {
		const onNavigate = vi.fn();
		const { getByText } = render(TocNav, {
			props: {
				entries,
				activeId: 'overview',
				onNavigate,
				heading: 'On this page',
			},
		});
		await fireEvent.click(getByText('Reliability'));
		expect(onNavigate).toHaveBeenCalledWith('reliability');
	});

	// slice-9.8-B: the ToC rail is USER-COLLAPSIBLE by default — it owns its own
	// collapse affordance (a header disclosure trigger / chevron). This is the
	// reader's own toggle, DISTINCT from FOCUS/quiet (which collapses the section
	// CARDS, never the ToC). The page must never wire this toggle to its quiet
	// state; here we just assert the affordance exists and folds the nav.
	it('is user-collapsible by default: the heading is a disclosure trigger that folds the nav', async () => {
		const { container, getByText } = render(TocNav, {
			props: {
				entries,
				activeId: 'overview',
				onNavigate: () => {},
				heading: 'On this page',
			},
		});

		// The heading IS a collapsible disclosure trigger (its own chevron toggle).
		const headingEl = getByText('On this page');
		const trigger = headingEl.closest('[data-slot="collapsible-trigger"]');
		expect(trigger).not.toBeNull();

		// Open by default: the nav + its jump buttons are mounted and reachable.
		const nav = container.querySelector('nav.toc-nav');
		expect(nav).not.toBeNull();
		expect(container.querySelector('[data-state="open"]')).not.toBeNull();

		// Clicking the trigger folds the rail (the reader's own collapse affordance).
		await fireEvent.click(trigger as HTMLElement);
		expect(container.querySelector('[data-state="closed"]')).not.toBeNull();
	});

	it('accepts a bound open state and follows later prop changes', async () => {
		const props = {
			entries,
			activeId: 'overview',
			onNavigate: () => {},
			heading: 'On this page',
			open: false,
		};
		const { getByRole, rerender } = render(TocNav, { props });

		expect(getByRole('button', { name: 'On this page' })).toHaveAttribute('aria-expanded', 'false');

		await rerender({ ...props, open: true });
		expect(getByRole('button', { name: 'On this page' })).toHaveAttribute('aria-expanded', 'true');
	});

	// The non-hideable variant remains available (collapsible={false}): a caller
	// can still opt into a permanently-open rail with no disclosure trigger.
	it('renders a permanently-open, non-hideable rail when collapsible={false}', () => {
		const { container, getByText } = render(TocNav, {
			props: {
				entries,
				activeId: 'overview',
				onNavigate: () => {},
				heading: 'On this page',
				collapsible: false,
			},
		});

		const headingEl = getByText('On this page');
		expect(headingEl.closest('[data-slot="collapsible-trigger"]')).toBeNull();
		expect(container.querySelector('[data-slot="collapsible-trigger"]')).toBeNull();

		const nav = container.querySelector('nav.toc-nav');
		expect(nav).not.toBeNull();
		const buttons = container.querySelectorAll('button');
		// Exactly the 3 flattened non-rail jump buttons — no extra toggle button.
		expect(buttons.length).toBe(3);
		for (const btn of buttons) {
			expect(btn.classList.contains('toc-item')).toBe(true);
		}
	});
});

// B12 axe cure lock (2026-08-08): production /lines/24 (both locales) rendered
// the "SEC n / m" counter at `color-mix(in srgb, var(--primary) 30%, transparent)`
// — #553612 composited over the #1a1a1a card, contrast 1.59:1 against the 4.5:1
// floor for 12px normal text (axe color-contrast, serious). This unit resolves
// the counter's AUTHORED colour declaration through tools/tokens/tokens.json and
// computes its rendered contrast on the card surface with the gates math, in both
// themes, so the declaration can never dip below AA again.
describe('TocNav counter contrast (B12 axe cure lock)', () => {
	const source = readFileSync(
		resolve(process.cwd(), 'src/lib/components/shared/TocNav.svelte'),
		'utf-8',
	);
	const tokens = JSON.parse(
		readFileSync(resolve(process.cwd(), 'tools/tokens/tokens.json'), 'utf-8'),
	) as Record<string, unknown>;
	const hex = makeHexAccessor(tokens);

	const declaration = source.match(/\.toc-counter-text\s*\{[^}]*?color:\s*([^;]+);/s)?.[1]?.trim();

	/** Resolve the authored declaration to the hex the reader sees on the themed card. */
	function renderedOnCard(mode: Mode): string {
		if (!declaration) throw new Error('no color declaration found for .toc-counter-text');
		const plain = declaration.match(/^var\(--([a-z0-9-]+)\)$/);
		if (plain) return hex(mode, plain[1] as string);
		const mix = declaration.match(
			/^color-mix\(in srgb,\s*var\(--([a-z0-9-]+)\)\s*(\d+(?:\.\d+)?)%,\s*transparent\)$/,
		);
		if (mix) {
			// Alpha-composite the mixed token over the card, per channel — the same
			// flattening the browser (and axe) performs on the served page.
			const fg = hex(mode, mix[1] as string);
			const bg = hex(mode, 'card');
			const alpha = Number(mix[2]) / 100;
			const channel = (i: number) =>
				Math.round(
					alpha * parseInt(fg.slice(i, i + 2), 16) + (1 - alpha) * parseInt(bg.slice(i, i + 2), 16),
				)
					.toString(16)
					.padStart(2, '0');
			return `#${channel(1)}${channel(3)}${channel(5)}`;
		}
		throw new Error(`unresolvable .toc-counter-text color: ${declaration}`);
	}

	it('meets WCAG AA 4.5:1 on the dark card (the served surface axe measured)', () => {
		const fg = renderedOnCard('dark');
		const r = ratio(fg, hex('dark', 'card'));
		expect(r, `${fg} on dark card computed ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
	});

	it('meets WCAG AA 4.5:1 on the light card', () => {
		const fg = renderedOnCard('light');
		const r = ratio(fg, hex('light', 'card'));
		expect(r, `${fg} on light card computed ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
	});
});
