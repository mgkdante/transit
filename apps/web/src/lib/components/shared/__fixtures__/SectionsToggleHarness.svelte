<script lang="ts">
	import { CollapsibleSection, TocNav, FilterGroup } from '@yesid/ui/brand';
	import SectionsToggle from '../SectionsToggle.svelte';
	let { count = 2 }: { count?: number } = $props();
</script>

<SectionsToggle />
<FilterGroup label="Filters" items={[]} allLabel="All" onSelect={() => {}} collapsible />
<TocNav heading="Contents" entries={[]} />
{#each Array.from({ length: count }, (_, i) => i) as i (i)}
	<CollapsibleSection title={`Section ${i + 1}`} anchor={`content-${i + 1}`} open={i === 0}>
		<button>Content {i + 1}</button>
	</CollapsibleSection>
{/each}
