import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

import { detailCopy as stopCopy } from '../src/lib/features/stops/stops.copy';
import { detailCopy } from '../src/lib/features/lines/lines.copy';
import { reliabilityCopy } from '../src/lib/features/lines/reliability/reliability.copy';
import { PUBLISHED_LOCALES } from '../src/lib/i18n/config';
import { localizeHref } from '../src/lib/i18n/routing';

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const b9 = read('../scripts/__fixtures__/b9/rich.json');
const line = read('./routes-index.json').routes[0];
const provider = read('./manifest.json').provider;
const route = b9.files[`static/routes/${line.id}.json`];
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test.use({ bypassCSP: true });

test.beforeEach(async ({ page }) => {
	await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
	await page.clock.setFixedTime(Date.parse(b9.frozen_utc) + 30_000);
});

for (const locale of PUBLISHED_LOCALES) {
	const t = detailCopy[locale];

	test(`${locale}: a line page names its line and keeps the open tab in the URL`, async ({
		page,
	}) => {
		await page.goto(localizeHref(`/lines/${line.id}`, locale, provider));
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(
			`${line.short} · ${route.long}`,
		);

		for (const [key, name] of Object.entries(t.tabs)) {
			const tab = page.getByRole('tab', { name, exact: true });
			// Server markup shows the tabs before hydration wires them; retry until one responds.
			await expect(async () => {
				if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
				await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 1_000 });
			}).toPass();
			await expect(page).toHaveURL(
				(url) => url.searchParams.get('tab') === (key === 'detail' ? null : key),
			);
		}
		for (const section of Object.values(reliabilityCopy[locale].sections)) {
			if (typeof section !== 'object') continue;
			await expect(page.getByRole('region', { name: section.label, exact: true })).toBeVisible();
		}
	});

	test(`${locale}: a stop on the line opens its page`, async ({ page }) => {
		const [first] = route.directions[0].stops;
		await page.goto(localizeHref(`/lines/${line.id}`, locale, provider));
		await page
			.getByRole('link', {
				name: new RegExp(`^${escapeRegExp(`${t.viewStop} ${first.seq} ${first.name} `)}`),
			})
			.first()
			.click();

		await expect(page).toHaveURL(
			(url) =>
				url.pathname === localizeHref(`/stop/${first.id}`, locale) &&
				url.searchParams.get('provider') === provider,
		);
		await expect(page.getByRole('heading', { level: 1 })).toContainText(first.name);
		const code = b9.files['static/stops/' + first.id + '.json'].code;
		await expect(
			page
				.locator('[data-slot="article-header"]')
				.getByText(stopCopy[locale].info.code, { exact: true })
				.locator('..'),
		).toContainText(code);
	});
}
