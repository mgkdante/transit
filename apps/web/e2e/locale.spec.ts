import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

import { sectionsToggleCopy } from '../src/lib/components/shared/sectionsToggle.copy';
import { AUDIT_NAV } from '../src/lib/content/nav';
import { DEFAULT_LOCALE, INTL_TAGS, PUBLISHED_LOCALES, type Locale } from '../src/lib/i18n/config';

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

	test(`${locale}: the metrics freshness stamp reads its age in the locale and moves with the clock`, async ({
		page,
	}, testInfo) => {
		test.skip(testInfo.project.name !== 'desktop', 'the stamp sits in the desktop rail');
		const ago = (minutes: number) =>
			new Intl.RelativeTimeFormat(INTL_TAGS[locale], { numeric: 'auto' }).format(
				-minutes,
				'minute',
			);
		await page.clock.install({ time: generated + 3 * 60_000 });
		await page.goto(localized(metrics, locale));
		await expect(page.getByText(ago(3))).toBeVisible();
		// Reduced motion (the suite's default) ticks every 30 s.
		await page.clock.fastForward('02:00');
		await expect(page.getByText(ago(5))).toBeVisible();
	});

	test(`${locale}: page actions affect content only and reload restores declared defaults`, async ({
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
			await expect(triggers.nth(i)).toHaveAttribute('aria-expanded', 'true');
		await expect(toggle).toHaveText(copy.collapse);
	});
}
