import { render } from '@testing-library/svelte';
import { expect, it } from 'vitest';
import { stampFixture } from '#lib/v1/live/__fixtures__/presentation.ts';
import FreshnessStamp from './FreshnessStamp.svelte';

it.each(['en', 'fr'] as const)('renders the supplied stamp text and timestamp in %s', (locale) => {
	const presentation = stampFixture({ ageText: 'Prepared age text', ageSeconds: 300 });
	const { container } = render(FreshnessStamp, { props: { presentation, locale } });
	const stamp = container.querySelector('[data-slot="freshness-stamp"]')!;
	expect(stamp).toHaveAttribute('data-age-seconds', '300');
	expect(stamp.querySelector('time')).toHaveTextContent('Prepared age text');
	expect(stamp.querySelector('time')).toHaveAttribute('datetime', presentation.generatedUtc);
	expect(stamp).not.toHaveAttribute('aria-live');
	expect(stamp).toHaveTextContent(locale === 'en' ? 'LIVE' : 'EN DIRECT');
});

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
		expect(stamp).toHaveTextContent(presentation.ageText);
		expect(stamp).toHaveTextContent(locale === 'en' ? 'stale' : 'obsolète');
	},
);

it.each(['live', 'updated'] as const)('renders a caller label in the %s variant', (variant) => {
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
