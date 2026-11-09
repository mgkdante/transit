import { test } from './layout-test';
import { expect } from '@playwright/test';
import { FORWARD_ATTEMPTS, forwardRoute, textDefects } from './layout-helpers';

test('text detector distinguishes clipping, accessible truncation and broken words @layout', async ({
	page,
}) => {
	await page.setContent(`<main>
		<style>.ellipsis{width:35px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}</style>
		<div id="clip" style="width:30px;white-space:nowrap;overflow:hidden">Clipped text</div>
		<div id="ellipsis" class="ellipsis">Inaccessible full name</div>
		<div id="title" class="ellipsis" title="Accessible full name">Accessible full name</div>
		<div><div id="duplicate" class="ellipsis">Duplicate full name</div><span class="sr">Duplicate full name</span></div>
		<div><div id="not-accessible" class="ellipsis">Hidden full name</div><span hidden>Hidden full name</span></div>
		<div id="word" style="width:20px;overflow-wrap:anywhere">Achalandage</div>
		<div data-allow-clip style="width:10px;overflow:hidden;white-space:nowrap">Explicit decorative clipping</div>
	</main>`);
	const findings = await textDefects(page);
	for (const [selector, kind] of [
		['#clip', 'clipped'],
		['#ellipsis', 'inaccessible-ellipsis'],
		['#not-accessible', 'inaccessible-ellipsis'],
		['#word', 'broken-word'],
	])
		expect(findings).toEqual(expect.arrayContaining([expect.objectContaining({ selector, kind })]));
	expect(findings.filter((f) => ['#title', '#duplicate'].includes(f.selector))).toEqual([]);
});

test('route forwarding retries a dropped local connection but not other failures @layout', async () => {
	let calls = 0;
	await forwardRoute(async () => {
		calls++;
		if (calls === 1) throw new Error('route.fetch: socket hang up');
	});
	expect(calls).toBe(2);

	calls = 0;
	await expect(
		forwardRoute(async () => {
			calls++;
			throw new Error('route.fetch: read ECONNRESET');
		}),
	).rejects.toThrow('ECONNRESET');
	expect(calls).toBe(FORWARD_ATTEMPTS);

	calls = 0;
	await expect(
		forwardRoute(async () => {
			calls++;
			throw new Error('route.fetch: 500 Internal Server Error');
		}),
	).rejects.toThrow('500');
	expect(calls).toBe(1);

	await forwardRoute(async () => {
		throw new Error('Target page, context or browser has been closed');
	});
});
