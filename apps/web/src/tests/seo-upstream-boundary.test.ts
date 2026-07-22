import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
	return readFileSync(resolve(process.cwd(), path), 'utf-8');
}

describe('@yesid/seo-kit consumer boundary', () => {
	it('declares the exact vendored runtime dependency', () => {
		const packageJson = JSON.parse(source('package.json')) as {
			dependencies?: Record<string, string>;
		};

		expect(packageJson.dependencies?.['@yesid/seo-kit']).toBe('file:vendor/design/seo-kit');
	});

	it('delegates JSON-LD and sitemap mechanics while keeping Transit policy local', () => {
		expect(source('src/lib/seo/jsonld.ts')).toContain("from '@yesid/seo-kit/jsonld'");
		expect(source('src/lib/site/seoFiles.ts')).toContain("from '@yesid/seo-kit/sitemap'");
	});

	it('delegates Satori rendering through the injected rasterizer seam', () => {
		const ogSource = source('scripts/build-og.ts');

		expect(ogSource).toContain("from '@yesid/seo-kit/satori'");
		expect(ogSource).not.toContain("import satori from 'satori'");
	});
});
