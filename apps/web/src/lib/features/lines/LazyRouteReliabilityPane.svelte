<script module lang="ts">
	import type { Component, Snippet } from 'svelte';
	import type { Locale } from '$lib/i18n';
	import type { RouteReliability } from '$lib/v1';
	import type { Resource } from '$lib/v1/resource.svelte';
	import type { LineHistoryResource } from './reliability/data/lineHistoryResource.svelte';

	type ClustersProps = {
		data: RouteReliability;
		locale: Locale;
		directionHeadsigns?: Record<number, string>;
		history?: LineHistoryResource;
		articleSummary?: Snippet;
	};

	export type RouteReliabilityClustersModule = {
		default: Component<ClustersProps>;
	};

	type Props = {
		entityId: string;
		resource: Resource<RouteReliability | null>;
		locale: Locale;
		directionHeadsigns: Record<number, string>;
		history: LineHistoryResource;
		historyOnlyReliability?: RouteReliability | null;
		articleSummary?: Snippet;
		importClusters?: () => Promise<RouteReliabilityClustersModule>;
	};

	const IMPORT_FAILURE_COPY: Record<Locale, { title: string; body: string; retry: string }> = {
		fr: {
			title: 'Impossible de charger la vue Fiabilité',
			body: 'La vue Fiabilité n’a pas pu démarrer. Réessayez.',
			retry: 'Réessayer',
		},
		en: {
			title: 'Reliability view could not load',
			body: 'The Reliability view could not start. Try again.',
			retry: 'Retry',
		},
	};
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { EdgeState, StateNotice } from '$lib/components/edge';
	import { ResourceBoundary } from '$lib/components/surface';
	import { layout } from '$lib/nav';
	import { Button } from '@yesid/ui/button';

	let {
		entityId,
		resource,
		locale,
		directionHeadsigns,
		history,
		historyOnlyReliability = null,
		articleSummary,
		importClusters,
	}: Props = $props();

	let Clusters = $state.raw<RouteReliabilityClustersModule['default'] | null>(null);
	let importError = $state<Error | null>(null);
	let importPending: Promise<void> | null = null;
	let alive = false;

	onMount(() => {
		alive = true;
		startImport();
		return () => {
			alive = false;
		};
	});

	function startImport(): void {
		if (Clusters || importPending) return;
		importError = null;
		let request: Promise<RouteReliabilityClustersModule>;
		try {
			request = importClusters
				? importClusters()
				: import('./reliability/RouteReliabilityClusters.svelte');
		} catch (error) {
			if (alive) importError = toError(error);
			return;
		}

		const pending = request
			.then((module) => {
				if (alive) Clusters = module.default;
			})
			.catch((error) => {
				if (alive) importError = toError(error);
			})
			.finally(() => {
				if (importPending === pending) importPending = null;
			});
		importPending = pending;
	}

	function toError(error: unknown): Error {
		return error instanceof Error ? error : new Error(String(error));
	}

	const edgeLayout = $derived(layout.isDesktop ? 'desktop' : 'mobile');
	const failureCopy = $derived(IMPORT_FAILURE_COPY[locale]);
</script>

{#snippet retryImport()}
	<Button variant="outline" size="sm" onclick={startImport}>{failureCopy.retry}</Button>
{/snippet}

{#snippet loaded(data: RouteReliability)}
	{#if Clusters}
		{#key entityId}
			<Clusters {data} {locale} {directionHeadsigns} {history} {articleSummary} />
		{/key}
	{:else if importError}
		<StateNotice
			title={failureCopy.title}
			body={failureCopy.body}
			glyph="◆"
			tone="error"
			role="alert"
			ariaLive="assertive"
			action={retryImport}
			data-slot="reliability-import-error"
		/>
	{:else}
		<EdgeState variant="skeleton" lang={locale} layout={edgeLayout} />
	{/if}
{/snippet}

{#if resource.settled && resource.error == null && resource.data == null && historyOnlyReliability != null && history.state !== 'current'}
	{@render loaded(historyOnlyReliability)}
{:else}
	<ResourceBoundary {resource} lang={locale}>
		{#snippet children(reliability)}
			{@render loaded(reliability)}
		{/snippet}
	</ResourceBoundary>
{/if}
