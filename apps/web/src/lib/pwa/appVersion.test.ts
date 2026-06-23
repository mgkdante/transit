import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decideFreshnessReload, VERSION_POLL_INTERVAL_MS } from './appVersion';

describe('decideFreshnessReload', () => {
	it('does not reload when no new version is detected', () => {
		expect(
			decideFreshnessReload({
				hasNewVersion: false,
				willUnload: false,
				toHref: 'https://transit.yesid.dev/map',
			}),
		).toEqual({ reload: false, href: null });
	});

	it('reloads into the target on the next in-app navigation when a new version is live', () => {
		expect(
			decideFreshnessReload({
				hasNewVersion: true,
				willUnload: false,
				toHref: 'https://transit.yesid.dev/network',
			}),
		).toEqual({ reload: true, href: 'https://transit.yesid.dev/network' });
	});

	it('does not double-reload a navigation that already unloads the document', () => {
		// External link / location.href assignment: the browser already does a full
		// load, so forcing another would be wasteful (and could fight it).
		expect(
			decideFreshnessReload({
				hasNewVersion: true,
				willUnload: true,
				toHref: 'https://example.com/elsewhere',
			}),
		).toEqual({ reload: false, href: null });
	});

	it('does not reload a leave-the-app navigation with no in-app target', () => {
		for (const toHref of [null, undefined, '']) {
			expect(decideFreshnessReload({ hasNewVersion: true, willUnload: false, toHref })).toEqual({
				reload: false,
				href: null,
			});
		}
	});
});

describe('version poll cadence contract', () => {
	it('is a positive interval (polling is armed)', () => {
		// SvelteKit only polls /_app/version.json when pollInterval is truthy
		// (runtime: create_updated_store). A zero/negative value silently disables
		// the freshness lever, so guard the invariant.
		expect(VERSION_POLL_INTERVAL_MS).toBeGreaterThan(0);
	});

	it('matches kit.version.pollInterval declared in svelte.config.js', () => {
		// The constant and the build config MUST agree or the documented cadence is
		// a lie. svelte.config.js cross-references this constant by value; assert it.
		const configPath = fileURLToPath(new URL('../../../svelte.config.js', import.meta.url));
		const source = readFileSync(configPath, 'utf8');
		const match = source.match(/pollInterval:\s*([0-9_]+)/);
		expect(match, 'svelte.config.js must declare kit.version.pollInterval').not.toBeNull();
		const declared = Number(match![1].replaceAll('_', ''));
		expect(declared).toBe(VERSION_POLL_INTERVAL_MS);
	});
});
