<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import type { Locale } from '$lib/i18n';
	import type { Resource } from '$lib/v1/resource.svelte';
	import { asDataState } from '$lib/v1/data-state';
	import { desktop } from '@yesid/ui/state';
	import { EdgeState } from '$lib/components/edge';
	import { type StateNoticePresentation } from '@yesid/ui/feedback';
	import type { AbsenceReason } from '$lib/site/serviceWindow';

	interface ResourceBoundaryProps {
		resource: Resource<T>;
		lang: Locale;
		emptyReason?: AbsenceReason | null;
		emptyVariant?: 'empty' | 'empty-avis';
		isEmpty?: (data: NonNullable<T>) => boolean;
		isNoResults?: (data: NonNullable<T>) => boolean;
		children: Snippet<[NonNullable<T>]>;
		class?: string;
		presentation?: Exclude<StateNoticePresentation, 'pill'>;
	}

	let {
		resource,
		lang,
		isEmpty,
		isNoResults,
		emptyReason,
		emptyVariant = 'empty',
		children,
		class: className,
		presentation = 'responsive',
	}: ResourceBoundaryProps = $props();

	const resolvedEmptyVariant = $derived(emptyReason ? 'empty' : emptyVariant);

	const edgeLayout = $derived(desktop.current ? 'desktop' : 'mobile');

	const state = $derived(asDataState(resource, { isEmpty, isNoResults, emptyReason }));
</script>

{#if state.kind === 'ok'}
	{@render children(state.data)}
{:else if state.kind === 'error'}
	<EdgeState
		variant="error-v1"
		{lang}
		layout={edgeLayout}
		onRetry={() => resource.reload()}
		{presentation}
		class={className}
	/>
{:else if state.kind === 'loading'}
	<EdgeState variant="skeleton" {lang} layout={edgeLayout} class={className} />
{:else if state.kind === 'no_results'}
	<EdgeState variant="no-results" {lang} layout={edgeLayout} {presentation} class={className} />
{:else}
	<EdgeState
		variant={resolvedEmptyVariant}
		{lang}
		layout={edgeLayout}
		{emptyReason}
		{presentation}
		class={className}
	/>
{/if}
