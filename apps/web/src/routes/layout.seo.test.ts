import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('root layout SEO', () => {
	it('renders a non-empty document title for axe and browser chrome', () => {
		const source = readFileSync(resolve(process.cwd(), 'src/routes/+layout.svelte'), 'utf-8');

		expect(source).toContain('<svelte:head>');
		expect(source).toContain('<title>');
		expect(source).toMatch(/Transit/);
	});
});
