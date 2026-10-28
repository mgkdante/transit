import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

import { quietModeCopy } from '../src/lib/components/shared/quietMode.copy';
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
	const copy = quietModeCopy[locale];

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

	test(`${locale}: a remembered quiet mode keeps the metrics sections closed from first paint`, async ({
		page,
	}) => {
		const main = page.getByRole('main');
		await page.goto(localized(metrics, locale));
		// Server markup shows the controls before hydration wires them; retry until they respond.
		await expect(async () => {
			if (await main.getByRole('button', { name: copy.forget }).isHidden())
				await main.getByRole('button', { name: copy.remember }).click();
			await expect(main.getByRole('button', { name: copy.forget })).toBeVisible({ timeout: 1000 });
		}).toPass();
		const closed = await main
			.getByRole('button', { expanded: false })
			.evaluateAll((buttons) =>
				buttons.map((button) => button.getAttribute('aria-controls')).filter(Boolean),
			);

		// Only the sections in the server markup can paint before the app runs.
		await page.route('**/_app/**/*.js', (route) => route.abort());
		await page.reload();
		let painted = 0;
		for (const id of closed) {
			const trigger = main.locator(`[aria-controls="${id}"]`);
			if ((await trigger.count()) === 0) continue;
			painted += 1;
			await expect(trigger).toHaveAttribute('aria-expanded', 'false');
		}
		expect(painted).toBeGreaterThan(0);

		// Every value each control's aria-expanded holds from the first parse through hydration.
		await page.unroute('**/_app/**/*.js');
		await page.addInitScript(() => {
			const states: Record<string, (string | null)[]> = {};
			Object.assign(window, { states });
			new MutationObserver((records) => {
				for (const { target, oldValue } of records)
					(states[(target as Element).getAttribute('aria-controls') ?? ''] ??= []).push(oldValue);
			}).observe(document, {
				subtree: true,
				attributeFilter: ['aria-expanded'],
				attributeOldValue: true,
			});
		});
		await page.reload();
		await expect(main.getByRole('button', { name: copy.forget })).toBeVisible();
		const states = await page.evaluate(
			() => (window as unknown as { states: Record<string, (string | null)[]> }).states,
		);
		for (const id of closed) {
			const trigger = main.locator(`[aria-controls="${id}"]`);
			if ((await trigger.count()) === 0) continue;
			// The first value is the server markup's; nothing after it may be expanded.
			expect(
				[...(states[id] ?? []).slice(1), await trigger.getAttribute('aria-expanded')],
				id,
			).not.toContain('true');
		}
		await main.getByRole('button', { name: copy.expand }).click();
		await expect(main.getByRole('button', { expanded: true }).first()).toBeVisible();
	});
}
