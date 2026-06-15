<!--
  ResourceBoundary — skeleton / error / empty / loaded gate for a Resource<T>.

  THE one place a surface's data-load states are rendered. Pair it with
  `createResource` ($lib/v1/resource.svelte): the boundary watches the resource's
  reactive surface and renders exactly one of four states, so no surface
  re-implements skeleton/error/empty plumbing.

  Render PRIORITY (first match wins):
    1. data present (and not isEmpty)  → the `children` snippet, given the data
    2. error                           → EdgeState error-v1 (with a retry)
    3. loading / not settled           → EdgeState skeleton
    4. settled, no data                → EdgeState empty

  The edge density tracks the shell breakpoint (`layout.isDesktop` from $lib/nav),
  matching the route/stop shells. Bilingual copy comes from EdgeState.
-->
<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import type { Locale } from '$lib/i18n';
	import type { Resource } from '$lib/v1/resource.svelte';
	import { layout } from '$lib/nav';
	import { EdgeState } from '$lib/components/edge';

	interface ResourceBoundaryProps {
		/** The reactive resource to gate on. */
		resource: Resource<T>;
		/** UI language for the edge-state copy. */
		lang: Locale;
		/**
		 * Optional emptiness predicate on a loaded value — true means "treat as
		 * empty" (e.g. an empty list), routing to the empty edge state instead of
		 * the children snippet. Omitted ⇒ any non-null value renders.
		 */
		isEmpty?: (data: NonNullable<T>) => boolean;
		/**
		 * Rendered with the loaded data once it is present (and not empty). The
		 * snippet receives `NonNullable<T>` — the boundary only renders it past the
		 * non-null/non-empty guard, so consumers never null-check inside it.
		 */
		children: Snippet<[NonNullable<T>]>;
		/** Optional extra classes forwarded to the edge states. */
		class?: string;
	}

	let { resource, lang, isEmpty, children, class: className }: ResourceBoundaryProps = $props();

	// Edge density follows the shell breakpoint (desktop 3-volet vs mobile card).
	const edgeLayout = $derived(layout.isDesktop ? 'desktop' : 'mobile');

	// The single non-null/non-empty narrowing — null otherwise. Consumers get a
	// guaranteed-present value in `children`, so no surface re-checks for null.
	const loaded = $derived.by((): NonNullable<T> | null => {
		const value = resource.data;
		if (value == null) return null;
		const present = value as NonNullable<T>;
		return isEmpty?.(present) ? null : present;
	});
</script>

{#if loaded !== null}
	{@render children(loaded)}
{:else if resource.error}
	<EdgeState
		variant="error-v1"
		{lang}
		layout={edgeLayout}
		onRetry={() => resource.reload()}
		class={className}
	/>
{:else if resource.loading || !resource.settled}
	<EdgeState variant="skeleton" {lang} layout={edgeLayout} class={className} />
{:else}
	<EdgeState variant="empty" {lang} layout={edgeLayout} class={className} />
{/if}
