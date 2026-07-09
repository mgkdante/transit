// $lib/filters/grain — which time grains a given data tier exposes.
//
// The v1 snapshot contract serves three data tiers (mirroring the repository
// families): the LIVE tier (current realtime cycle), the STATIC tier (the most
// recent published rollup), and the HISTORIC tier (the archived rollup series).
// Each tier supports a different set of {@link Grain} time buckets, so a grain
// toggle must be gated by the tier the active surface is reading from — offering
// a `month` grain on a live surface (which only has "now") would be a dead
// control.
//
// Gating policy (finest → coarsest):
//   live     → ['live']                       (only the current cycle exists)
//   static   → ['day', 'week', 'month']       (published aggregate rollups)
//   historic → ['day', 'week', 'month']       (archived aggregate rollups)
//
// SSR-safe: pure data + pure functions; no DOM, no `window`.

import type { Grain } from '$lib/v1/schemas';
import type { DateWindow } from './state';
import { GRAINS, isGrain } from './state';

/** The data tier an active surface reads from. Mirrors the v1 repo families. */
export type DataTier = 'live' | 'static' | 'historic';

/** Grains each tier exposes, in canonical finest→coarsest order. */
const TIER_GRAINS: Record<DataTier, readonly Grain[]> = {
	live: ['live'],
	static: ['day', 'week', 'month'],
	historic: ['day', 'week', 'month'],
};

/**
 * The grains available for a data tier, finest→coarsest. Returns a fresh array
 * (safe to mutate). An unrecognized tier falls back to the full grain set so a
 * future tier never silently hides every control.
 */
export function availableGrains(tier: DataTier): Grain[] {
	const grains = TIER_GRAINS[tier];
	return grains ? grains.slice() : GRAINS.slice();
}

/** The default (finest available) grain for a tier — its first entry. */
export function defaultGrain(tier: DataTier): Grain {
	return availableGrains(tier)[0];
}

/** True when `grain` is a valid {@link Grain} AND offered by `tier`. */
export function isGrainAvailable(tier: DataTier, grain: string): grain is Grain {
	return isGrain(grain) && availableGrains(tier).includes(grain);
}

/**
 * Coerce a requested grain to one the tier actually supports. A valid, offered
 * grain passes through; anything else (invalid, or valid-but-wrong-tier) falls
 * back to the tier's {@link defaultGrain}. Use when hydrating a grain from the
 * URL against a known tier so a stale `?grain=month` on a live surface resolves
 * to `live` instead of a dead state.
 */
export function resolveGrain(tier: DataTier, requested: string | undefined): Grain {
	if (requested !== undefined && isGrainAvailable(tier, requested)) return requested;
	return defaultGrain(tier);
}

/**
 * Clamp a URL-seeded {@link DateWindow} against the dates a surface actually
 * carries. The URL is a HINT, never a data source: a bound the contract has no
 * day for is DROPPED (never fabricated into a fake span), and a window survives
 * only when BOTH clamped bounds remain — otherwise the whole window is dropped
 * (`undefined`), so the surface falls to its grain-only default rather than a
 * half or invented span (honest-absence).
 *
 * This is the shared availability entry point that replaces the per-surface
 * bespoke clamps: the codec ({@link import('./url').fromSearchParams}) produces a
 * SHAPE-valid `{from,to}`; this validates it against real data once the surface
 * knows its `availableDates`.
 *
 * @param window         the shape-valid window from the codec, or `undefined`.
 * @param availableDates the real dated days the surface carries (e.g. every
 *                       day-grain period's `date`).
 */
export function resolveWindow(
	window: DateWindow | undefined,
	availableDates: ReadonlySet<string>,
): DateWindow | undefined {
	if (!window) return undefined;
	// Honest-absence: if EITHER bound is not a real available date, the WHOLE window is
	// dropped — we never clamp/keep the surviving bound. A partial or one-sided span is a
	// fabricated window the URL never actually described; dropping it entirely falls the
	// surface back to its grain default, which is the honest outcome.
	if (!availableDates.has(window.from) || !availableDates.has(window.to)) return undefined;
	return window;
}

/**
 * Minimum trustworthy buckets a grain needs before its control is enabled. The
 * Chart Doctrine data-depth floor (§4.0 MIN_POINTS_FOR_LINE): a coarse grain that
 * collapses to 1-2 points can't show a trend, so its pill is DISABLED (never
 * hidden) until it has enough buckets. This is a points-count proxy, distinct
 * from the event-count MIN_N_RATE reliability floor in `$lib/v1/stats`.
 */
export const MIN_POINTS_PER_GRAIN = 7;

/**
 * The grains a surface can usefully OFFER given how much data each grain has,
 * finest→coarsest. `bucketCounts` maps a grain to its count of trustworthy
 * (non-null) buckets; a grain is usable when it is offered by the tier AND has
 * `>= minPoints` buckets. Pair with {@link availableGrains}: render every
 * available grain, but DISABLE (don't hide) the ones not in this set — so a thin
 * route shows a greyed `month` pill with a reason instead of a flat 1-point line.
 *
 * Data-depth gating is the fix for the "week/month trend goes flat" bug: never
 * draw a coarse-grain line that has too few points to mean anything.
 */
export function usableGrains(
	tier: DataTier,
	bucketCounts: Partial<Record<Grain, number>>,
	minPoints: number = MIN_POINTS_PER_GRAIN,
): Grain[] {
	return availableGrains(tier).filter((g) => (bucketCounts[g] ?? 0) >= minPoints);
}

/**
 * The usable subset of an EXPLICIT offered list (no {@link DataTier} lookup),
 * finest→coarsest, preserving the caller's order. A grain is usable when it has
 * `>= minPoints` trustworthy buckets; a grain missing from `bucketCounts` counts
 * as 0 (disabled). This is the {@link usableGrains} logic against a surface's own
 * offered set — the entry point the shared SurfaceControls rail consumes, so a
 * surface passes ONE offered list + per-grain data-depth and never re-implements a
 * bespoke clamp.
 */
export function usableFromOffered(
	offered: readonly Grain[],
	bucketCounts: Partial<Record<Grain, number>>,
	minPoints: number = MIN_POINTS_PER_GRAIN,
): Grain[] {
	return offered.filter((g) => (bucketCounts[g] ?? 0) >= minPoints);
}

/** True when `grain` is offered by the tier AND has enough data-depth to enable. */
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
