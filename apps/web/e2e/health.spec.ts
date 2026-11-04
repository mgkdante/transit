import { expect, test } from '@playwright/test';

test('health fails closed when the Worker has no snapshot binding', async ({ request }) => {
	// The local Worker deliberately has no production R2 binding.
	const response = await request.get('/health');
	expect(response.status()).toBe(503);
	expect(response.headers()['cache-control']).toBe('no-store');
	expect(await response.json()).toMatchObject({
		status: 'unavailable',
		service: 'transit-web',
		data: 'unavailable',
		commit: null,
		branch: null,
	});
});
