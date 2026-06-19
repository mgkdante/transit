<!--
  TocBadge - renders a TOC entry's leading mark from its TocBadgeSpec, reusing
  the SAME primitives the section cards use: the numbered Badge (variant="number")
  for numbered sections, and the SectionIcon registry for icon sections. This is
  the "reuse logic, no ad-hoc" guarantee: a TOC badge can never drift from its card.

  Ported from yesid.dev shared/TocBadge; Badge + SectionIcon are transit-native.
-->
<script lang="ts">
	import SectionIcon from './SectionIcon.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import type { TocBadgeSpec } from './toc';

	let {
		badge,
		iconClass = 'h-4 w-4 shrink-0 text-primary',
	}: { badge?: TocBadgeSpec; iconClass?: string } = $props();
</script>

{#if badge?.kind === 'icon'}
	<SectionIcon name={badge.name} class={iconClass} />
{:else if badge?.kind === 'number'}
	<Badge variant="number" aria-hidden="true">{String(badge.value).padStart(2, '0')}</Badge>
{/if}
