import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
	await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
});

test('boot CSP, responsive header and reload language redirect', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'one explicit viewport matrix');
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error' && /content security|refused to|violat/i.test(message.text()))
			errors.push(message.text());
	});
	for (const viewport of [
		{ width: 1440, height: 900 },
		{ width: 1280, height: 800 },
		{ width: 390, height: 844 },
	]) {
		await page.setViewportSize(viewport);
		await page.goto('/privacy');
		await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
		await expect(page.getByTestId('sections-toggle')).toHaveCount(0);
		await expect(page.getByTestId('language-toggle')).toHaveAttribute(
			'data-sveltekit-reload',
			'true',
		);
		await expect(async () => {
			if (!(await page.getByRole('dialog', { name: 'Navigation menu' }).isVisible()))
				await page.getByRole('button', { name: 'Open menu' }).click();
			await expect(page.getByRole('dialog', { name: 'Navigation menu' })).toBeVisible({
				timeout: 1000,
			});
		}).toPass();
		await expect(page.getByRole('dialog').getByText('Navigation · All routes')).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true,
		);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog')).toHaveCount(0);
	}

	// Keep the real reload link and make its actual destination redirect once.
	const language = page.getByTestId('language-toggle');
	const destination = new URL((await language.getAttribute('href'))!, page.url());
	await page.route(destination.href, (route) =>
		route.fulfill({ status: 302, headers: { location: '/fr/terms?provider=stm' } }),
	);
	await page.getByRole('button', { name: 'Open menu' }).click();
	await language.click();
	await expect(page).toHaveURL(/\/fr\/terms\?provider=stm$/);
	await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
	await expect(page.getByRole('button', { name: 'Ouvrir le menu' })).toBeVisible();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(1);
	expect(errors).toEqual([]);
});

test('TOC opens only its collapsed content target at the quarter-viewport line', async ({
	page,
}, testInfo) => {
	// The fixture origin is deliberately outside the production connect-src policy.
	test.skip(testInfo.project.name !== 'desktop', 'desktop TOC plus explicit small-laptop size');
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto('/metrics');
	const toggle = page.getByTestId('sections-toggle');
	await expect(toggle).toHaveText('Collapse all');
	await toggle.click();
	await expect(toggle).toHaveText('Expand all');
	const content = page.locator('[data-testid="metrics-sections"] [data-section-trigger]');
	await page
		.locator('.metrics-toc-rail')
		.getByRole('button', { name: 'On-time %', exact: true })
		.click();
	await expect(page.locator('#otp [data-section-trigger]')).toHaveAttribute(
		'aria-expanded',
		'true',
	);
	await expect(page.locator('#headway [data-section-trigger]')).toHaveAttribute(
		'aria-expanded',
		'false',
	);
	await expect(toggle).toHaveText('Collapse all');
	await expect
		.poll(() =>
			content.evaluateAll(
				(nodes) => nodes.filter((node) => node.getAttribute('aria-expanded') === 'true').length,
			),
		)
		.toBe(1);
	await expect
		.poll(() =>
			page
				.locator('#otp')
				.evaluate((target) => Math.abs(target.getBoundingClientRect().top - innerHeight * 0.25)),
		)
		.toBeLessThan(3);
});
