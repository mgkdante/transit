// AbsentValue.test.ts — the honest-absence VISUAL primitive, the DOM gate.
//
// Gates:
//   - renders the resolved label + why for a reason in BOTH locales (proves it
//     calls the logic layer's describeAbsence, not its own copy);
//   - interpolates copy params (the opens-at {first}) through the resolver;
//   - carries data-slot + the calm "unknown" tone + an aria-label of label/why;
//   - both variants (inline / block) render and the block exposes a status region;
//   - NO business branching: an unknown key falls back to the generic copy via the
//     resolver (the component never crashes on or special-cases a key).

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import AbsentValue from './AbsentValue.svelte';
import type { Locale } from '$lib/i18n';
import type { AbsenceReasonKey } from '$lib/site/absence';

const LOCALES: Locale[] = ['en', 'fr'];

describe('AbsentValue — renders the resolved label + why in FR + EN', () => {
	for (const lang of LOCALES) {
		it(`not-reported renders its localized label + why (${lang})`, () => {
			const { container } = render(AbsentValue, {
				props: { reason: 'not-reported', locale: lang },
			});
			const root = container.querySelector('[data-slot="absent-value"]');
			expect(root).not.toBeNull();
			const text = root!.textContent ?? '';
			expect(text).toContain(lang === 'fr' ? 'Inconnu' : 'Unknown');
			expect(text).toContain(
				lang === 'fr' ? 'non signalé dans le flux' : 'not reported in the live feed',
			);
		});
	}

	it('interpolates the {first} param through the resolver', () => {
		const { container } = render(AbsentValue, {
			props: {
				reason: 'closed-opens-at' as AbsenceReasonKey,
				locale: 'en',
				params: { first: '06:00' },
			},
		});
		expect(container.querySelector('[data-slot="absent-value"]')!.textContent).toContain(
			'service is closed, opens at 06:00',
		);
	});
});

describe('AbsentValue — doctrine + a11y', () => {
	it('carries data-slot and the calm "unknown" tone (never an error tone)', () => {
		const { container } = render(AbsentValue, { props: { reason: 'no-prediction', locale: 'en' } });
		const root = container.querySelector('[data-slot="absent-value"]');
		expect(root).toHaveAttribute('data-tone', 'unknown');
	});

	it('exposes an aria-label of "label, why" so AT announces the honest absence', () => {
		const { container } = render(AbsentValue, { props: { reason: 'no-prediction', locale: 'en' } });
		const root = container.querySelector('[data-slot="absent-value"]');
		expect(root).toHaveAttribute('aria-label', 'No estimate, no prediction available');
	});

	it('the glyph is decorative (aria-hidden) — meaning carried by the text', () => {
		const { container } = render(AbsentValue, { props: { reason: 'not-reported', locale: 'en' } });
		const glyph = container.querySelector('.absent-value-glyph');
		expect(glyph).toHaveAttribute('aria-hidden', 'true');
	});
});

describe('AbsentValue — variants', () => {
	it('inline is the default variant', () => {
		const { container } = render(AbsentValue, { props: { reason: 'not-reported', locale: 'en' } });
		expect(container.querySelector('[data-slot="absent-value"]')).toHaveAttribute(
			'data-variant',
			'inline',
		);
	});

	it('block renders a status region', () => {
		const { container } = render(AbsentValue, {
			props: { reason: 'metro-no-realtime', locale: 'en', variant: 'block' },
		});
		const root = container.querySelector('[data-slot="absent-value"]');
		expect(root).toHaveAttribute('data-variant', 'block');
		expect(root).toHaveAttribute('role', 'status');
	});
});

describe('AbsentValue — no business branching (resolver owns the copy)', () => {
	it('an unknown key falls back to the generic copy via the resolver, never crashes', () => {
		const { container } = render(AbsentValue, {
			props: { reason: 'totally-made-up' as AbsenceReasonKey, locale: 'en' },
		});
		expect(container.querySelector('[data-slot="absent-value"]')!.textContent).toContain(
			'not reported in the live feed',
		);
	});
});
