<script lang="ts">
	import type { Snippet } from 'svelte';
	import TransitEntityRow from './TransitEntityRow.svelte';

	export interface EntityResultRowProps {
		children: Snippet;
		status?: Snippet;
		action: Snippet;
		class?: string;
	}

	let { children, status, action, class: className }: EntityResultRowProps = $props();
</script>

<TransitEntityRow presentation="card" {children} {status} actions={action} class={className} />
