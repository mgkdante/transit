// presentGrains.test.ts — the hotspots by_grain availability (day/week/month/shift).

import { describe, it, expect } from 'vitest';
import {
	presentGrains,
	defaultHotspotGrain,
	ladderByGrain,
	isHotspotGrain,
	HOTSPOT_GRAINS,
	type HotspotGrainKey,
} from './presentGrains';
import type { HotspotGrain } from '$lib/v1/schemas';

const grain = (g: string, entries: number, tray = 0): HotspotGrain => ({
	grain: g,
	entries: Array.from({ length: entries }, (_, i) => ({ type: 'stop', id: `E${i}` })),
	tray: Array.from({ length: tray }, (_, i) => ({ type: 'stop', id: `T${i}`, rank: null })),
});

describe('isHotspotGrain', () => {
	it('accepts the four known grains, rejects anything else', () => {
		for (const g of HOTSPOT_GRAINS) expect(isHotspotGrain(g)).toBe(true);
		expect(isHotspotGrain('year')).toBe(false);
		expect(isHotspotGrain('')).toBe(false);
	});
});

describe('ladderByGrain', () => {
	it('indexes served ladders by known grain, dropping unknown grains', () => {
		const map = ladderByGrain([grain('week', 2), grain('mystery', 5), grain('shift', 1)]);
		expect([...map.keys()].sort()).toEqual(['shift', 'week']);
	});

	it('is empty for an undefined by_grain', () => {
		expect(ladderByGrain(undefined).size).toBe(0);
	});
});

describe('presentGrains', () => {
	it('offers a grain iff its ladder has ≥1 ranked OR tray row', () => {
		const present = presentGrains([
			grain('day', 3),
			grain('week', 0, 2), // tray-only still counts as present
			grain('month', 0, 0), // served but empty → NOT present
			grain('shift', 1),
		]);
		expect([...present].sort()).toEqual(['day', 'shift', 'week']);
	});

	it('is empty when no grain is populated', () => {
		expect(presentGrains([grain('day', 0, 0)]).size).toBe(0);
		expect(presentGrains(undefined).size).toBe(0);
	});
});

describe('defaultHotspotGrain', () => {
	it('picks the finest present grain in day→week→month→shift order', () => {
		expect(defaultHotspotGrain(new Set<HotspotGrainKey>(['week', 'month']))).toBe('week');
		expect(defaultHotspotGrain(new Set<HotspotGrainKey>(['shift']))).toBe('shift');
	});

	it('falls back to day when nothing is present', () => {
		expect(defaultHotspotGrain(new Set())).toBe('day');
	});
});
