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
		expect(queryByText('Sources')).toBeNull();
		expect(container.querySelectorAll('.toc-item').length).toBe(3);
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

	it('is user-collapsible by default: the heading is a disclosure trigger that folds the nav', async () => {
		const { container, getByText } = render(TocNav, {
			props: {
				entries,
				activeId: 'overview',
				onNavigate: () => {},
				heading: 'On this page',
			},
		});

		const headingEl = getByText('On this page');
		const trigger = headingEl.closest('[data-slot="collapsible-trigger"]');
		expect(trigger).not.toBeNull();

		const nav = container.querySelector('nav.toc-nav');
		expect(nav).not.toBeNull();
		expect(container.querySelector('[data-state="open"]')).not.toBeNull();

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
		expect(buttons.length).toBe(3);
		for (const btn of buttons) {
			expect(btn.classList.contains('toc-item')).toBe(true);
		}
	});
});

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

	function renderedOnCard(mode: Mode): string {
		if (!declaration) throw new Error('no color declaration found for .toc-counter-text');
		const plain = declaration.match(/^var\(--([a-z0-9-]+)\)$/);
		if (plain) return hex(mode, plain[1] as string);
		const mix = declaration.match(
			/^color-mix\(in srgb,\s*var\(--([a-z0-9-]+)\)\s*(\d+(?:\.\d+)?)%,\s*transparent\)$/,
		);
		if (mix) {
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
