import { describe, expect, it } from 'vitest';
import { DEFAULT_LIVE_TTL_S, liveTtlS } from './vehicleSilence';

describe('liveTtlS', () => {
	it('uses the manifest ttl, falling back to the default', () => {
		expect(liveTtlS(15)).toBe(15);
		expect(liveTtlS(null)).toBe(DEFAULT_LIVE_TTL_S);
		expect(liveTtlS(undefined)).toBe(DEFAULT_LIVE_TTL_S);
		expect(liveTtlS(0)).toBe(1);
	});
});
