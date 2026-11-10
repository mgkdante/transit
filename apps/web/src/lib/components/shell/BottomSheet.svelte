<script lang="ts">
	import { sheetCopy } from './sheet.copy';
	import type { Snippet } from 'svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import XIcon from '@lucide/svelte/icons/x';
	import { cn } from '#lib/utils/index.ts';
	import { Button } from '@yesid/ui/button';
	import { type Locale, DEFAULT_LOCALE, getLocale } from '#lib/i18n/index.ts';
	import * as Sheet from '@yesid/ui/sheet';
	import type { SheetDetent } from '@yesid/ui/sheet';
	import { SectionLabel } from '@yesid/ui/brand';

	interface BottomSheetProps {
		open?: boolean;
		locale?: Locale;
		title?: string;
		identity?: Snippet;
		navigation?: Snippet;
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
		navigation,
		surfaceKey = 'empty',
		canGoBack = false,
		onback,
		children,
		footer,
		class: className,
	}: BottomSheetProps = $props();

	const ctxLocale = getLocale();
	const locale = $derived<Locale>(localeProp ?? ctxLocale ?? DEFAULT_LOCALE);

	const defaultTitle = $derived(sheetCopy[locale].title);
	const emptyLabel = $derived(sheetCopy[locale].empty);
	const backAria = $derived(sheetCopy[locale].back);
	const closeAria = $derived(sheetCopy[locale].closeDetails);

	// Peek holds the 44 px handle, the header (44 px controls, 24 px padding, a border,
	// with room for a two-line identity) and a 34 px home-indicator inset, so the
	// back and close controls stay clear of it. The rider's last height survives reopening.
	const PEEK_PX = 168;
	// Full stops below the site header, so the nav and provider control stay visible and usable.
	let fullPx = $state<number | null>(null);
	const detents = $derived<SheetDetent[]>([
		{ id: 'peek', size: `${PEEK_PX}px`, label: sheetCopy[locale].peek },
		{ id: 'half', size: '50%', label: sheetCopy[locale].half },
		{ id: 'full', size: fullPx === null ? '90%' : `${fullPx}px`, label: sheetCopy[locale].full },
	]);
	let detent = $state('half');

	$effect(() => {
		if (!open) return;
		const measure = () => (fullPx = fullHeightBelowHeader());
		measure();
		window.addEventListener('resize', measure);
		return () => window.removeEventListener('resize', measure);
	});

	// Mirrors AppShell's --chrome-offset: the header's fixed top, the pill plus provider
	// row (--pill-h, measured by NavPill) and the shell's 0.5rem chrome gap.
	function fullHeightBelowHeader(): number | null {
		const header = document.querySelector('[data-slot="site-header"]');
		const pill = Number.parseFloat(
			getComputedStyle(document.documentElement).getPropertyValue('--pill-h'),
		);
		if (!header || !Number.isFinite(pill)) return null;
		const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
		const covered = header.getBoundingClientRect().top + pill + rem / 2;
		return Math.max(PEEK_PX + 1, Math.floor(window.innerHeight - covered));
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content
		side="bottom"
		modal={false}
		{detents}
		bind:detent
		handleLabel={sheetCopy[locale].height}
		showCloseButton={false}
		class={cn('gap-0 p-0', className)}
		data-slot="bottom-sheet"
		data-m6c2-detail-sheet=""
	>
		<div
			class="min-h-0 flex flex-1 flex-col"
			style="padding-bottom: env(safe-area-inset-bottom);"
			data-slot="bottom-sheet-safe-area"
		>
			<Sheet.Header class="shrink-0 gap-2 text-left border-b border-border-subtle px-4 pb-3 pt-3">
				<div class="flex min-w-0 items-center gap-2">
					{#if canGoBack}
						<Button
							variant="ghost"
							size="icon-tap"
							type="button"
							class="order-last text-muted-foreground"
							aria-label={backAria}
							onclick={() => onback?.()}
							data-slot="bottom-sheet-back"
						>
							<ArrowLeftIcon size={15} strokeWidth={2.3} aria-hidden="true" />
						</Button>
					{/if}
					<Sheet.Title class="min-w-0 flex-1">
						{#if identity}
							{@render identity()}
						{:else}
							<SectionLabel text={title ?? defaultTitle} variant="station" />
						{/if}
					</Sheet.Title>
					<Button
						variant="ghost"
						size="icon-tap"
						type="button"
						class="order-last -mr-1 text-muted-foreground"
						aria-label={closeAria}
						onclick={() => (open = false)}
						data-slot="bottom-sheet-close"
					>
						<XIcon size={18} strokeWidth={2.3} aria-hidden="true" />
					</Button>
				</div>
				{#if navigation}{@render navigation()}{/if}
			</Sheet.Header>

			<div
				class="bottom-sheet-body min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain"
				data-slot="bottom-sheet-body"
			>
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
				{#if footer}
					<div
						class="empty:hidden shrink-0 border-t border-border-subtle bg-popover px-4 py-3"
						data-slot="bottom-sheet-footer"
					>
						{@render footer()}
					</div>
				{/if}
			</div>
		</div>
	</Sheet.Content>
</Sheet.Root>

<style>
	:global([data-m6c2-detail-sheet][data-slot='bottom-sheet']) {
		max-height: 100dvh;
	}

	.bottom-sheet-body {
		container: right-panel / inline-size;
	}

	@media (prefers-reduced-motion: no-preference) {
		:global([data-m6c2-detail-sheet][data-slot='bottom-sheet'][data-state='open']) {
			animation: transit-sheet-in var(--duration-slow) var(--ease-out) both;
			transition: none;
		}
		:global([data-m6c2-detail-sheet][data-slot='bottom-sheet'][data-state='closed']) {
			animation: transit-sheet-out var(--duration-normal) var(--ease-out) both;
			transition: none;
		}
	}
</style>
