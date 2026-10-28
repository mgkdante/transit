import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('approved public-site typography contract', () => {
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
			'src/lib/features/health/sections/health-sections.css',
			'src/lib/features/lines/reliability/sections/reliability-sections.css',
		];

		for (const relativePath of audited) {
			const component = readFileSync(resolve(process.cwd(), relativePath), 'utf8');
			expect(component, relativePath).not.toMatch(/font-size:\s*(?:\d|clamp\()/);
		}
	});
});
