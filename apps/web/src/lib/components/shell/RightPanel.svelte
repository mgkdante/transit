<!--
  RightPanel — the desktop detail dock (w360), the "volet" that swaps to show a
  selected surface (vehicle / stop / line / network-health detail).

  Structure: an optional header row, a scrolling body (the swapped detail), and
  a STICKY footer slot pinned to the bottom (for the surface's primary actions /
  provenance line). Close clears the selected surface; collapse keeps the
  selection alive and narrows the dock into a slim rail.

  "swap-volet" = the body is keyed on the active surface so each swap re-enters
  cleanly (a subtle slide-in, reduced-motion-guarded). No data is wired in 9.2;
  the page provides body + footer via named snippets, with quiet empty states.

  Adapted from the yesid.dev panel/aside chrome idioms — re-themed to transit
  tokens, gsap/lenis stripped. Surfaces SOLID (bg-card). a11y: complementary
  landmark, labelled region, icon-only controls have aria-labels.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import PanelRightCloseIcon from '@lucide/svelte/icons/panel-right-close';
	import PanelRightOpenIcon from '@lucide/svelte/icons/panel-right-open';
	import XIcon from '@lucide/svelte/icons/x';
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
		/** Whether the active detail surface has a previous item to return to. */
		canGoBack?: boolean;
		/** Fired when the back control is activated. */
		onback?: () => void;
		/** Fired when the close control is activated. */
		onclose?: () => void;
		/** The detail body — the swapped surface content. */
		children?: Snippet;
		/** Sticky footer slot — primary actions / provenance, pinned to the bottom. */
		footer?: Snippet;
		/** Fill a parent resizable pane instead of owning a fixed pixel width. */
		resizable?: boolean;
		/** Controlled collapsed state for parent-owned resizable panes. */
		collapsed?: boolean;
		/** Fired when the collapse/expand control is activated. */
		ontogglecollapse?: () => void;
		class?: string;
	}

	let {
		locale: localeProp,
		title,
		surfaceKey = 'empty',
		dismissible = true,
		canGoBack = false,
		onback,
		onclose,
		children,
		footer,
		resizable = false,
		collapsed = $bindable(false),
		ontogglecollapse,
		class: className,
	}: RightPanelProps = $props();

	const ctxLocale = getLocale();
	const locale = $derived<Locale>(localeProp ?? ctxLocale ?? DEFAULT_LOCALE);

	const defaultTitle = $derived(locale === 'fr' ? 'Détails' : 'Details');
	const emptyLabel = $derived(
		locale === 'fr' ? 'Sélectionnez un élément' : 'Select something to inspect',
	);
	const backAria = $derived(locale === 'fr' ? 'Retour' : 'Back');
	const closeAria = $derived(locale === 'fr' ? 'Fermer le volet' : 'Close panel');
	const collapseAria = $derived(locale === 'fr' ? 'Réduire le volet' : 'Collapse panel');
	const expandAria = $derived(locale === 'fr' ? 'Ouvrir le volet' : 'Expand panel');
	const panelAria = $derived(locale === 'fr' ? 'Détails de la sélection' : 'Selection details');

	function toggleCollapsed(): void {
		if (ontogglecollapse) {
			ontogglecollapse();
			return;
		}
		collapsed = !collapsed;
	}
</script>

<aside
	class={cn('right-panel flex h-full shrink-0 flex-col border-l border-border bg-card', className)}
	aria-label={panelAria}
	data-slot="right-panel"
	data-open={collapsed ? 'false' : 'true'}
	data-resizable={resizable ? 'true' : undefined}
>
	<!-- Header row -->
	<div class="flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle px-4">
		<button
			type="button"
			class="tap-press -ml-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			aria-label={collapsed ? expandAria : collapseAria}
			aria-expanded={!collapsed}
			onclick={toggleCollapsed}
			data-slot="right-panel-toggle"
		>
			{#if collapsed}
				<PanelRightOpenIcon size={15} strokeWidth={2.3} aria-hidden="true" />
			{:else}
				<PanelRightCloseIcon size={15} strokeWidth={2.3} aria-hidden="true" />
			{/if}
		</button>

		{#if canGoBack && !collapsed}
			<button
				type="button"
				class="tap-press inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				aria-label={backAria}
				onclick={() => onback?.()}
				data-slot="right-panel-back"
			>
				<ArrowLeftIcon size={14} strokeWidth={2.3} aria-hidden="true" />
			</button>
		{/if}

		{#if !collapsed}
			<div class="min-w-0 flex-1">
				<SectionLabel text={title ?? defaultTitle} variant="station" />
			</div>
		{/if}

		{#if dismissible && !collapsed}
			<button
				type="button"
				class="tap-press -mr-1.5 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				aria-label={closeAria}
				onclick={() => onclose?.()}
				data-slot="right-panel-close"
			>
				<XIcon size={14} strokeWidth={2.3} aria-hidden="true" />
			</button>
		{/if}
	</div>

	<!-- Swap-volet body — keyed so each surface swap re-enters with a slide-in. -->
	{#if !collapsed}
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
	{/if}

	<!-- Sticky footer — pinned to the bottom for actions / provenance. -->
	{#if footer && !collapsed}
		<div
			class="shrink-0 border-t border-border-subtle bg-card px-4 py-3"
			data-slot="right-panel-footer"
		>
			{@render footer()}
		</div>
	{/if}
</aside>

<style>
	.right-panel {
		width: 360px;
		overflow: hidden;
		transition: width 180ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1));
	}

	.right-panel[data-open='false'] {
		width: 3.7rem;
	}

	.right-panel[data-resizable='true'],
	.right-panel[data-resizable='true'][data-open='false'] {
		width: 100%;
		min-width: 0;
	}

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
		.right-panel {
			transition: none;
		}

		.swap-volet {
			animation: none;
		}
	}
</style>
