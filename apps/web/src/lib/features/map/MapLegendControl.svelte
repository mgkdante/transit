<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '@yesid/ui/button';
	import { Card } from '@yesid/ui/card';
	import { ChevronToggle } from '@yesid/ui/brand';
	import * as Collapsible from '@yesid/ui/collapsible';
	import * as Sheet from '@yesid/ui/sheet';
	import { ScrollArea } from '@yesid/ui/scroll-area';
	import { desktop } from '@yesid/ui/state';
	import ListIcon from '@lucide/svelte/icons/list';
	import type { Locale } from '#lib/i18n/index.ts';
	import MapLegend from './MapLegend.svelte';
	import { copy } from './map.copy';

	let {
		locale,
		presentation,
		hidden = false,
		open = $bindable(false),
		onopenchange,
	}: {
		locale: Locale;
		presentation: 'phone' | 'desktop';
		hidden?: boolean;
		open?: boolean;
		onopenchange?: (open: boolean) => void;
	} = $props();
	const t = $derived(copy[locale]);
	const storageKey = 'transit:legend-collapsed';
	let expanded = $state(true);
	let sheet = $state<HTMLElement | null>(null);
	let viewport = $state<HTMLElement | null>(null);
	$effect(() => {
		sheet?.setAttribute('tabindex', '0');
		viewport?.setAttribute('role', 'region');
		viewport?.setAttribute('aria-label', t.legend.title);
	});
	let trigger = $state<HTMLButtonElement | null>(null);
	onMount(() => {
		try {
			expanded = localStorage.getItem(storageKey) !== 'true';
		} catch {
			/* Storage is optional. */
		}
	});
	function remember(next: boolean) {
		expanded = next;
		try {
			localStorage.setItem(storageKey, String(!next));
		} catch {
			/* Keep the card usable. */
		}
	}
	$effect(() => {
		if (hidden || desktop.current) open = false;
	});
	function focusSheet(event: Event) {
		event.preventDefault();
		sheet?.focus();
	}
	function restoreFocus(event: Event) {
		event.preventDefault();
		if (document.querySelector('[data-testid="map-filter-drawer"][data-state="open"]')) return;
		trigger?.focus();
	}
</script>

{#if presentation === 'desktop'}
	<Card class="map-legend-card" data-slot="map-legend-card">
		<Collapsible.Root open={expanded} onOpenChange={remember}>
			<Collapsible.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="ghost" class="map-legend-header">
						<ListIcon size={18} aria-hidden="true" />
						<span>{t.legend.title}</span><ChevronToggle open={expanded} size="sm" />
					</Button>
				{/snippet}
			</Collapsible.Trigger>
			<Collapsible.Content>
				<ScrollArea class="map-legend-scroll" bind:viewportRef={viewport}>
					<div class="map-legend-body"><MapLegend {locale} /></div>
				</ScrollArea>
			</Collapsible.Content>
		</Collapsible.Root>
	</Card>
{:else}
	<Sheet.Root bind:open onOpenChange={onopenchange}>
		{#if !hidden && !desktop.current}
			<div class="map-legend-fab" data-slot="map-legend-fab">
				<Sheet.Trigger bind:ref={trigger} aria-label={t.legend.title} aria-expanded={open}>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							size="icon-tap"
							class="map-legend-button"
							data-testid="map-legend-button"
							onclick={() => {
								open = !open;
								onopenchange?.(open);
							}}
						>
							<ListIcon size={20} aria-hidden="true" />
						</Button>
					{/snippet}
				</Sheet.Trigger>
			</div>
		{/if}
		<Sheet.Content
			bind:ref={sheet}
			side="bottom"
			modal={false}
			interactOutsideBehavior="close"
			showCloseButton={false}
			class="map-legend-sheet"
			data-slot="map-legend-sheet"
			onOpenAutoFocus={focusSheet}
			onCloseAutoFocus={restoreFocus}
		>
			<Sheet.Title class="map-legend-sheet-title">{t.legend.title}</Sheet.Title>
			<MapLegend {locale} lead />
		</Sheet.Content>
	</Sheet.Root>
{/if}

<style>
	:global(.map-legend-card.map-legend-card),
	:global(.map-legend-sheet.map-legend-sheet) {
		padding: 0;
		gap: 0;
		background: color-mix(in srgb, var(--card) 92%, transparent);
		border: 1px solid var(--border-hairline);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
		backdrop-filter: blur(var(--glass-blur-sm));
	}
	:global(.map-legend-card) {
		flex: none;
		width: 100%;
	}
	:global(.map-legend-header) {
		display: flex;
		width: 100%;
		min-height: var(--size-tap-min);
		gap: calc(var(--spacing) * 2);
		padding-inline: calc(var(--spacing) * 3);
		font-family: var(--font-body);
		font-size: var(--text-caption);
		color: var(--foreground);
	}
	:global(.map-legend-header > span) {
		flex: 1;
		text-align: left;
	}
	:global(.map-legend-scroll) {
		max-height: var(--map-legend-body-room, 40dvh);
	}
	:global(.map-legend-scroll [data-slot='scroll-area-viewport']) {
		max-height: inherit;
		height: auto;
	}
	.map-legend-body {
		padding: 0 calc(var(--spacing) * 3) calc(var(--spacing) * 3);
	}
	.map-legend-fab {
		position: fixed;
		left: calc(var(--spacing) * 3);
		bottom: calc(
			var(--map-mobile-control-bottom) + var(--size-tap-min) + var(--map-controls-drawer-gap, 10px)
		);
		z-index: calc(var(--z-sheet) + 2);
		pointer-events: auto;
	}
	:global(.map-legend-button) {
		width: var(--size-tap-min);
		height: var(--size-tap-min);
		border-radius: var(--radius-pill);
		background: var(--card);
		box-shadow: var(--shadow-card);
		touch-action: manipulation;
	}
	:global(.map-legend-sheet.map-legend-sheet) {
		--legend-bottom: calc(1rem + env(safe-area-inset-bottom, 0px) + var(--size-tap-min) * 2 + 20px);
		inset: auto auto var(--legend-bottom) calc(var(--spacing) * 3);
		width: min(21rem, calc(100vw - 2rem));
		max-width: none;
		max-height: calc(
			100dvh - var(--legend-bottom) - var(--pill-h) - 2rem - env(safe-area-inset-top, 0px)
		);
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: calc(var(--spacing) * 3);
		transform-origin: left bottom;
	}
	:global(.map-legend-sheet-title) {
		margin: 0 0 calc(var(--spacing) * 2);
		font-family: var(--font-body);
		font-size: var(--text-caption);
		font-weight: 600;
	}
	:global(.map-legend-sheet:focus-visible) {
		outline: calc(var(--spacing) / 2) solid var(--ring);
		outline-offset: calc(var(--spacing) / -2);
	}
	:global(.map-legend-sheet[data-state='open']) {
		animation: transit-sheet-in var(--duration-slow) var(--ease-out) both;
	}
	:global(.map-legend-sheet[data-state='closed']) {
		animation: transit-sheet-out var(--duration-normal) var(--ease-out) both;
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.map-legend-sheet[data-state]) {
			animation: none;
			transition: none;
		}
	}
</style>
