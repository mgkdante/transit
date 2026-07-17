<script lang="ts" module>
	import type { SectionIconName } from './section-icon.internal.svelte';

	export type TocBadgeSpec =
		| { kind: 'number'; value: number }
		| { kind: 'icon'; name: SectionIconName };
</script>

<script lang="ts">
	import { Badge } from '../primitives/badge/index.js';
	import SectionIcon from './section-icon.internal.svelte';

	let {
		badge,
		iconClass = 'h-4 w-4 shrink-0 text-primary',
	}: { badge?: TocBadgeSpec; iconClass?: string } = $props();
</script>

{#if badge?.kind === 'icon'}
	<SectionIcon name={badge.name} class={iconClass} />
{:else if badge?.kind === 'number'}
	<Badge variant="number" class="text-[0.75rem]" aria-hidden="true">
		{String(badge.value).padStart(2, '0')}
	</Badge>
{/if}
