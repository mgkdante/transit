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

{#snippet emptyAction()}{/snippet}

{#if presentation}
	<EntityResultRow {status} action={action ?? emptyAction}>
		<EntityRow {...entity} />
	</EntityResultRow>
{/if}
