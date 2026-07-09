// $lib/components/brand — the transit brand primitives.
//
// Small, opinionated building blocks that carry the metro-board visual
// language: status dots, metric readouts, section labels/headings, stop +
// metro-station labels, corner registration marks and the chevron toggle.
// They compose into shell/layout/dataviz surfaces and stay on the brand
// tokens (no hardcoded colour, no chart library).
//
// DOCTRINE: StatusDot encodes DATA with the dataviz scale + a glyph (never
// colour alone). Orange --primary stays INTERACTIVE-ONLY — these primitives
// never paint a data mark with it.
//
// Import from `$lib/components/brand`.

export { default as StatusDot } from './StatusDot.svelte';
export type { StatusDotProps } from './StatusDot.svelte';

export { default as BrandCluster } from './BrandCluster.svelte';

export { default as MetricDisplay } from './MetricDisplay.svelte';
export type { MetricDisplayProps } from './MetricDisplay.svelte';

export { default as SectionLabel } from './SectionLabel.svelte';
export type { SectionLabelProps } from './SectionLabel.svelte';

export { default as SectionHeading } from './SectionHeading.svelte';
export type { SectionHeadingProps } from './SectionHeading.svelte';

export { default as Masthead } from './Masthead.svelte';
export type { MastheadProps } from './Masthead.svelte';

export { default as NumberedChip } from './NumberedChip.svelte';
export type { NumberedChipProps } from './NumberedChip.svelte';

export { default as StopLabel } from './StopLabel.svelte';
export type { StopLabelProps } from './StopLabel.svelte';

export { default as CornerMarks } from './CornerMarks.svelte';
export type { CornerMarksProps } from './CornerMarks.svelte';

export { default as ChevronToggle } from './ChevronToggle.svelte';
export type { ChevronToggleProps } from './ChevronToggle.svelte';

export { default as MetroStation } from './MetroStation.svelte';
export type { MetroStationProps } from './MetroStation.svelte';

export { default as TerminalPanel } from './TerminalPanel.svelte';
export type { TerminalPanelProps, TerminalFooterItem } from './TerminalPanel.svelte';

export { default as CornerMeta } from './CornerMeta.svelte';
export type { CornerMetaProps } from './CornerMeta.svelte';

export { cornerMetaLabels } from './cornerMeta.copy';
export type { CornerMetaLabels } from './cornerMeta.copy';

export { default as StickyPanel } from './StickyPanel.svelte';
export type { StickyPanelProps } from './StickyPanel.svelte';

export { default as VerdictBanner } from './VerdictBanner.svelte';
