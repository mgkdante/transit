// $lib/features/network/reliability — the decomposed Network-health surface (S9A re-seat).
//
// The /network page mounts <NetworkSurface>; the orchestrator owns the live store + the
// trend/provenance resources + the codec-seeded grain/window/retard state + the ONE mapping
// pass through the pure selectors, and each section is a pure presenter. The live tier (S9C) is
// four glance ExplainedMetricCards + a dedicated vehicles-reporting row + the ChartSpec-re-seated
// delay histogram.

export { default as NetworkSurface } from './sections/NetworkSurface.svelte';
export { networkReliabilityCopy, type NetworkReliabilityCopy } from './network-reliability.copy';
