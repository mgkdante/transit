// map/motion/constants.ts — kinetic-motion engine tuning constants.
//
// Split out of the former monolithic vehicleMotion.ts (the engine now lives in
// the motion/ subdomain). These are the per-frame blend + render-cadence knobs;
// the projection-horizon / staleness constants live in vehicleProjection.ts and
// are re-exported here as the single audit point for the motion engine's timing.

import { PROJECTION_HORIZON_S, STALE_CUTOFF_S } from '../vehicleProjection';

/**
 * Ease-correct window (ms): when a bus gets a NEW fix, its displayed dot blends
 * from where it currently sits to the fresh projection over this window (rather
 * than snapping), so a corrected position glides in — no rubber-band. Short enough
 * that the correction reads as "settling", long enough to hide the snap.
 */
export const BLEND_MS = 900;

/**
 * Minimum gap between source.setData calls (~30fps). The per-frame projection
 * rebuilds the whole vehicle FeatureCollection and calls setData; at hundreds of
 * buses 60fps is wasteful, so intermediate frames coalesce to ~30fps. A re-feed
 * (`set`) renders unthrottled so a new fix lands immediately.
 */
export const MIN_RENDER_INTERVAL_MS = 1000 / 30;

// Re-exported so the motion engine's projection-timing constants have a single
// audit point alongside the engine's own blend/cadence knobs.
export { PROJECTION_HORIZON_S, STALE_CUTOFF_S };
