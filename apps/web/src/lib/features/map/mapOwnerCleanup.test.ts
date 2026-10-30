import { describe, expect, it } from 'vitest';
import { releaseCleanupReceipts } from './mapOwnerCleanup';

describe('releaseCleanupReceipts', () => {
	it('releases cleanup receipts for exactly one pass', () => {
		const failure = new Error('cleanup failed');
		let attempts = 0;
		const dispose = () => {
			attempts += 1;
			throw failure;
		};

		const released = Reflect.apply(releaseCleanupReceipts, undefined, [[dispose], 2]);

		expect(attempts).toBe(1);
		expect(released.pending).toEqual([dispose]);
		expect(released.errors).toEqual([failure]);
	});
});
