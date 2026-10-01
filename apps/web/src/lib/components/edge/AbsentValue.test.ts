import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
		const glyph = container.querySelector('[data-slot="state-notice-glyph"]');
		expect(glyph).toHaveAttribute('aria-hidden', 'true');
	});
});

describe('AbsentValue — variants', () => {
	it('inline is the default variant', () => {
		const { container } = render(AbsentValue, { props: { reason: 'not-reported', locale: 'en' } });
		const root = container.querySelector('[data-slot="absent-value"]');
		expect(root).toHaveAttribute('data-variant', 'inline');
		expect(root).toHaveAttribute('data-component', 'state-notice');
		expect(root).toHaveAttribute('data-presentation', 'pill');
	});

	it('block renders a status region', () => {
		const { container } = render(AbsentValue, {
			props: { reason: 'metro-no-realtime', locale: 'en', variant: 'block' },
		});
		const root = container.querySelector('[data-slot="absent-value"]');
		expect(root).toHaveAttribute('data-variant', 'block');
		expect(root).toHaveAttribute('data-component', 'state-notice');
		expect(root).toHaveAttribute('data-presentation', 'silo');
		expect(root).toHaveAttribute('role', 'status');
	});
});

describe('AbsentValue — the row variant reaches the contained chassis', () => {
	for (const locale of LOCALES) {
		it(`renders the full ${locale} row copy as unboxed text`, () => {
			const { container } = render(AbsentValue, {
				props: { reason: 'no-observations', locale, variant: 'row' },
			});
			const root = container.querySelector('[data-slot="absent-value"]');
			const expected =
				locale === 'fr'
					? 'Aucune donnée · pas assez de mesures'
					: 'No data · not enough readings yet';

			expect(root).toHaveAttribute('data-density', 'row');
			expect(root).toHaveAttribute('data-presentation', 'row');
			expect(root?.textContent?.replace(/\s+/g, ' ').trim()).toBe(expected);
			expect(root).toHaveAttribute('aria-label', expected.replace(' · ', ', '));
		});
	}

	it('the chassis it lands on still declares the wrap policy and both measure clamps', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/components/edge/StateNotice.svelte'),
			'utf8',
		);

		expect(source).toMatch(
			/\.state-notice-title,\s*\.state-notice-body\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s,
		);
		expect(source).toMatch(
			/(?:^|\n)[ \t]*\.state-notice-copy\s*\{[^}]*max-inline-size:\s*var\(--measure-absence\);/s,
		);
		expect(source).toMatch(
			/(?:^|\n)[ \t]*\.state-notice--row \.state-notice-copy\s*\{[^}]*max-inline-size:\s*var\(--measure-absence\);/s,
		);
		expect(source).not.toMatch(
			/\.state-notice-(?:title|body)[^{]*\{[^}]*(?:white-space:\s*nowrap|overflow:\s*hidden|text-overflow:)/s,
		);
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
