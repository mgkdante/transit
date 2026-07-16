import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const consumers = [
	'src/lib/features/lines/RouteDetail.svelte',
	'src/lib/features/stops/StopDetail.svelte',
] as const;

describe('detail tab controller consumer contract', () => {
	it('is the single URL-state owner for route and stop detail tabs', () => {
		for (const file of consumers) {
			const source = readFileSync(resolve(process.cwd(), file), 'utf8');

			expect(source, file).toContain(
				"import { createDetailTabController } from '$lib/site/detailTabController.svelte';",
			);
			expect(source, file).toContain('createDetailTabController(page.url)');
			expect(source, file).toMatch(
				/\$effect\(\(\) => detailTabController\.syncFromUrl\(page\.url\)\);/,
			);
			expect(source, file).toContain('bind:active={detailTabController.active}');
			expect(source, file).not.toContain('mirrorSearchParam');
			expect(source, file).not.toContain('detailTabFromSearchParams');
		}
	});
});
