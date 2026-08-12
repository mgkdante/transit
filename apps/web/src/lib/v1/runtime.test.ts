import { describe, expect, it, vi } from 'vitest';
import { configureV1Runtime, getV1Runtime } from './runtime';

describe('v1 runtime ports', () => {
	it('installs only the supplied port and restores the previous runtime', () => {
		const original = getV1Runtime();
		const clock = {
			get serverNow() {
				return 123;
			},
			noteServerEpochMs: vi.fn(),
			subscribe: vi.fn(() => () => {}),
		};

		const restore = configureV1Runtime({ clock });

		expect(getV1Runtime()).toEqual({ clock, refresh: original.refresh });
		restore();
		expect(getV1Runtime()).toBe(original);
	});
});
