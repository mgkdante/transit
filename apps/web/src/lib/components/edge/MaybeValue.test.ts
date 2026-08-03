// MaybeValue.test.ts — the inline value-or-absence primitive, the DOM gate.
//
// MaybeValue had NO test file at all, which left the F21 containment fix resting
// on an untested prop hop: every table-cell absence site writes `variant="row"` on
// a MaybeValue, and MaybeValue is the only thing that carries it down to
// AbsentValue. Delete that one `{variant}` forwarding and four table cells silently
// revert to a boxed pill — the exact defect the slice fixed — while the rest of the
// suite stays green. This file is the guard that goes red instead.
//
// Gates:
//   - PRESENCE: a real string and a real measured "0" stay real data; ONLY
//     null / undefined / "" fall through to the honest-absence chip (no fabricated
//     zero, no fabricated blank);
//   - the explicit `present` prop overrides the inferred presence in BOTH
//     directions, and `children` renders instead of `value` when supplied;
//   - ABSENCE routes through the shared StateNotice chassis (never a hand-rolled
//     span) carrying the resolver's label + why, in both locales, with params;
//   - `variant` is FORWARDED, not swallowed: each variant resolves to its own
//     presentation (inline → pill, row → row, block → silo), and inline is the
//     default when the caller omits it.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import MaybeValue from './MaybeValue.svelte';
import type { Locale } from '$lib/i18n';

const absence = (container: HTMLElement) => container.querySelector('[data-slot="absent-value"]');
// The visible copy, minus the decorative glyph the pill chassis prefixes.
const absenceCopy = (container: HTMLElement) =>
	container.querySelector('[data-slot="absent-value"] .state-notice-copy');
const flat = (node: Element | null) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

const richValue = createRawSnippet(() => ({
	render: () => '<span data-testid="rich">Berri-UQAM</span>',
}));

describe('MaybeValue — presence (a real 0 is real data, never a chip)', () => {
	for (const value of ['4 min', '0', '0%', '0 min']) {
		it(`renders ${JSON.stringify(value)} as a real value with no absence chip`, () => {
			const { container } = render(MaybeValue, {
				props: { value, reason: 'no-observations', locale: 'en' },
			});
			expect(flat(container)).toContain(value);
			expect(absence(container)).toBeNull();
		});
	}

	for (const empty of [null, undefined, ''] as const) {
		it(`falls through to the honest-absence chip for value=${JSON.stringify(empty)}`, () => {
			const { container } = render(MaybeValue, {
				props: { value: empty, reason: 'no-observations', locale: 'en' },
			});
			expect(absence(container)).not.toBeNull();
			expect(flat(absenceCopy(container))).toBe('No data · not enough readings yet');
		});
	}

	it('an explicit present={false} beats a real-looking value', () => {
		const { container } = render(MaybeValue, {
			props: { value: '4 min', present: false, reason: 'not-reported', locale: 'en' },
		});
		expect(absence(container)).not.toBeNull();
		expect(flat(absenceCopy(container))).toBe('Unknown · not reported in the live feed');
	});

	it('an explicit present={true} renders the children snippet instead of a chip', () => {
		const { container, getByTestId } = render(MaybeValue, {
			props: {
				value: null,
				present: true,
				children: richValue,
				reason: 'not-reported',
				locale: 'en',
			},
		});
		expect(getByTestId('rich')).toBeInTheDocument();
		expect(absence(container)).toBeNull();
	});

	it('children win over value when the datum is present', () => {
		const { container, getByTestId } = render(MaybeValue, {
			props: { value: 'ignored', children: richValue, reason: 'not-reported', locale: 'en' },
		});
		expect(getByTestId('rich')).toBeInTheDocument();
		expect(flat(container)).not.toContain('ignored');
	});
});

describe('MaybeValue — absence rides the shared chassis and the shared resolver', () => {
	it('renders the absence through StateNotice, not a local span', () => {
		const { container } = render(MaybeValue, {
			props: { value: null, reason: 'no-observations', locale: 'en' },
		});
		const root = absence(container);
		expect(root).toHaveAttribute('data-component', 'state-notice');
		expect(root).toHaveAttribute('data-tone', 'unknown');
		expect(root).toHaveAttribute('aria-label', 'No data, not enough readings yet');
	});

	for (const locale of ['en', 'fr'] as Locale[]) {
		it(`forwards the locale to the resolver (${locale})`, () => {
			const { container } = render(MaybeValue, {
				props: { value: null, reason: 'no-observations', locale },
			});
			expect(flat(absenceCopy(container))).toBe(
				locale === 'fr'
					? 'Aucune donnée · pas assez de mesures'
					: 'No data · not enough readings yet',
			);
		});
	}

	it('forwards copy params into the why', () => {
		const { container } = render(MaybeValue, {
			props: {
				value: null,
				reason: 'closed-opens-at',
				locale: 'en',
				params: { first: '06:00' },
			},
		});
		expect(flat(absenceCopy(container))).toContain('service is closed, opens at 06:00');
	});
});

describe('MaybeValue — variant is forwarded, never swallowed', () => {
	it.each([
		['inline', 'pill', 'inline'],
		['row', 'row', 'inline'],
		['block', 'silo', 'block'],
	] as const)('variant=%s resolves to presentation=%s', (variant, presentation, dataVariant) => {
		const { container } = render(MaybeValue, {
			props: { value: null, reason: 'no-observations', locale: 'en', variant },
		});
		const root = absence(container);
		expect(root).toHaveAttribute('data-presentation', presentation);
		expect(root).toHaveAttribute('data-variant', dataVariant);
	});

	it('defaults to the inline chip when the caller omits the variant', () => {
		const { container } = render(MaybeValue, {
			props: { value: null, reason: 'no-observations', locale: 'en' },
		});
		expect(absence(container)).toHaveAttribute('data-presentation', 'pill');
	});

	it('the row variant keeps the copy unboxed (no glyph, no pill chassis)', () => {
		const { container } = render(MaybeValue, {
			props: { value: null, reason: 'no-observations', locale: 'en', variant: 'row' },
		});
		const root = absence(container);
		expect(root).toHaveClass('state-notice--row');
		expect(root?.querySelector('[data-slot="state-notice-glyph"]')).toBeNull();
	});
});
