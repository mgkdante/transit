import { render } from '@testing-library/svelte';
import { expect, it } from 'vitest';
import { stampFixture } from '#lib/v1/live/__fixtures__/presentation.ts';
import { stampCopy } from '#lib/v1/stamp.copy.ts';
import FreshnessStamp from './FreshnessStamp.svelte';

it.each(['en', 'fr'] as const)(
	'renders the live form as one sentence about the time it carries in %s',
	(locale) => {
		const presentation = stampFixture({ ageText: 'Prepared age text', ageSeconds: 300 });
		const { container } = render(FreshnessStamp, { props: { presentation, locale } });
		const stamp = container.querySelector('[data-slot="freshness-stamp"]')!;
		expect(stamp).toHaveAttribute('data-age-seconds', '300');
		expect(stamp.querySelector('time')).toHaveTextContent(
			stampCopy[locale].live(
				'data',
				'current',
				locale === 'en' ? '5 minutes ago' : 'il y a 5 minutes',
			),
		);
		expect(stamp.querySelector('time')).toHaveAttribute('datetime', presentation.generatedUtc);
		expect(stamp).not.toHaveAttribute('aria-live');
		expect(stamp).toHaveAttribute('data-state', 'current');
		expect(stamp.querySelector('time')?.textContent).toMatch(
			locale === 'en'
				? /^Live · updated 5 minutes ago$/
				: /^En direct · mis à jour il y a 5 minutes$/,
		);
	},
);

it.each(['en', 'fr'] as const)(
	'renders stale and unknown text without inventing an age in %s',
	(locale) => {
		const presentation = stampFixture({
			generatedUtc: null,
			ageSeconds: null,
			ageText: locale === 'en' ? 'unknown' : 'inconnu',
			isStale: true,
		});
		const { container } = render(FreshnessStamp, { props: { presentation, locale } });
		const stamp = container.querySelector('[data-slot="freshness-stamp"]')!;
		expect(stamp).toHaveAttribute('data-stale', 'true');
		expect(stamp).not.toHaveAttribute('data-age-seconds');
		expect(stamp.querySelector('time')).not.toHaveAttribute('datetime');
		expect(stamp).toHaveTextContent(stampCopy[locale].live('data', 'unknown', null));
	},
);

it.each(['updated'] as const)('renders a caller label in the %s variant', (variant) => {
	const { container } = render(FreshnessStamp, {
		props: { presentation: stampFixture(), variant, locale: 'en', label: 'Latest report' },
	});
	const stamp = container.querySelector('[data-slot="freshness-stamp"]')!;
	expect(stamp.querySelector('.freshness-stamp-label')).toHaveTextContent('Latest report');
	expect(stamp.getAttribute('aria-live')).toBe(variant === 'updated' ? 'polite' : null);
});

it('renders a prepared absolute timestamp without reformatting it', () => {
	const { container } = render(FreshnessStamp, {
		props: {
			presentation: stampFixture({ ageSeconds: 90000, ageText: 'Jun 14, 08:00 EDT' }),
			variant: 'updated',
			locale: 'en',
		},
	});
	expect(container.querySelector('time')).toHaveTextContent('Jun 14, 08:00 EDT');
});

it('renders the record form with a calendar date', () => {
	const stamp = {
		form: 'record',
		scope: 'day',
		dataThrough: '2026-11-10',
		publishedOn: '2026-11-11',
		nextUpdateUtc: null,
		warning: false,
	} as const;
	const { container } = render(FreshnessStamp, {
		props: { variant: 'record', stamp, timeZone: 'America/Toronto', locale: 'en' },
	});
	expect(container.querySelector('[data-form="record"] time')).toHaveAttribute(
		'datetime',
		stamp.publishedOn,
	);
	expect(container.querySelector('[data-form="live"]')).toBeNull();
});

it('never announces a ticking live stamp', async () => {
	const view = render(FreshnessStamp, { props: { presentation: stampFixture(), locale: 'en' } });
	await view.rerender({ presentation: stampFixture({ ageSeconds: 30 }), locale: 'en' });
	expect(view.container.querySelector('time')).toHaveTextContent('Live · updated 30 seconds ago');
	expect(view.container.querySelector('[aria-live], [role="status"]')).toBeNull();
});
it.each([
	['current', false, 30, 'on-time'],
	['current', true, 30, 'caution'],
	['unknown', false, null, 'unknown'],
	['behind', false, 300, 'caution'],
] as const)(
	'colours the dot by state and keeps it out of the spoken text: %s degraded %s',
	(state, degraded, ageSeconds, color) => {
		const { container } = render(FreshnessStamp, {
			props: {
				presentation: stampFixture({ ageSeconds, degraded, isStale: state === 'behind' }),
				locale: 'en',
			},
		});
		const dot = container.querySelector('[data-slot="status-dot"]')!;
		expect(dot).toHaveAttribute('aria-hidden', 'true');
		expect(dot).not.toHaveAttribute('aria-label');
		expect(dot.getAttribute('class')).toContain(color);
	},
);
it('an alerts stamp from a feed says Live alerts', () => {
	const { container } = render(FreshnessStamp, {
		props: { presentation: stampFixture(), subject: 'alerts', locale: 'en' },
	});
	expect(container.querySelector('time')).toHaveTextContent('Live alerts · updated 12 seconds ago');
});
