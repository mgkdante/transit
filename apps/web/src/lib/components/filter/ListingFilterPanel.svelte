<script lang="ts">
	import type { Snippet } from 'svelte';
	import ListingSearchField from './ListingSearchField.svelte';

	export interface ListingFilterPanelProps {
		children: Snippet;
		showSearch?: boolean;
		searchValue?: string;
		searchLabel?: string;
		searchPlaceholder?: string;
		searchTestId?: string;
		testId?: string;
	}

	let {
		children,
		showSearch = true,
		searchValue = $bindable(''),
		searchLabel = 'Search',
		searchPlaceholder = 'Search',
		searchTestId,
		testId,
	}: ListingFilterPanelProps = $props();
</script>

<div data-slot="listing-filter-panel" data-testid={testId}>
	{#if showSearch}
		<ListingSearchField
			bind:value={searchValue}
			label={searchLabel}
			placeholder={searchPlaceholder}
			testId={searchTestId}
		/>
	{/if}

	{@render children()}
</div>
