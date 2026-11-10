import { test as base } from '@playwright/test';

// WebKit applies upgrade-insecure-requests even with bypassCSP. Wrangler's local
// HTTP server has no TLS listener; keep this one directive out of fixture HTML.
export const test = base.extend({
	page: async ({ page, browserName, baseURL }, use) => {
		if (browserName === 'webkit')
			await page.route('**/*', async (route) => {
				if (
					!route.request().isNavigationRequest() ||
					new URL(route.request().url()).origin !== new URL(baseURL!).origin
				) {
					await route.fallback();
					return;
				}
				const response = await route.fetch();
				const headers = response.headers();
				if (headers['content-security-policy'])
					headers['content-security-policy'] = headers['content-security-policy'].replace(
						/(?:^|;)\s*upgrade-insecure-requests\s*(?=;|$)/g,
						'',
					);
				await route.fulfill({ response, headers });
			});
		try {
			await use(page);
		} finally {
			// Drain every spec's handlers while their page and fetched responses still
			// exist. Waiting preserves real route failures instead of discarding them.
			await page.unrouteAll({ behavior: 'wait' });
		}
	},
});
