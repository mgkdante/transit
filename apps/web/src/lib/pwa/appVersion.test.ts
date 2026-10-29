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
		expect(VERSION_POLL_INTERVAL_MS).toBeGreaterThan(0);
	});

	it('matches kit.version.pollInterval in svelte.config.js', async () => {
		const { default: config } = await import('../../../svelte.config.js');
		expect(config.kit?.version?.pollInterval).toBe(VERSION_POLL_INTERVAL_MS);
	});
});
