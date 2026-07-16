import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('root layout SEO', () => {
	it('drives the document head through SeoHead with per-route metadata', () => {
		const layout = readFileSync(resolve(process.cwd(), 'src/routes/+layout.svelte'), 'utf-8');
		expect(layout).toContain('<SeoHead');
		expect(layout).toContain('resolveRouteSeo');
		expect(layout).toContain(
			'const headTitle = $derived(isErrorStatus ? errorHead.title : seo.title)',
		);
		expect(layout).toMatch(/title=\{headTitle\}/);
	});

	it('SeoHead emits a non-empty <title> for axe and browser chrome', () => {
		const seoHead = readFileSync(
			resolve(process.cwd(), 'src/lib/components/SeoHead.svelte'),
			'utf-8',
		);
		expect(seoHead).toContain('<svelte:head>');
		expect(seoHead).toContain('<title>');
		expect(seoHead).toContain('{fullTitle}');
	});
});
