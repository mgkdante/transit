<!--
  BottomSheet — the mobile detail surface (the phone-shaped stand-in for the
  desktop RightPanel volet). A bottom-anchored sheet (built on the ui/sheet
  bits-ui primitive) that slides up over the full-bleed map to show the selected
  surface; it carries the same body + sticky-footer slots the RightPanel does so
  page code can target both with one set of snippets.

  `open` is bindable so the shell (or page) owns the open/close state; closing
  via the backdrop, the X, or Escape all flow back through the binding. No data
  is wired in 9.2 — body + footer are named snippets with quiet empty states.

  Adapted from the shadcn-svelte sheet usage + transit board theming. Surfaces
  SOLID (the sheet content is bg-popover from the primitive). a11y: the sheet
  primitive supplies role=dialog + focus trap; we supply a labelled title (the
  primitive requires a title for the description-less case) and an aria-label.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import { cn } from '$lib/utils';
	import { type Locale, DEFAULT_LOCALE, getLocale } from '$lib/i18n';
	import * as Sheet from '$lib/components/ui/sheet';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';

	interface BottomSheetProps {
		/** Whether the sheet is open (bindable — the shell/page owns this). */
		open?: boolean;
		/** Active locale (prop wins; falls back to context for isolated renders). */
		locale?: Locale;
		/** Sheet title (visible heading + accessible name). */
		title?: string;
		/** A stable key for the active surface; re-keys the body on swap. */
		surfaceKey?: string;
		/** Whether the active detail surface has a previous item to return to. */
		canGoBack?: boolean;
		/** Fired when the back control is activated. */
		onback?: () => void;
		/** The detail body — the swapped surface content. */
		children?: Snippet;
		/** Sticky footer slot — primary actions / provenance, pinned to the bottom. */
		footer?: Snippet;
		class?: string;
	}

	let {
		open = $bindable(false),
		locale: localeProp,
		title,
		surfaceKey = 'empty',
		canGoBack = false,
		onback,
		children,
		footer,
		class: className,
	}: BottomSheetProps = $props();

	const ctxLocale = getLocale();
	const locale = $derived<Locale>(localeProp ?? ctxLocale ?? DEFAULT_LOCALE);

	const defaultTitle = $derived(locale === 'fr' ? 'Détails' : 'Details');
	const emptyLabel = $derived(
		locale === 'fr' ? 'Sélectionnez un élément' : 'Select something to inspect',
	);
	const backAria = $derived(locale === 'fr' ? 'Retour' : 'Back');
	const sheetAria = $derived(locale === 'fr' ? 'Détails de la sélection' : 'Selection details');
</script>

<Sheet.Root bind:open>
	<Sheet.Content
		side="bottom"
		class={cn('max-h-[85svh] gap-0 p-0', className)}
		aria-label={sheetAria}
		data-slot="bottom-sheet"
	>
		<!-- Drag affordance + title row. The primitive renders its own close X. -->
		<Sheet.Header class="shrink-0 gap-2 border-b border-border-subtle px-4 pb-3 pt-3">
			<span
				class="mx-auto mb-1 h-1 w-9 rounded-full bg-border-strong"
				aria-hidden="true"
				data-slot="bottom-sheet-grabber"
			></span>
			<div class="flex min-w-0 items-center gap-2">
				{#if canGoBack}
					<button
						type="button"
						class="tap-press -ml-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						aria-label={backAria}
						onclick={() => onback?.()}
						data-slot="bottom-sheet-back"
					>
						<ArrowLeftIcon size={15} strokeWidth={2.3} aria-hidden="true" />
					</button>
				{/if}
				<Sheet.Title class="min-w-0 flex-1">
					<SectionLabel text={title ?? defaultTitle} variant="station" />
				</Sheet.Title>
			</div>
		</Sheet.Header>

		<!-- Body — keyed on the active surface so swaps re-enter cleanly. -->
		<div class="min-h-0 flex-1 overflow-y-auto" data-slot="bottom-sheet-body">
			{#key surfaceKey}
				<div class="p-4">
					{#if children}
						{@render children()}
					{:else}
						<p class="px-1 py-6 text-center text-caption text-muted-foreground">
							{emptyLabel}
						</p>
					{/if}
				</div>
			{/key}
		</div>

		<!-- Sticky footer — pinned to the bottom for actions / provenance. -->
		{#if footer}
			<div
				class="shrink-0 border-t border-border-subtle bg-popover px-4 py-3"
				data-slot="bottom-sheet-footer"
			>
				{@render footer()}
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>
