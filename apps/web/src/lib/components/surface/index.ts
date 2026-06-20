// $lib/components/surface — the shared "surface spine" (slice-9.3).
//
// Surface-agnostic primitives the four data surfaces (network health, search,
// line, stop) compose. They carry the cross-surface plumbing once — data-load
// gating, the canonical head, linkable entity rows/lists, the tabbed detail
// scaffold, the shared reliability readout and the live freshness chip — so no
// surface re-implements them.
//
// DOCTRINE (inherited from brand + dataviz): data marks ride the dataviz scale;
// --primary stays interactive-only. Tokens, no hex; bilingual via $lib/i18n.
//
// Import from `$lib/components/surface`.

export { default as ResourceBoundary } from './ResourceBoundary.svelte';
export { default as SurfaceHeader } from './SurfaceHeader.svelte';
export { default as EntityRow } from './EntityRow.svelte';
export { default as EntityList } from './EntityList.svelte';
export { default as EntityDetail } from './EntityDetail.svelte';
export { default as ReliabilityPane } from './ReliabilityPane.svelte';
export { default as GrainPicker } from './GrainPicker.svelte';
export { default as LiveFreshness } from './LiveFreshness.svelte';
export { default as ConformanceBadge } from './ConformanceBadge.svelte';
export { default as ReliabilityBadge } from './ReliabilityBadge.svelte';
export { default as SearchInput } from './SearchInput.svelte';
export { default as MapDrilldownLink } from './MapDrilldownLink.svelte';

export type { ReliabilityPeriodVM } from './ReliabilityPane.svelte';
export type { GrainSegment } from './GrainPicker.svelte';
export type { SurfaceHeadCopy } from './copy';
