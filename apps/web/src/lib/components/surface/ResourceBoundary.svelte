<!--
  ResourceBoundary — skeleton / error / empty / loaded gate for a Resource<T>.

  THE one place a surface's data-load states are rendered. Pair it with
  `createResource` ($lib/v1/resource.svelte): the boundary watches the resource's
  reactive surface and renders exactly one of four states, so no surface
  re-implements skeleton/error/empty plumbing.

  Render PRIORITY (first match wins):
    1. data present (and not isEmpty)  → the `children` snippet, given the data
    2. error                           → EdgeState error-v1 (with a retry)
    3. loading / not settled           → delayed EdgeState skeleton (no fast-load flash)
    4. settled, no data                → EdgeState empty

  The edge density tracks the shell breakpoint (`layout.isDesktop` from $lib/nav),
  matching the route/stop shells. Bilingual copy comes from EdgeState.
-->
<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import type { Locale } from '$lib/i18n';
	import type { Resource } from '$lib/v1/resource.svelte';
	import { asDataState } from '$lib/v1/data-state';
	import { layout } from '$lib/nav';
	import { EdgeState, type StateNoticePresentation } from '$lib/components/edge';
	import type { AbsenceReason } from '$lib/site/serviceWindow';

	interface ResourceBoundaryProps {
		/** The reactive resource to gate on. */
		resource: Resource<T>;
		/** UI language for the edge-state copy. */
		lang: Locale;
		/**
		 * HONEST ABSENCE — an inferred, specific reason for the empty state (from
		 * $lib/site/serviceWindow.inferAbsenceReason). Forwarded to the empty
		 * EdgeState so a settled-but-empty load states WHY (closed / metro / silent)
		 * instead of a generic no-data. null/undefined ⇒ the generic empty copy.
		 * Applies only to the empty branch — an error keeps the error edge state.
		 */
		emptyReason?: AbsenceReason | null;
		/**
		 * Which EdgeState variant to render on the settled-but-empty branch.
		 * Defaults to the neutral 'empty'. Pass 'empty-avis' for the GOOD empty —
		 * e.g. a zero-length alert log means the network is running normally, the
		 * green network-healthy verdict rather than a grey nothing-to-show. Ignored
		 * when `emptyReason` is set (an inferred reason already owns the copy).
		 */
		emptyVariant?: 'empty' | 'empty-avis';
		/**
		 * Optional emptiness predicate on a loaded value — true means "treat as
		 * empty" (e.g. an empty list), routing to the empty edge state instead of
		 * the children snippet. Omitted ⇒ any non-null value renders.
		 */
		isEmpty?: (data: NonNullable<T>) => boolean;
		/**
		 * Optional predicate: a loaded value is empty BECAUSE the user's filter/search
		 * excluded everything — a recoverable `no_results` (its own EdgeState variant
		 * with "widen your search" copy), distinct from the world having no data.
		 * Checked before `isEmpty`. Omitted ⇒ an empty load reads as plain `empty`.
		 */
		isNoResults?: (data: NonNullable<T>) => boolean;
		/**
		 * Rendered with the loaded data once it is present (and not empty). The
		 * snippet receives `NonNullable<T>` — the boundary only renders it past the
		 * non-null/non-empty guard, so consumers never null-check inside it.
		 */
		children: Snippet<[NonNullable<T>]>;
		/** Optional extra classes forwarded to the edge states. */
		class?: string;
		/** Message-state geometry; loading skeleton composition remains layout-driven. */
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

	// An inferred reason only attaches to the neutral 'empty' variant; the good
	// 'empty-avis' (network-healthy) verdict carries its own copy, so a reason
	// would be incongruous there. Resolve the effective variant once.
	const resolvedEmptyVariant = $derived(emptyReason ? 'empty' : emptyVariant);

	// Edge density follows the shell breakpoint (desktop 3-volet vs mobile card).
	const edgeLayout = $derived(layout.isDesktop ? 'desktop' : 'mobile');

	// Resolve the reactive resource into ONE reason-typed DataState (the no-data
	// spine — $lib/v1/data-state). The template branches on `state.kind`; the `ok`
	// branch carries a guaranteed NonNullable<T>, so consumers never null-check in
	// the children snippet.
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
	<!-- A filter/search excluded everything (recoverable) — distinct from no data. -->
	<EdgeState variant="no-results" {lang} layout={edgeLayout} {presentation} class={className} />
{:else}
	<!-- state.kind === 'empty' — a genuine honest absence (with its reason). -->
	<EdgeState
		variant={resolvedEmptyVariant}
		{lang}
		layout={edgeLayout}
		{emptyReason}
		{presentation}
		class={className}
	/>
{/if}
