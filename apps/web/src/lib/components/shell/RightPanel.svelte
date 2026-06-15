<!--
  RightPanel — the desktop detail dock (w360), the "volet" that swaps to show a
  selected surface (vehicle / stop / line / network-health detail).

  Structure: an optional header row, a scrolling body (the swapped detail), and
  a STICKY footer slot pinned to the bottom (for the surface's primary actions /
  provenance line). The whole dock can collapse to nothing when `open` is false
  — the shell hides it from layout entirely on close so the MapStage reclaims
  the width.

  "swap-volet" = the body is keyed on the active surface so each swap re-enters
  cleanly (a subtle slide-in, reduced-motion-guarded). No data is wired in 9.2;
  the page provides body + footer via named snippets, with quiet empty states.

  Adapted from the yesid.dev panel/aside chrome idioms — re-themed to transit
  tokens, gsap/lenis stripped. Surfaces SOLID (bg-card). a11y: complementary
  landmark, labelled region, close control is icon-only with an aria-label.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import { type Locale, DEFAULT_LOCALE, getLocale } from '$lib/i18n';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';

	interface RightPanelProps {
		/** Active locale (prop wins; falls back to context for isolated renders). */
		locale?: Locale;
		/** Optional panel title shown in the header row. */
		title?: string;
		/**
		 * A stable key for the active surface; changing it re-keys the body so the
		 * swap-in transition replays. Wire to the active SurfaceTarget id.
		 */
		surfaceKey?: string;
		/** Whether a close control is shown in the header. */
		dismissible?: boolean;
		/** Fired when the close control is activated. */
		onclose?: () => void;
		/** The detail body — the swapped surface content. */
		children?: Snippet;
		/** Sticky footer slot — primary actions / provenance, pinned to the bottom. */
		footer?: Snippet;
		class?: string;
	}

	let {
		locale: localeProp,
		title,
		surfaceKey = 'empty',
		dismissible = true,
		onclose,
		children,
		footer,
		class: className,
	}: RightPanelProps = $props();

	const ctxLocale = getLocale();
	const locale = $derived<Locale>(localeProp ?? ctxLocale ?? DEFAULT_LOCALE);

	const defaultTitle = $derived(locale === 'fr' ? 'Détails' : 'Details');
	const emptyLabel = $derived(
		locale === 'fr' ? 'Sélectionnez un élément' : 'Select something to inspect',
	);
	const closeAria = $derived(locale === 'fr' ? 'Fermer le volet' : 'Close panel');
	const panelAria = $derived(locale === 'fr' ? 'Détails de la sélection' : 'Selection details');
</script>

<aside
	class={cn('flex h-full w-[360px] shrink-0 flex-col border-l border-border bg-card', className)}
	aria-label={panelAria}
	data-slot="right-panel"
>
	<!-- Header row -->
	<div
		class="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-4"
	>
		<SectionLabel text={title ?? defaultTitle} variant="station" />
		{#if dismissible}
			<button
				type="button"
				class="tap-press -mr-1.5 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				aria-label={closeAria}
				onclick={() => onclose?.()}
				data-slot="right-panel-close"
			>
				<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none">
					<line
						x1="4"
						y1="4"
						x2="12"
						y2="12"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
					/>
					<line
						x1="12"
						y1="4"
						x2="4"
						y2="12"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
					/>
				</svg>
			</button>
		{/if}
	</div>

	<!-- Swap-volet body — keyed so each surface swap re-enters with a slide-in. -->
	<ScrollArea class="min-h-0 flex-1" data-slot="right-panel-body">
		{#key surfaceKey}
			<div class="swap-volet p-4">
				{#if children}
					{@render children()}
				{:else}
					<p class="px-1 py-8 text-center text-caption text-muted-foreground">
						{emptyLabel}
					</p>
				{/if}
			</div>
		{/key}
	</ScrollArea>

	<!-- Sticky footer — pinned to the bottom for actions / provenance. -->
	{#if footer}
		<div
			class="shrink-0 border-t border-border-subtle bg-card px-4 py-3"
			data-slot="right-panel-footer"
		>
			{@render footer()}
		</div>
	{/if}
</aside>

<style>
	/* Swap-volet entrance — a subtle slide-in on each keyed surface change. */
	.swap-volet {
		animation: volet-in 240ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both;
	}

	@keyframes volet-in {
		from {
			opacity: 0;
			transform: translateX(8px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.swap-volet {
			animation: none;
		}
	}
</style>
