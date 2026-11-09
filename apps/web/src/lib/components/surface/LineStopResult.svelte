<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { EntityRowProps } from './EntityRow.svelte';
	import EntityRow from './EntityRow.svelte';
	import EntityResultRow from './EntityResultRow.svelte';
	type Props = EntityRowProps & {
		presentation: 'legacy-listing' | 'legacy-search';
		status?: Snippet;
		action?: Snippet;
	};
	let { presentation, status, action, ...entity }: Props = $props();
</script>

{#if presentation === 'legacy-search'}
	<EntityRow {...entity} metaSlot={status} />
{:else if action}
	<EntityResultRow {status} {action}>
		<EntityRow {...entity} />
	</EntityResultRow>
{/if}
