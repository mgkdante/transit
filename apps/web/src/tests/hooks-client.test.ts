import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	clock: { kind: 'clock' },
	refresh: { kind: 'refresh' },
	configureRuntime: vi.fn(),
	configureUi: vi.fn(),
}));

vi.mock('$lib/stores', () => ({ sharedClock: mocks.clock, dataRefresh: mocks.refresh }));
vi.mock('$lib/v1/runtime', () => ({ configureV1Runtime: mocks.configureRuntime }));
vi.mock('$lib/ui/configure', () => ({ configureTransitUi: mocks.configureUi }));

import { init } from '../hooks.client';

describe('client init', () => {
	it('wires app runtime stores into dependency-free v1 ports', () => {
		init();

		expect(mocks.configureRuntime).toHaveBeenCalledWith({
			clock: mocks.clock,
			refresh: mocks.refresh,
		});
		expect(mocks.configureUi).toHaveBeenCalledOnce();
	});
});
