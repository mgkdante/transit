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
