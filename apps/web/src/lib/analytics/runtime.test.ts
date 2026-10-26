import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { transitAnalytics } from './runtime';

const RUNTIME_PATH = new URL('./runtime.ts', import.meta.url);
afterEach(() => vi.restoreAllMocks());

describe('Transit analytics runtime', () => {
	it('keeps a production-host pageview inert without touching the network', async () => {
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error());
		await expect(
			transitAnalytics.trackPageview(new URL('https://transit.yesid.dev/fr')),
		).resolves.toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('owns only the upstream client with a hard-false tracking seam', () => {
		const source = readFileSync(RUNTIME_PATH, 'utf-8');

		expect(source).toMatch(
			/import\s+\{\s*createAnalyticsClient\s*\}\s+from\s+['"]@yesid\/analytics\/client['"]/,
		);
		expect(source).toMatch(/canTrack:\s*\(\)\s*=>\s*false/);
		expect(source).not.toMatch(/from\s+['"]@yesid\/analytics\/(?:consent|plausible|policy)['"]/);
		expect(source).not.toMatch(
			/\b(?:fetch|localStorage|sessionStorage|document|window|navigator)\b/,
		);
	});
});
