// DetailTemplate.svelte.test.ts — DOM + source gate for the 3-column detail shell (§C2.6).
//
// Guards: all four slots render in their wrapper zones; mobile source order is
// head → summary strip → grid (sections); the ≥xl grid is `1fr 2fr 1fr` at 2rem
// gap / 2.5rem block padding; the rails are sticky off the single --chrome-offset
// knob (never a literal). Layout-only: no data-mark assertions.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import DetailTemplate from './DetailTemplate.svelte';

const mk = (id: string) =>
	createRawSnippet(() => ({ render: () => `<div data-testid="${id}">${id}</div>` }));

const props = {
	head: mk('head'),
	left: mk('left'),
	center: mk('center'),
	right: mk('right'),
	mobileSummary: mk('summary'),
};

const src = () =>
	readFileSync(resolve(process.cwd(), 'src/lib/components/layout/DetailTemplate.svelte'), 'utf-8');

describe('DetailTemplate — slots render in their zones', () => {
	it('renders head, left, center and right into their wrapper elements', () => {
		const { container } = render(DetailTemplate, { props });
		expect(
			container.querySelector('[data-slot="detail-head"] [data-testid="head"]'),
		).not.toBeNull();
		const left = container.querySelector('[data-slot="detail-left"]');
		expect(left?.tagName.toLowerCase()).toBe('aside');
		expect(left?.querySelector('[data-testid="left"]')).not.toBeNull();
		expect(
			container.querySelector('[data-slot="detail-center"] [data-testid="center"]'),
		).not.toBeNull();
		const right = container.querySelector('[data-slot="detail-right"]');
		expect(right?.tagName.toLowerCase()).toBe('aside');
		expect(right?.querySelector('[data-testid="right"]')).not.toBeNull();
	});

	it('renders the mobile summary strip when provided', () => {
		const { container } = render(DetailTemplate, { props });
		expect(
			container.querySelector('[data-slot="detail-mobile-summary"] [data-testid="summary"]'),
		).not.toBeNull();
	});

	it('omits the mobile summary strip when the snippet is absent', () => {
		const { mobileSummary: _drop, ...rest } = props;
		const { container } = render(DetailTemplate, { props: rest });
		expect(container.querySelector('[data-slot="detail-mobile-summary"]')).toBeNull();
	});

	it('omits side rails when their snippets are absent', () => {
		const { container } = render(DetailTemplate, { props: { center: mk('center') } });
		expect(container.querySelector('[data-slot="detail-left"]')).toBeNull();
		expect(container.querySelector('[data-slot="detail-right"]')).toBeNull();
		expect(container.querySelector('[data-slot="detail-center"]')).not.toBeNull();
	});
});

describe('DetailTemplate — mobile source order (head → summary → sections)', () => {
	it('orders the top-level blocks head, mobile-summary, grid', () => {
		const { container } = render(DetailTemplate, { props });
		const root = container.querySelector('[data-slot="detail-template"]')!;
		const kinds = Array.from(root.children).map(
			(el) => el.getAttribute('data-slot') ?? el.className,
		);
		expect(kinds[0]).toBe('detail-head');
		expect(kinds[1]).toBe('detail-mobile-summary');
		expect(kinds[2]).toContain('detail-grid');
	});
});

describe('DetailTemplate — grid + sticky (source contract)', () => {
	it('is a 1fr 2fr 1fr grid at 2rem gap / 2.5rem block padding on the ≥xl breakpoint', () => {
		const s = src();
		expect(s).toMatch(/@media\s*\(min-width:\s*1280px\)/);
		expect(s).toMatch(/grid-template-columns:\s*1fr\s+2fr\s+1fr/);
		expect(s).toMatch(
			/\.detail-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr\s+2fr\s+1fr[\s\S]*?gap:\s*2rem[\s\S]*?padding-block:\s*2\.5rem/,
		);
	});

	it('parks the rails sticky off the single --chrome-offset knob (never a literal)', () => {
		const s = src();
		expect(s).toMatch(
			/\.detail-rail\s*\{[^}]*position:\s*sticky[^}]*top:\s*var\(--chrome-offset\)/,
		);
		expect(s).not.toMatch(/top:\s*5(\.5)?rem/);
		expect(s).not.toMatch(/top:\s*7rem/);
	});

	it('bounds the rail height off the same knob so it scrolls independently', () => {
		expect(src()).toMatch(/max-height:\s*calc\(100dvh\s*-\s*var\(--chrome-offset\)\)/);
	});
});
