<!-- Mobile Controls trigger + anchored modal drawer. The shared controls snippet
     remains the single filter/motion owner; this shell owns only open/close. -->
<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { ChevronToggle } from '@yesid/ui/brand';
	import * as Sheet from '@yesid/ui/sheet';
	import type { FilterStore } from '$lib/filters';
	import type { Locale } from '$lib/i18n';
	import { copy as MAP_COPY } from './map.copy';

	interface Props {
		store: FilterStore;
		locale: Locale;
		hidden?: boolean;
		controls: Snippet<[{ collapsible?: boolean } | undefined]>;
	}

	let { store, locale, hidden = false, controls }: Props = $props();
	const t = $derived(MAP_COPY[locale]);
	const activeCount = $derived(store.chips.length);

	let drawerOpen = $state(false);
	let desktopHandoff = false;
	let pillBtn = $state<HTMLButtonElement | null>(null);
	let drawerTitle = $state<HTMLElement | null>(null);

	onMount(() => {
		const desktopQuery = window.matchMedia('(min-width: 1024px)');
		const closeAtDesktop = (event: MediaQueryListEvent) => {
			if (!event.matches || !drawerOpen) return;
			desktopHandoff = true;
			drawerOpen = false;
		};
		desktopQuery.addEventListener('change', closeAtDesktop);
		return () => desktopQuery.removeEventListener('change', closeAtDesktop);
	});

	function focusTitle(event: Event): void {
		event.preventDefault();
		drawerTitle?.focus();
	}

	function focusDesktopControls(event: Event): void {
		if (!desktopHandoff) return;
		event.preventDefault();
		desktopHandoff = false;
		const panel = document.querySelector<HTMLElement>('.map-filter-panel .map-filters');
		const target = panel?.dataset.open === 'false' ? '.mf-rail-expand' : '.mf-toggle';
		panel?.querySelector<HTMLButtonElement>(target)?.focus();
	}

	// The detail overlay removes the trigger from the DOM, so an open drawer would
	// be left with no owner. Nothing else closes it: a feed that is not responding
	// leaves the Controls fully present and open (M6f-2 F14).
	$effect(() => {
		if (!hidden || !drawerOpen) return;
		drawerOpen = false;
	});
</script>

<Sheet.Root bind:open={drawerOpen}>
	{#if !hidden}
		<div class="map-filter-pill-container" data-testid="map-filter-pill">
			<Sheet.Trigger
				bind:ref={pillBtn}
				type="button"
				class="tap-press map-filter-pill"
				aria-expanded={drawerOpen}
			>
				<span class="map-filter-pill-dot" data-active={activeCount > 0}></span>
				<span class="map-filter-pill-name">{t.controlsTitle}</span>
				<span class="map-filter-pill-counter" data-empty={activeCount === 0}>{activeCount}</span>
				<ChevronToggle open={drawerOpen} size="sm" direction="down" />
			</Sheet.Trigger>
		</div>
	{/if}

	<Sheet.Content
		side="bottom"
		showCloseButton={false}
		class="m6b-controls-drawer inset-x-auto top-auto h-auto w-auto max-w-none gap-0 overflow-y-auto rounded-lg border p-0"
		data-m6b-controls-drawer=""
		data-testid="map-filter-drawer"
		onOpenAutoFocus={focusTitle}
		onCloseAutoFocus={focusDesktopControls}
	>
		<Sheet.Title
			bind:ref={drawerTitle}
			class="sr-only"
			tabindex={-1}
			data-testid="map-filter-drawer-title"
		>
			{t.controlsTitle}
		</Sheet.Title>

		<div class="map-filter-drawer-controls">
			{@render controls({ collapsible: false })}
		</div>

		<footer class="map-filter-drawer-footer">
			<Sheet.Close type="button" class="map-filter-done" data-testid="map-filter-done">
				{t.controlsDone}
			</Sheet.Close>
		</footer>
	</Sheet.Content>
</Sheet.Root>

<style>
	.map-filter-pill-container {
		position: fixed;
		bottom: var(--map-mobile-control-bottom);
		left: 0.75rem;
		transform: none;
		z-index: var(--z-sheet);
	}

	.map-filter-pill-container :global(.map-filter-pill) {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 44px;
		max-width: calc(100vw - 2rem);
		padding: 0.625rem 1rem 0.625rem 0.875rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--foreground);
		white-space: nowrap;
		background: color-mix(in srgb, var(--card) 92%, transparent);
		border: 1px solid color-mix(in srgb, var(--border) 80%, var(--primary) 20%);
		border-radius: var(--radius-pill);
		box-shadow: var(--shadow-card);
		backdrop-filter: blur(12px) saturate(1.1);
		-webkit-backdrop-filter: blur(12px) saturate(1.1);
		cursor: pointer;
		transition:
			border-color var(--duration-fast) var(--ease-default),
			background-color var(--duration-fast) var(--ease-default);
	}
	.map-filter-pill-container :global(.map-filter-pill:hover),
	.map-filter-pill-container :global(.map-filter-pill[aria-expanded='true']) {
		border-color: color-mix(in srgb, var(--primary) 55%, transparent);
	}
	.map-filter-pill-dot {
		width: 0.5rem;
		height: 0.5rem;
		flex: none;
		border-radius: var(--radius-pill);
		background: var(--primary);
		transition: box-shadow var(--duration-fast) var(--ease-default);
	}
	.map-filter-pill-dot[data-active='true'] {
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 22%, transparent);
	}
	.map-filter-pill-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.map-filter-pill-counter {
		display: inline-grid;
		place-items: center;
		min-width: 1.4rem;
		height: 1.4rem;
		padding: 0 0.375rem;
		font-variant-numeric: tabular-nums;
		color: var(--primary-foreground);
		background: var(--primary);
		border-radius: var(--radius-pill);
		flex-shrink: 0;
		transition:
			color var(--duration-fast) var(--ease-default),
			background-color var(--duration-fast) var(--ease-default);
	}
	.map-filter-pill-counter[data-empty='true'] {
		color: var(--muted-foreground);
		background: color-mix(in srgb, var(--muted) 70%, transparent);
		box-shadow: inset 0 0 0 1px var(--border-subtle);
	}

	:global([data-m6b-controls-drawer][data-slot='sheet-content']) {
		/* The Sheet is portaled under body, so derive its nav clearance directly from
		   the root-published pill height and the pill's fixed top inset. Add this
		   drawer's established 10px surface gap to the pill's actual lower edge. The
		   max-height cap enforces that minimum top inset only when needed; naturally
		   shorter drawers (including 390×844) keep their position. */
		--map-controls-drawer-gap: 10px;
		--map-controls-drawer-top: calc(
			1rem + env(safe-area-inset-top, 0px) + var(--pill-h) + var(--map-controls-drawer-gap)
		);
		--map-controls-drawer-bottom: calc(
			5.25rem + env(safe-area-inset-bottom, 0px) + 44px + var(--map-controls-drawer-gap)
		);
		top: auto;
		left: 0.75rem;
		right: auto;
		bottom: var(--map-controls-drawer-bottom);
		display: block;
		width: min(21rem, calc(100vw - 2rem));
		max-width: none;
		max-height: min(
			72dvh,
			calc(100dvh - var(--map-controls-drawer-top) - var(--map-controls-drawer-bottom))
		);
		overflow-y: auto;
		padding: 0;
		background: color-mix(in srgb, var(--card) 95%, transparent);
		border: 1px solid color-mix(in srgb, var(--border) 78%, var(--primary) 22%);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sheet);
		backdrop-filter: blur(12px) saturate(1.1);
		-webkit-backdrop-filter: blur(12px) saturate(1.1);
		transform-origin: left bottom;
		overscroll-behavior: contain;
	}
	:global([data-m6b-controls-drawer][data-slot='sheet-content'][data-state='open']) {
		animation: m6b-controls-drawer-in var(--duration-slow) var(--ease-out) both;
	}
	:global([data-m6b-controls-drawer][data-slot='sheet-content'][data-state='closed']) {
		animation: m6b-controls-drawer-out var(--duration-normal) var(--ease-out) both;
	}
	:global([data-m6b-controls-drawer] .map-filters) {
		width: 100%;
		max-width: none;
		max-height: none;
		padding: 0;
		background: transparent;
		border: none;
		border-radius: 0;
		box-shadow: none;
		backdrop-filter: none;
		-webkit-backdrop-filter: none;
		overflow: visible;
	}
	.map-filter-drawer-footer {
		position: sticky;
		bottom: 0;
		z-index: 2;
		display: flex;
		padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom, 0px));
		background: color-mix(in srgb, var(--card) 96%, transparent);
		border-top: 1px solid var(--border-subtle);
	}
	.map-filter-drawer-footer :global(.map-filter-done) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		min-height: 44px;
		padding: 0.5rem 1rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 700;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--primary-foreground);
		background: var(--primary);
		border: 1px solid var(--primary);
		border-radius: var(--radius-pill);
		cursor: pointer;
	}

	@keyframes m6b-controls-drawer-in {
		from {
			opacity: 0;
			transform: translateY(0.75rem) scale(0.985);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}
	@keyframes m6b-controls-drawer-out {
		from {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
		to {
			opacity: 0;
			transform: translateY(0.5rem) scale(0.99);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.map-filter-pill-container :global(.map-filter-pill),
		.map-filter-pill-dot,
		.map-filter-pill-counter,
		:global([data-m6b-controls-drawer][data-slot='sheet-content']),
		:global([data-m6b-controls-drawer][data-slot='sheet-content'][data-state='open']),
		:global([data-m6b-controls-drawer][data-slot='sheet-content'][data-state='closed']),
		:global([data-slot='sheet-overlay'][data-state]:has(+ [data-m6b-controls-drawer])) {
			animation: none;
			transition: none;
		}
	}

	@media (min-width: 1024px) {
		.map-filter-pill-container {
			display: none;
		}
	}
</style>
