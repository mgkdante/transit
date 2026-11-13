import { reliabilityBadgeCopy } from '#lib/v1/verdict.copy.ts';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { intl } from '#lib/i18n/index.ts';
import type { ReliabilitySnapshot } from '#lib/v1/reliabilitySnapshot.svelte.ts';
import ReliabilityBadge from './ReliabilityBadge.svelte';

function snap(partial: Partial<ReliabilitySnapshot>): ReliabilitySnapshot {
	return { phase: 'idle', otpPct: null, verdict: null, series: [], ...partial };
}

describe('ReliabilityBadge', () => {
	it.each([
		['en', 'on time, last 7 days'],
		['fr', 'à l’heure, 7 derniers jours'],
	] as const)(
		'reports the daily percentage once without a competing verdict in %s',
		(locale, description) => {
			const pct = intl.number(locale, { style: 'unit', unit: 'percent' }).format(83);
			const label = `${pct} ${description}`;
			const { container } = render(ReliabilityBadge, {
				props: { snapshot: snap({ phase: 'ready', otpPct: 83, verdict: 'reliable' }), locale },
			});
			const badges = screen.getAllByRole('img');
			expect(badges).toHaveLength(1);
			expect(badges[0]).toHaveAccessibleName(label);
			expect(badges[0]).toHaveAttribute('title', label);
			expect(screen.getByText(pct, { normalizer: (text) => text })).toHaveAttribute(
				'aria-hidden',
				'true',
			);
			expect(container.querySelector('[data-verdict]')).toBeNull();
		},
	);

	it.each(['loading', 'empty'] as const)('shows no percentage for a %s snapshot', (phase) => {
		const { container } = render(ReliabilityBadge, {
			props: { snapshot: snap({ phase }), locale: 'en' },
		});
		expect(screen.queryByRole('img')).toBeNull();
		expect(container.querySelector('[data-slot="reliability-placeholder"]')).toHaveAttribute(
			'aria-hidden',
			'true',
		);
	});
});

for (const locale of ['en', 'fr'] as const)
	for (const verdict of ['absent', 'tentative'] as const)
		it.each([true, false])(
			`keeps ${locale} ${verdict} compact with supplied hedge %s`,
			(supplied) => {
				const fallback =
					locale === 'en'
						? 'Not enough data to judge reliability'
						: 'Données insuffisantes pour juger la fiabilité';
				const hedge = supplied
					? `${fallback}: 82% of 368 delay observations (95% CI: 78–86%).`
					: undefined;
				const { container } = render(ReliabilityBadge, {
					props: {
						snapshot: snap({ phase: 'ready', otpPct: 82, verdict, hedge }),
						locale,
					},
				});
				const label = hedge ?? `${fallback}, ${reliabilityBadgeCopy[locale].week}`;
				const badge = screen.getByRole('img', { name: label });
				expect(badge).toHaveAttribute('title', label);
				expect(badge).toHaveAttribute('data-slot', 'reliability-hedge');
				expect(badge).toHaveAttribute('data-status', verdict);
				expect(badge.textContent?.trim()).toBe(
					(verdict === 'tentative'
						? locale === 'en'
							? 'Uncertain'
							: 'Incertaine'
						: locale === 'en'
							? 'Not enough data'
							: 'Données insuffisantes') +
						' ' +
						reliabilityBadgeCopy[locale].week,
				);
				expect(container.querySelector('[data-slot="reliability-badge"]')).toBeNull();
			},
		);

it('renders nothing for an absent verdict without a percentage', () => {
	const { container } = render(ReliabilityBadge, {
		props: {
			snapshot: snap({ phase: 'empty', otpPct: null, verdict: 'absent' }),
			locale: 'en',
		},
	});
	expect(container.querySelector('[data-slot="reliability-hedge"]')).toBeNull();
	expect(container.querySelector('[data-slot="reliability-badge"]')).toBeNull();
});
it.each([
	['en', 'Not enough data'],
	['fr', 'Données insuffisantes'],
] as const)('names a low-sample figure in %s', (locale, text) => {
	const view = render(ReliabilityBadge, {
		props: {
			locale,
			snapshot: snap({
				phase: 'ready',
				otpPct: 80,
				verdict: 'tentative',
				observationCount: 10,
				closedThrough: '2026-11-10',
			}),
		},
	});
	expect(view.getByRole('img')).toHaveTextContent(text);
	expect(view.getByRole('img')).toHaveTextContent(locale === 'fr' ? '10 nov.' : 'Nov 10');
});

it.each(['en', 'fr'] as const)('states the hedge window once for both forms in %s', (locale) => {
	const end = locale === 'fr' ? '10 nov.' : 'Nov 10';
	const full =
		locale === 'fr'
			? 'Fiabilité incertaine du 4 nov. au 10 nov. (jours complets) : 82 % (IC 95 % : 78–86 %).'
			: 'Reliability is uncertain from Nov 4 to Nov 10 (complete days): 82% (95% CI: 78–86%).';
	for (const hedge of [full, undefined]) {
		const view = render(ReliabilityBadge, {
			props: {
				locale,
				snapshot: snap({
					phase: 'ready',
					otpPct: 82,
					verdict: 'tentative',
					hedge,
					closedThrough: '2026-11-10',
				}),
			},
		});
		const image = view.getByRole('img');
		const label = image.getAttribute('aria-label')!;
		expect(label).toBe(
			hedge ??
				`${locale === 'fr' ? 'Données insuffisantes pour juger la fiabilité' : 'Not enough data to judge reliability'}, ${reliabilityBadgeCopy[locale].weekTo(end)}`,
		);
		expect(image).toHaveAttribute('title', label);
		expect(label).not.toContain('.,');
		expect(label.split(end)).toHaveLength(2);
		view.unmount();
	}
});
