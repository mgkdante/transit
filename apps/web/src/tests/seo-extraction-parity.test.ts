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

describe('SEO serialization and reviewed social cards', () => {
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
			'782b17dac4fabe3ba0c5fc01f1ac07f2b220c3064f1b45a92cb99291ff730b0c',
		);
		expect(sha256(buildSitemapXml({ siteOrigin: ORIGIN, indexing: false }, SITEMAP_FIXTURE))).toBe(
			'00233e0711aad7bd7807374dd5f2d97e96b8675cd45f44a8844ba5e32b79bcc7',
		);
	});

	it('freezes both generated Open Graph card bytes', () => {
		expect(sha256(readFileSync(resolve(process.cwd(), 'static/og/en.png')))).toBe(
			'793daaf48c11bd7348039b3ab79ef731d4d60c665424686c78b8fa21b74ca4e2',
		);
		expect(sha256(readFileSync(resolve(process.cwd(), 'static/og/fr.png')))).toBe(
			'8b52b9ad268068a195ecfc0d0f767d8664e9da2c63a0ff29dde052bd60d5f40a',
		);
	});
});
