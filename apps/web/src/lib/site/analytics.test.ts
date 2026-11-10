import { describe, expect, it, vi } from 'vitest';

const createAnalytics = vi.hoisted(() => vi.fn(() => ({ trackEvent: vi.fn() })));
vi.mock('@yesid/analytics/client', () => ({ createAnalytics }));

const { startAnalytics, outboundEvent } = await import('./analytics');

describe('outboundEvent', () => {
	it('recognizes organization repository links while preserving personal profile handling', () => {
		expect(outboundEvent(new URL('https://github.com/yesid-dev/transit'))).toBe('Repo Click');
		expect(outboundEvent(new URL('https://github.com/yesid-dev/yesid.design/releases'))).toBe(
			'Repo Click',
		);
		for (const url of [
			'https://github.com/mgkdante',
			'https://github.com/mgkdante/',
			'https://github.com/yesid-dev',
			'https://github.com/yesid-dev/',
			'https://github.com/yesid-dev-other/transit',
			'https://example.com/yesid-dev/transit',
		]) {
			expect(outboundEvent(new URL(url)), url).toBeUndefined();
		}
		expect(outboundEvent(new URL('https://yesid.dev'))).toBe('Portfolio Click');
	});
});

describe('startAnalytics', () => {
	it('starts one tracker for its own domain, sending through the relay, however often it is called', () => {
		const options = {
			domain: 'transit.yesid.dev',
			beaconToken: undefined,
			context: () => ({ locale: 'en', provider: 'stm' }),
		};
		startAnalytics(options);
		startAnalytics(options);

		expect(createAnalytics).toHaveBeenCalledOnce();
		expect(createAnalytics).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ domain: 'transit.yesid.dev', endpoint: '/relay/e' }),
		);
	});
});
