import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import boot from '@yesid/ui/boot.json' with { type: 'json' };

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
		const response = await page.goto('/privacy');
		expect(response?.headers()['content-security-policy']).toContain(`'${boot.hash}'`);
		const inlineScripts = await page.locator('script:not([src])').allTextContents();
		expect(
			inlineScripts.some(
				(script) => `sha256-${createHash('sha256').update(script).digest('base64')}` === boot.hash,
			),
		).toBe(true);
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

test('mobile Metrics keeps its landing and active item when the TOC reopens during settlement', async ({
	page,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'phone', 'one real mobile Metrics settlement case');
	await page.goto('/metrics');
	const toggle = page.getByTestId('sections-toggle');
	await expect(toggle).toHaveText('Collapse all');
	await toggle.click();
	await expect(toggle).toHaveText('Expand all');
	const frozen = Date.now() + 1000;
	await page.clock.install({ time: frozen });
	await page.clock.pauseAt(frozen + 1000);
	await page.evaluate(() => {
		const original = Element.prototype.scrollIntoView;
		Object.assign(window, { metricLandings: [] as string[] });
		Element.prototype.scrollIntoView = function (options) {
			const anchor = this.getAttribute('data-toc') ?? this.id;
			if (anchor === 'otp')
				(window as unknown as { metricLandings: string[] }).metricLandings.push(anchor);
			return original.call(this, options);
		};
	});
	const toc = page.getByTestId('toc-pill');
	const pill = toc.locator('button.toc-pill');
	await pill.click({ force: true });
	await toc.getByRole('button', { name: 'On-time %', exact: true }).click({ force: true });
	await expect(pill).toHaveAttribute('aria-expanded', 'false');
	await pill.click({ force: true });
	await expect(pill).toHaveAttribute('aria-expanded', 'true');
	// The clock holds the settlement frames, proving the reopen happens before landing.
	expect(
		await page.evaluate(() => (window as unknown as { metricLandings: string[] }).metricLandings),
	).toEqual([]);
	await page.clock.runFor(800);
	await expect(page.locator('#otp [data-section-trigger]')).toHaveAttribute(
		'aria-expanded',
		'true',
	);
	await expect(page.locator('#headway [data-section-trigger]')).toHaveAttribute(
		'aria-expanded',
		'false',
	);
	await expect(pill).toHaveAttribute('aria-label', /^On-time % 2\/17/);
	await expect
		.poll(() =>
			page
				.locator('#otp')
				.evaluate((target) => Math.abs(target.getBoundingClientRect().top - innerHeight * 0.25)),
		)
		.toBeLessThan(3);
	expect(
		await page.evaluate(() => (window as unknown as { metricLandings: string[] }).metricLandings),
	).toEqual(['otp']);
});
