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
