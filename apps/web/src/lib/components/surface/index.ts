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
export { default as EntityRow } from './EntityRow.svelte';
export { default as EntityList } from './EntityList.svelte';
export { default as EntityDetail } from './EntityDetail.svelte';
export { default as Breadcrumb } from './Breadcrumb.svelte';
export { default as ReliabilityPane } from './ReliabilityPane.svelte';
export { default as GrainPicker } from './GrainPicker.svelte';
export { default as SurfaceControls } from './SurfaceControls.svelte';
export { default as SurfaceRail } from './SurfaceRail.svelte';
export { default as DateRangePicker } from './DateRangePicker.svelte';
export { default as FreshnessStamp } from './FreshnessStamp.svelte';
export { default as ConformanceBadge } from './ConformanceBadge.svelte';
export { default as ReliabilityBadge } from './ReliabilityBadge.svelte';
export { default as SearchInput } from './SearchInput.svelte';
export { default as MapDrilldownLink } from './MapDrilldownLink.svelte';
export { default as AffectedAlerts } from './AffectedAlerts.svelte';

// Props interfaces, paired with their component (brand/ + dataviz/ convention:
// every cross-surface primitive re-exports its Props so consumers can type props).
// NOTE: the generic components (ResourceBoundary<T>, EntityList<T>, EntityDetail<K>)
// can't export their Props from a `generics=` instance script (Svelte limitation),
// and the interface references the type param anyway — so they stay unexported.
export type { EntityRowProps } from './EntityRow.svelte';
export type { BreadcrumbProps } from './Breadcrumb.svelte';
export type { ReliabilityPaneProps } from './ReliabilityPane.svelte';
export type { GrainPickerProps } from './GrainPicker.svelte';
// SurfaceControls is generic (<K extends string = Grain>). Its Props interface lives
// in the MODULE script (generic over K, default string) precisely so it CAN be exported
// (a `generics=` instance script disallows exports) — Props-export convention.
export type { GrainAvailability, SurfaceControlsProps } from './SurfaceControls.svelte';
// DateRangePicker's Props + labels interfaces live in its MODULE script (one export site).
export type {
	DateRangePickerProps,
	DateRangePickerLabels,
	SingleDateOption,
} from './DateRangePicker.svelte';
export type { FreshnessStampProps } from './FreshnessStamp.svelte';
export type { ConformanceBadgeProps } from './ConformanceBadge.svelte';
export type { ReliabilityBadgeProps } from './ReliabilityBadge.svelte';
export type { SearchInputProps } from './SearchInput.svelte';
export type { MapDrilldownLinkProps } from './MapDrilldownLink.svelte';

// Auxiliary view-model / copy types.
export type { ReliabilityPeriodVM } from './ReliabilityPane.svelte';
export type { GrainSegment } from './GrainPicker.svelte';
export type { AffectedAlertsCopy } from './AffectedAlerts.svelte';
export type { SurfaceHeadCopy } from './copy';
