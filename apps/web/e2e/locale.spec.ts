import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

import { sectionsToggleCopy } from '../src/lib/components/shared/sectionsToggle.copy';
import { AUDIT_NAV } from '../src/lib/content/nav';
import { DEFAULT_LOCALE, INTL_TAGS, PUBLISHED_LOCALES, type Locale } from '../src/lib/i18n/config';
import { stampCopy } from '../src/lib/v1/stamp.copy';

const metrics = AUDIT_NAV.find((item) => item.key === 'metrics')!.href;
const localized = (href: string, locale: Locale) =>
	locale === DEFAULT_LOCALE ? href : `/${locale}${href}`;
const { generated_utc } = JSON.parse(
	readFileSync(new URL('./provenance.json', import.meta.url), 'utf8'),
);
const generated = Date.parse(generated_utc);

test.use({ bypassCSP: true });

// No request leaves the machine: the app and its data fixture are both local.
test.beforeEach(async ({ page }) => {
	await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
});

for (const locale of PUBLISHED_LOCALES) {
	const copy = sectionsToggleCopy[locale];

	test(`${locale}: the metrics header keeps its date-only record stamp as the clock moves`, async ({
		page,
	}) => {
		const published = generated_utc.slice(0, 10);
		// The core manifest has no time zone; retain the year instead of guessing one.
		const date = new Intl.DateTimeFormat(INTL_TAGS[locale], {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			timeZone: 'UTC',
		}).format(new Date(published));
		const expected = stampCopy[locale].record(null, date, 'window');
		await page.clock.install({ time: generated + 3 * 60_000 });
		await page.goto(localized(metrics, locale));
		const stamp = page.locator('[data-slot="article-header"] time');
		await expect(stamp).toHaveText(expected);
		await expect(stamp).toHaveAttribute('datetime', published);
		await page.clock.fastForward('02:00');
		await expect(stamp).toHaveText(expected);
		await expect(page.locator('[data-slot="stat-freshness"]')).toHaveCount(0);
	});

	test(`${locale}: page actions affect content only and reload restores the bulk choice`, async ({
		page,
	}) => {
		const main = page.getByRole('main');
		await page.goto(localized(metrics, locale));
		const toggle = main.getByTestId('sections-toggle');
		await expect(toggle).toHaveText(copy.collapse);
		await expect(main.getByTestId('sections-controls').locator('button')).toHaveCount(1);
		const triggers = main.locator('[data-testid="metrics-sections"] [data-section-trigger]');
		await expect(triggers.first()).toHaveAttribute('aria-expanded', 'true');
		const count = await triggers.count();
		expect(count).toBeGreaterThanOrEqual(2);
		await toggle.click();
		for (let i = 0; i < count; i++)
			await expect(triggers.nth(i)).toHaveAttribute('aria-expanded', 'false');
		await expect(toggle).toHaveText(copy.expand);
		await triggers.first().click();
		await expect(toggle).toHaveText(copy.collapse);
		await toggle.click();
		await expect(triggers.first()).toHaveAttribute('aria-expanded', 'false');
		await page.reload();
		for (let i = 0; i < count; i++)
			await expect(triggers.nth(i)).toHaveAttribute('aria-expanded', 'false');
		await expect(toggle).toHaveText(copy.expand);
	});
}
