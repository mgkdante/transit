<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	export interface EntityResultRowProps {
		children: Snippet;
		status?: Snippet;
		action: Snippet;
		class?: string;
	}

	let { children, status, action, class: className }: EntityResultRowProps = $props();
</script>

<div class={cn('entity-result-row', className)} data-slot="entity-result-row">
	<div class="entity-result-main" data-slot="entity-result-main">{@render children()}</div>
	{#if status}
		<div class="entity-result-status" data-slot="entity-result-status">{@render status()}</div>
	{/if}
	<div class="entity-result-action" data-slot="entity-result-action">{@render action()}</div>
</div>

<style>
	.entity-result-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		grid-template-areas: 'main status action';
		align-items: center;
		gap: 0.75rem;
		padding-right: 0.5rem;
	}

	.entity-result-main {
		grid-area: main;
		min-width: 0;
	}

	.entity-result-status {
		grid-area: status;
		flex: none;
	}

	.entity-result-action {
		grid-area: action;
		flex: none;
	}

	@media (max-width: 32rem) {
		.entity-result-row {
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-areas:
				'main action'
				'status action';
			row-gap: 0.25rem;
		}

		.entity-result-status {
			padding-left: 0.875rem;
		}
	}
</style>
