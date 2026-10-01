<script lang="ts">
	import type { Snippet } from 'svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import XIcon from '@lucide/svelte/icons/x';
	import { cn } from '$lib/utils';
	import { type Locale, DEFAULT_LOCALE, getLocale } from '$lib/i18n';
	import * as Sheet from '@yesid/ui/sheet';
	import { SectionLabel } from '@yesid/ui/brand';

	interface BottomSheetProps {
		open?: boolean;
		locale?: Locale;
		title?: string;
		identity?: Snippet;
		surfaceKey?: string;
		canGoBack?: boolean;
		onback?: () => void;
		children?: Snippet;
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
