import { describe, expect, it, vi } from 'vitest';

const createAnalytics = vi.hoisted(() => vi.fn(() => ({ trackEvent: vi.fn() })));
vi.mock('@yesid/analytics/client', () => ({ createAnalytics }));

const { startAnalytics } = await import('./analytics');

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
