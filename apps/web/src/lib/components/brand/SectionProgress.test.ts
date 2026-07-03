// SectionProgress.test.ts — the `SEC n / m` reading-position readout (D4/H4).
//
// Gates:
//   - formats "SEC 03 / 08" (zero-padded, tabular so it never reflows).
//   - clamps a raw/overflowing index into [1, total].
//   - custom prefix (localized "SEC" analog) is honoured.
//   - live-region role/aria so the position update is announced.
//   - the localized `label` becomes the accessible name (visible text hidden).

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import SectionProgress from './SectionProgress.svelte';

const root = (c: HTMLElement) => c.querySelector('[data-slot="section-progress"]') as HTMLElement;
const text = (c: HTMLElement) => c.querySelector('.section-progress__text') as HTMLElement;

const squish = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

describe('SectionProgress — SEC n / m formatting', () => {
	it('zero-pads both current and total', () => {
		const { container } = render(SectionProgress, { props: { current: 3, total: 8 } });
		expect(squish(text(container).textContent)).toBe('SEC 03 / 08');
	});

	it('renders a custom (localized) prefix', () => {
		const { container } = render(SectionProgress, {
			props: { current: 1, total: 4, prefix: 'SEC.' },
		});
		expect(squish(text(container).textContent)).toBe('SEC. 01 / 04');
	});

	it('keeps three-digit totals whole', () => {
		const { container } = render(SectionProgress, { props: { current: 5, total: 120 } });
		expect(squish(text(container).textContent)).toBe('SEC 05 / 120');
	});
});

describe('SectionProgress — clamping', () => {
	it('clamps an index above total down to total', () => {
		const { container } = render(SectionProgress, { props: { current: 12, total: 8 } });
		expect(squish(text(container).textContent)).toBe('SEC 08 / 08');
	});

	it('clamps a zero/negative index up to 1', () => {
		const { container } = render(SectionProgress, { props: { current: 0, total: 8 } });
		expect(squish(text(container).textContent)).toBe('SEC 01 / 08');
	});

	it('guards a zero total to 1', () => {
		const { container } = render(SectionProgress, { props: { current: 1, total: 0 } });
		expect(squish(text(container).textContent)).toBe('SEC 01 / 01');
	});
});

describe('SectionProgress — a11y', () => {
	it('is a polite live status region', () => {
		const { container } = render(SectionProgress, { props: { current: 2, total: 5 } });
		expect(root(container)).toHaveAttribute('role', 'status');
		expect(root(container)).toHaveAttribute('aria-live', 'polite');
	});

	it('uses the localized label as the accessible name and hides the shorthand', () => {
		const { container } = render(SectionProgress, {
			props: { current: 3, total: 8, label: 'Section 3 of 8' },
		});
		expect(root(container)).toHaveAttribute('aria-label', 'Section 3 of 8');
		expect(text(container)).toHaveAttribute('aria-hidden', 'true');
	});

	it('leaves the shorthand visible to AT when no label is given', () => {
		const { container } = render(SectionProgress, { props: { current: 1, total: 2 } });
		expect(root(container)).not.toHaveAttribute('aria-label');
		expect(text(container)).not.toHaveAttribute('aria-hidden');
	});
});
