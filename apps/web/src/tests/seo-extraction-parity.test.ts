import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRobotsTxt, buildSitemapXml } from '$lib/site/seoFiles';

const ORIGIN = 'https://transit.yesid.dev';
const SITEMAP_FIXTURE = {
	routeIds: ['11', '747', `A B/C?#&<>"'`],
	stopIds: ['10001', 'église & rue'],
	entityLastmod: '2026-06-20T07:00:00Z',
	staticLastmod: '2026-06-20T07:00:00Z',
} as const;

function sha256(value: string | Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}

describe('Phase 2 SEO extraction byte parity', () => {
	it('freezes the enabled and disabled robots.txt bytes', () => {
		expect(sha256(buildRobotsTxt({ siteOrigin: ORIGIN, indexing: true }))).toBe(
			'ef76f0ad68803b445fc74612c2357457fc170d9a6e1be9b200e50d9d271225d2',
		);
		expect(sha256(buildRobotsTxt({ siteOrigin: ORIGIN, indexing: false }))).toBe(
			'331ea9090db0c9f6f597bd9840fd5b171830f6e0b3ba1cb24dfa91f0c95aedc1',
		);
	});

	it('freezes representative enabled and disabled sitemap bytes', () => {
		expect(sha256(buildSitemapXml({ siteOrigin: ORIGIN, indexing: true }, SITEMAP_FIXTURE))).toBe(
			'3f43d5c0a73fda095e321b6dd472b74796614a88ca67a8fa4a51205dcec5433a',
		);
		expect(sha256(buildSitemapXml({ siteOrigin: ORIGIN, indexing: false }, SITEMAP_FIXTURE))).toBe(
			'00233e0711aad7bd7807374dd5f2d97e96b8675cd45f44a8844ba5e32b79bcc7',
		);
	});

	it('freezes both generated Open Graph card bytes', () => {
		expect(sha256(readFileSync(resolve(process.cwd(), 'static/og/en.png')))).toBe(
			'391d29013b7b04b8c12c65d1f23482e5299f401475da8c95c47979d1fe8e8f9a',
		);
		expect(sha256(readFileSync(resolve(process.cwd(), 'static/og/fr.png')))).toBe(
			'471fd2afa64f8060438a2d6759988f52cfe821d4b2f3e08d5089bc55fad3093b',
		);
	});
});
