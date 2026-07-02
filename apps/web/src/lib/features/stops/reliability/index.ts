// $lib/features/stops/reliability — the decomposed Stops reliability surface (S8A).
//
// StopDetail mounts <StopReliabilitySurface> in its reliability pane; the surface
// owns the codec-seeded grain rail + the ONE mapping pass through the pure selectors,
// and the S8B DateWindow seam clips the new daily trend + range verdict.

export { default as StopReliabilitySurface } from './sections/StopReliabilitySurface.svelte';
export { stopReliabilityCopy, type StopReliabilityCopy } from './stops-reliability.copy';
