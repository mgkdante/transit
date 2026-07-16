import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(process.cwd(), '../..');
const readRepo = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8');

describe('production snapshot request budget', () => {
	it('keeps browser bulk reads off transit-data-proxy in every deployed web lane', () => {
		const wrangler = readRepo('apps/web/wrangler.toml');
		const workflow = readRepo('.github/workflows/web.yml');

		expect(wrangler.match(/PUBLIC_V1_BASE = "https:\/\/data\.yesid\.dev\/v1"/g)).toHaveLength(2);
		expect(workflow).not.toMatch(/PUBLIC_V1_BASE:\s*\/data\/v1/);
		expect(workflow).not.toContain('PUBLIC_V1_BASE: https://transit.yesid.dev/data/v1');
		expect(workflow.match(/PUBLIC_V1_BASE: https:\/\/data\.yesid\.dev\/v1/g)).toHaveLength(2);
	});

	it('binds the snapshot bucket directly for SSR in production and development', () => {
		const wrangler = readRepo('apps/web/wrangler.toml');
		const slimEndpoint = readRepo('apps/web/src/routes/api/stops/slim/+server.ts');

		expect(
			wrangler.match(/binding = "SNAPSHOTS"\nbucket_name = "transit-snapshots"/g),
		).toHaveLength(2);
		expect(slimEndpoint).toContain('serverV1Context(event)');
		expect(slimEndpoint).not.toContain('bindingFetch(');
	});

	it('publishes absolute snapshot pointers on the same direct R2 origin', () => {
		const environment = readRepo('.env.example');

		expect(environment).toMatch(/^SNAPSHOT_PUBLIC_BASE_URL=https:\/\/data\.yesid\.dev$/m);
		expect(environment).not.toContain('SNAPSHOT_PUBLIC_BASE_URL=https://transit.yesid.dev/data');
	});

	it('ships public read-only R2 CORS and applies it before each web deploy', () => {
		const cors = JSON.parse(readRepo('apps/data-proxy/r2-cors.json')) as {
			rules: Array<{
				allowed: { origins: string[]; methods: string[]; headers: string[] };
				exposeHeaders: string[];
				maxAgeSeconds: number;
			}>;
		};
		const workflow = readRepo('.github/workflows/web.yml');
		const [rule] = cors.rules;

		expect(rule.allowed.origins).toEqual(['*']);
		expect(rule.allowed.methods).toEqual(['GET', 'HEAD']);
		expect(rule.allowed.headers).toEqual(
			expect.arrayContaining(['Range', 'If-None-Match', 'If-Modified-Since']),
		);
		expect(rule.exposeHeaders).toEqual(
			expect.arrayContaining(['ETag', 'Date', 'Age', 'Content-Range', 'Accept-Ranges']),
		);
		expect(rule.maxAgeSeconds).toBe(86400);
		expect(
			workflow.match(/r2 bucket cors set transit-snapshots --file r2-cors\.json --force/g),
		).toHaveLength(2);
	});

	it('allows the direct R2 origin in the document and asset CSP', () => {
		const source = readRepo('apps/web/src/lib/site/securityHeaders.ts');
		const headers = readRepo('apps/web/_headers');

		expect(source).toContain('https://data.yesid.dev');
		expect(headers).toContain('https://data.yesid.dev');
	});
});
