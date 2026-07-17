// $lib/components/shared - cross-surface composition primitives ported from
// yesid.dev so detail pages (e.g. /metrics) read 1:1 with the yesid blog /
// project detail pages. We are one brand: these are the SAME components, on
// transit tokens + i18n, not lookalikes.
//
//   CollapsibleSection - card + numbered/icon badge + bits-ui collapsible body
//   TocNav             - desktop table-of-contents card (wraps a CollapsibleSection)
//   TocPill            - mobile floating table-of-contents pill + drawer
//   TocBadge           - a TOC entry's leading mark (reuses the card's badge)
//   SectionIcon        - shared section/TOC icon registry (shape names)
//   TypedInformationCard - static definition/math/SQL/caveat/pipeline note card
//   toc                - TOC model + DOM helpers (flatten / resolve / observe)
//
// Import from `$lib/components/shared`.

export { default as CollapsibleSection } from './CollapsibleSection.svelte';
export { default as TocNav } from './TocNav.svelte';
export { default as TocPill } from './TocPill.svelte';
export { articleNavigationCopy, type ArticleNavigationCopy } from './articleNavigation.copy';
export { default as SectionIcon, type SectionIconName } from './SectionIcon.svelte';
export { default as TypedInformationCard } from './TypedInformationCard.svelte';
export type { InformationKind, TypedInformationCardProps } from './TypedInformationCard.svelte';
export { findScrollParent, observeViewportPresence } from './viewportPresence';
export {
	flattenToc,
	resolveTocCounter,
	tocElement,
	openCollapsedTocTarget,
	settleLayout,
	revealTocTarget,
	reconcileActiveToc,
	observeActiveToc,
	type TocEntry,
	type TocBadgeSpec,
	type RevealTocTargetOptions,
} from './toc';
