import { expect, test } from '@playwright/test';

import { navPillCopy } from '../src/lib/components/shell/navPill.copy';
import { AUDIT_NAV } from '../src/lib/content/nav';
import { DEFAULT_LOCALE as locale } from '../src/lib/i18n/config';

const path = AUDIT_NAV[0].href;

test.use({ serviceWorkers: 'allow' });

test('offline, a page shows the offline notice and its link retries once online', async ({
	context,
	page,
}, { project }) => {
	test.skip(project.name !== 'desktop', 'the service worker does not depend on the viewport');
	// The context route also sees the service worker's own requests.
	await context.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
	await page.goto('/');
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
	});

	await context.setOffline(true);
	const response = await page.goto(path);
	expect(response?.fromServiceWorker()).toBe(true);
	const notice = page.getByRole('alert');
	await expect(notice.getByRole('heading', { level: 1 })).toBeVisible();

	await context.setOffline(false);
	await notice.getByRole('link').click();
	await expect(page.getByRole('navigation', { name: navPillCopy[locale].nav })).toBeVisible();
	expect(new URL(page.url()).pathname).toBe(path);
});
