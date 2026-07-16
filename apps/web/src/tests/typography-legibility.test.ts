import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const tokens = JSON.parse(
	readFileSync(resolve(process.cwd(), 'tools/tokens/tokens.json'), 'utf8'),
) as Record<string, unknown>;

function tokenValue(path: string): unknown {
	let cursor: unknown = tokens;
	for (const segment of path.split('.')) {
		if (cursor == null || typeof cursor !== 'object' || !(segment in cursor)) {
			throw new Error(`Missing typography token: ${path}`);
		}
		cursor = (cursor as Record<string, unknown>)[segment];
	}
	if (cursor == null || typeof cursor !== 'object' || !('$value' in cursor)) {
		throw new Error(`Typography token has no $value: ${path}`);
	}
	return (cursor as { $value: unknown }).$value;
}

describe('approved public-site typography contract', () => {
	it('pins the accepted reading, control, annotation, and heading sizes', () => {
		const approved: Record<string, unknown> = {
			'text.hero': { min: '3.25rem', preferred: 'min(7.5vw, 9svh)', max: '6.5rem' },
			'text.hero-mobile': { min: '2.5rem', preferred: 'min(11vw, 7svh)', max: '3.25rem' },
			'text.display': { min: '2.125rem', preferred: '4vw', max: '3.25rem' },
			'text.title': { min: '1.625rem', preferred: '3vw', max: '2.125rem' },
			'text.heading': { min: '1.25rem', preferred: '3vw', max: '1.5rem' },
			'text.subheading': '1.125rem',
			'text.body': '1rem',
			'text.detail-body.mobile': '1rem',
			'text.detail-body.desktop': '1.0625rem',
			'text.stat-value': '1.75rem',
			'text.listing-title': { min: '2rem', preferred: '5vw', max: '3rem' },
			'text.listing-subtitle-desktop': '1.1rem',
			'text.small': '0.9375rem',
			'text.control': '0.9375rem',
			'text.tag': '0.9375rem',
			'text.mono': '0.875rem',
			'text.caption': '0.8125rem',
			'text.micro': '0.75rem',
		};

		for (const [path, expected] of Object.entries(approved)) {
			expect(tokenValue(path), path).toEqual(expected);
		}
	});

	it('keeps browser zoom available in both the app shell and offline fallback', () => {
		for (const relativePath of ['src/app.html', 'static/offline.html']) {
			const html = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
			const viewport = html.match(/<meta\s+name="viewport"\s+content="([^"]+)"\s*\/>/)?.[1];

			expect(viewport, `${relativePath} viewport meta`).toContain('width=device-width');
			expect(viewport, `${relativePath} initial scale`).toContain('initial-scale=1');
			expect(viewport, `${relativePath} must permit user zoom`).not.toMatch(
				/(?:user-scalable\s*=\s*no|maximum-scale\s*=)/i,
			);
		}
	});

	it('uses the rem baseline without overriding user text preferences', () => {
		const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');
		expect(css).toMatch(/html\s*\{[\s\S]*?font-size:\s*100%/);
		expect(css).toMatch(/body\s*\{[\s\S]*?font-size:\s*var\(--text-body\)/);
	});

	it('routes shared article, rail, and listing typography through semantic tokens', () => {
		const audited = [
			'src/lib/features/metrics/MetricsExplainer.svelte',
			'src/lib/features/health/HealthStatus.svelte',
			'src/lib/components/shared/TocNav.svelte',
			'src/lib/components/shared/TocPill.svelte',
			'src/lib/components/layout/BlueprintListingHeader.svelte',
		];

		for (const relativePath of audited) {
			const component = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
			expect(component, relativePath).not.toMatch(/font-size:\s*(?:\d|clamp\()/);
		}
	});
});
