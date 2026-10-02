import type { Grain } from '$lib/v1/schemas';
import type { DateWindow } from './state';
import { GRAINS, isGrain } from './state';

export type DataTier = 'live' | 'static' | 'historic';

const TIER_GRAINS: Record<DataTier, readonly Grain[]> = {
	live: ['live'],
	static: ['day', 'week', 'month'],
	historic: ['day', 'week', 'month'],
};

export function availableGrains(tier: DataTier): Grain[] {
	const grains = TIER_GRAINS[tier];
	return grains ? grains.slice() : GRAINS.slice();
}

export function defaultGrain(tier: DataTier): Grain {
	return availableGrains(tier)[0];
}

export function isGrainAvailable(tier: DataTier, grain: string): grain is Grain {
	return isGrain(grain) && availableGrains(tier).includes(grain);
}

export function resolveGrain(tier: DataTier, requested: string | undefined): Grain {
	if (requested !== undefined && isGrainAvailable(tier, requested)) return requested;
	return defaultGrain(tier);
}

export function resolveWindow(
	window: DateWindow | undefined,
	availableDates: ReadonlySet<string>,
): DateWindow | undefined {
	if (!window) return undefined;
	if (!availableDates.has(window.from) || !availableDates.has(window.to)) return undefined;
	return window;
}

export const MIN_POINTS_PER_GRAIN = 7;

export function usableGrains(
	tier: DataTier,
	bucketCounts: Partial<Record<Grain, number>>,
	minPoints: number = MIN_POINTS_PER_GRAIN,
): Grain[] {
	return availableGrains(tier).filter((g) => (bucketCounts[g] ?? 0) >= minPoints);
}

export function usableFromOffered(
	offered: readonly Grain[],
	bucketCounts: Partial<Record<Grain, number>>,
	minPoints: number = MIN_POINTS_PER_GRAIN,
): Grain[] {
	return offered.filter((g) => (bucketCounts[g] ?? 0) >= minPoints);
}

export function isGrainUsable(
	tier: DataTier,
	grain: string,
	bucketCounts: Partial<Record<Grain, number>>,
	minPoints: number = MIN_POINTS_PER_GRAIN,
): grain is Grain {
	return (
		isGrainAvailable(tier, grain) && usableGrains(tier, bucketCounts, minPoints).includes(grain)
	);
}
