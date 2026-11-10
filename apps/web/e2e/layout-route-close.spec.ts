import { createServer } from 'node:http';
import { test } from './layout-test';
import { forwardRoute } from './layout-helpers';

for (const target of ['page', 'context'] as const)
	test(`tolerates explicit ${target} closure while fetching a route`, async ({ page }) => {
		// Close only once the fetch has reached the server. A close issued between
		// route.fetch() and its dispatch can leave Playwright's call pending forever,
		// which is a different scenario from closing while a route is fetching.
		let received!: () => void;
		const reached = new Promise<void>((resolve) => (received = resolve));
		const server = createServer((_request, response) => {
			received();
			setTimeout(() => response.end('fixture response'), 200);
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		try {
			const address = server.address();
			if (!address || typeof address === 'string') throw new Error('Missing fixture server port');
			const url = `http://127.0.0.1:${address.port}/slow`;
			let started!: () => void;
			const fetching = new Promise<void>((resolve) => (started = resolve));
			let settled!: () => void;
			let failed!: (error: unknown) => void;
			const completed = new Promise<void>((resolve, reject) => {
				settled = resolve;
				failed = reject;
			});
			await page.route(url, async (route) => {
				const response = route.fetch();
				started();
				await forwardRoute(page, async () => {
					await route.fulfill({ response: await response });
				}).then(settled, failed);
			});
			await page.evaluate((url) => void fetch(url).catch(() => {}), url);
			await Promise.all([fetching, reached]);
			await Promise.all([target === 'page' ? page.close() : page.context().close(), completed]);
		} finally {
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		}
	});
