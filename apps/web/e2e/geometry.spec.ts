import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

import { AUDIT_NAV, SURFACE_NAV } from '../src/lib/content/nav';
import { PUBLISHED_LOCALES } from '../src/lib/i18n/config';
import { localizeHref } from '../src/lib/i18n/routing';

const fixture = (name: string) =>
	JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'));
const stop = fixture('stops-index.json').stops[0];
const line = fixture('routes-index.json').routes[0];
const paths = [
	...[...SURFACE_NAV, ...AUDIT_NAV].map(({ href }) => href),
	`/lines/${line.id}`,
	`/stop/${stop.id}`,
	`/search?q=${encodeURIComponent(stop.name)}`,
];

test.use({ bypassCSP: true });

test.beforeEach(async ({ page }, { project }) => {
	test.skip(project.name !== 'phone', 'reflow is a phone contract');
	await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
	await page.clock.setFixedTime(Date.parse(fixture('departures.json').generated_utc) + 30_000);
});

// One test per page, so each page gets its own budget and its own report line.
for (const locale of PUBLISHED_LOCALES) {
	for (const path of paths) {
		test(`${locale} ${path}: the phone layout reflows without sideways scrolling`, async ({
			page,
		}) => {
			// networkidle: the client-side data lands before the page is measured.
			await page.goto(localizeHref(path, locale), { waitUntil: 'networkidle' });
			await page.evaluate(() => document.fonts.ready);
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				page.viewportSize()!.width,
			);
		});
	}
}
