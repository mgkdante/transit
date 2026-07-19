import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as policy from '../../tools/design-gates';

const POLICY_DIGEST = 'sha256:3a63ab98c5fe8dc6c23b5a67061d33d9d3bed2d5f08d47191ba3fe61b72e7f6c';

describe('Transit-owned design-gate policy', () => {
	it('preserves the accepted policy tables exactly', () => {
		const canonical = Object.fromEntries(
			Object.entries(policy).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
		);
		const digest = `sha256:${createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`;

		expect(
			Object.fromEntries(
				Object.entries(canonical).map(([name, value]) => [
					name,
					Array.isArray(value) ? value.length : null,
				]),
			),
		).toEqual({
			TRANSIT_AA_PAIRS: 34,
			TRANSIT_AFFORDANCE_TOKENS: 4,
			TRANSIT_ALLOW_MARKERS: 3,
			TRANSIT_BRAND_HEXES: 2,
			TRANSIT_BRAND_HEX_ALLOWLIST_REL: 1,
			TRANSIT_DATAVIZ_OCCUPANCY_ON_CARD: 10,
			TRANSIT_DATAVIZ_STATUS_ON_CARD: 10,
			TRANSIT_TEXT_PAIRS: 14,
		});
		expect(digest).toBe(POLICY_DIGEST);
	});
});
