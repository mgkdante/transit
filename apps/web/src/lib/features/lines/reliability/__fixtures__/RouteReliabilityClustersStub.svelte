<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Locale } from '$lib/i18n';
	import type { RouteReliability } from '$lib/v1';
	import type { LineHistoryResource } from '../data/lineHistoryResource.svelte';

	type Props = {
		data: RouteReliability;
		locale: Locale;
		directionHeadsigns?: Record<number, string>;
		history?: LineHistoryResource;
		articleSummary?: Snippet;
	};

	let { data, locale, directionHeadsigns = {}, history, articleSummary }: Props = $props();
</script>

<div
	data-testid="route-reliability-clusters-stub"
	data-entity-id={data.id}
	data-locale={locale}
	data-headsign-count={Object.keys(directionHeadsigns).length}
	data-history-state={history?.state}
>
	{#if articleSummary}
		{@render articleSummary()}
	{/if}
</div>
