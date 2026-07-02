import { describe, it, expect } from 'vitest';
import { selectCrowdingMix } from './crowdingMix';
import type { OccupancyCode, OccupancyMix } from '$lib/v1/schemas';

const label = (c: OccupancyCode) => `L:${c}`;

describe('selectCrowdingMix', () => {
	it('surfaces the dominant band + a whole-percent share', () => {
		const mix = {
			empty: 0.1,
			many_seats: 0.5,
			few_seats: 0.3,
			standing: 0.1,
			crushed: 0,
		} as unknown as OccupancyMix;
		const vm = selectCrowdingMix(mix, label);
		expect(vm.hasCrowding).toBe(true);
		expect(vm.dominant?.code).toBe('many_seats');
		expect(vm.dominantPct).toBe('50%'); // 0.5 / 1.0
		expect(vm.segments).toHaveLength(5);
	});

	it('treats an ALL-ZERO mix as empty (indistinguishable from no telemetry)', () => {
		const mix = {
			empty: 0,
			many_seats: 0,
			few_seats: 0,
			standing: 0,
			crushed: 0,
		} as unknown as OccupancyMix;
		const vm = selectCrowdingMix(mix, label);
		expect(vm.hasCrowding).toBe(false);
		expect(vm.mix).toBeNull();
		expect(vm.dominant).toBeNull();
		expect(vm.dominantPct).toBeNull();
	});

	it('is honest absence on a null mix', () => {
		const vm = selectCrowdingMix(null, label);
		expect(vm.hasCrowding).toBe(false);
		// segments still render (null values) so a caller can lay out an empty bar shell.
		expect(vm.segments.every((s) => s.value == null)).toBe(true);
	});
});
