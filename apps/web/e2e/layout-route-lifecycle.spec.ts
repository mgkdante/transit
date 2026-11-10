import { createServer } from 'node:http';
import { expect } from '@playwright/test';
import { test } from './layout-test';

let fulfilled = false;
const server = createServer((_request, response) => {
	setTimeout(() => response.end('fixture response'), 200);
});

test.beforeAll(async () => {
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
});

test.afterAll(async () => {
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
	expect(fulfilled, 'in-flight route finished before page teardown').toBe(true);
});

test('drains a route still fetching when the test body ends', async ({ page }) => {
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Missing fixture server port');
	const url = `http://127.0.0.1:${address.port}/slow`;
	let started!: () => void;
	const fetching = new Promise<void>((resolve) => (started = resolve));
	await page.route(url, async (route) => {
		const response = route.fetch();
		started();
		await route.fulfill({ response: await response });
		fulfilled = true;
	});
	await page.evaluate((url) => void fetch(url).catch(() => {}), url);
	await fetching;
});
