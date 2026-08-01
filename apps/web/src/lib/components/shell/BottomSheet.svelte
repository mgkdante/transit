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
	import XIcon from '@lucide/svelte/icons/x';
	import { cn } from '$lib/utils';
	import { type Locale, DEFAULT_LOCALE, getLocale } from '$lib/i18n';
	import * as Sheet from '@yesid/ui/sheet';
	import { SectionLabel } from '@yesid/ui/brand';

	interface BottomSheetProps {
		/** Whether the sheet is open (bindable — the shell/page owns this). */
		open?: boolean;
		/** Active locale (prop wins; falls back to context for isolated renders). */
		locale?: Locale;
		/** Sheet title (visible heading + accessible name). */
		title?: string;
		/** Optional entity identity rendered inside the Sheet title. */
		identity?: Snippet;
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
		identity,
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
	const closeAria = $derived(locale === 'fr' ? 'Fermer les détails' : 'Close details');
</script>

<Sheet.Root bind:open>
	<Sheet.Content
		side="bottom"
		showCloseButton={false}
		class={cn('max-h-[85svh] gap-0 p-0', className)}
		data-slot="bottom-sheet"
		data-m6c2-detail-sheet=""
	>
		<div
			class="min-h-0 flex flex-1 flex-col"
			style="padding-bottom: env(safe-area-inset-bottom);"
			data-slot="bottom-sheet-safe-area"
		>
			<Sheet.Header class="shrink-0 gap-2 border-b border-border-subtle px-4 pb-3 pt-3">
				<div class="flex min-w-0 items-center gap-2">
					{#if canGoBack}
						<button
							type="button"
							class="tap-press -ml-1 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							aria-label={backAria}
							onclick={() => onback?.()}
							data-slot="bottom-sheet-back"
						>
							<ArrowLeftIcon size={15} strokeWidth={2.3} aria-hidden="true" />
						</button>
					{/if}
					<Sheet.Title class="min-w-0 flex-1">
						{#if identity}
							{@render identity()}
						{:else}
							<SectionLabel text={title ?? defaultTitle} variant="station" />
						{/if}
					</Sheet.Title>
					<button
						type="button"
						class="tap-press -mr-1 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						aria-label={closeAria}
						onclick={() => (open = false)}
						data-slot="bottom-sheet-close"
					>
						<XIcon size={18} strokeWidth={2.3} aria-hidden="true" />
					</button>
				</div>
			</Sheet.Header>

			<!-- Body — keyed on the active surface so swaps re-enter cleanly. -->
			<div class="bottom-sheet-body min-h-0 flex-1 overflow-y-auto" data-slot="bottom-sheet-body">
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
					class="empty:hidden shrink-0 border-t border-border-subtle bg-popover px-4 py-3"
					data-slot="bottom-sheet-footer"
				>
					{@render footer()}
				</div>
			{/if}
		</div>
	</Sheet.Content>
</Sheet.Root>

<style>
	.bottom-sheet-body {
		container: right-panel / inline-size;
	}

	@media (prefers-reduced-motion: no-preference) {
		:global([data-m6c2-detail-sheet][data-slot='bottom-sheet'][data-state='open']) {
			animation: m6c2-detail-sheet-in var(--duration-slow) var(--ease-out) both;
			transition: none;
		}
		:global([data-m6c2-detail-sheet][data-slot='bottom-sheet'][data-state='closed']) {
			animation: m6c2-detail-sheet-out var(--duration-normal) var(--ease-out) both;
			transition: none;
		}
	}

	@keyframes m6c2-detail-sheet-in {
		from {
			opacity: 0;
			transform: translateY(0.75rem) scale(0.985);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	@keyframes m6c2-detail-sheet-out {
		from {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
		to {
			opacity: 0;
			transform: translateY(0.5rem) scale(0.99);
		}
	}
</style>
