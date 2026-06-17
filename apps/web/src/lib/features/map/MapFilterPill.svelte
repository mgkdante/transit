<!-- Mobile floating filter pill, patterned after yesid.dev TocPill. -->
<script lang="ts">
	import { ChevronToggle } from '$lib/components/brand';
	import type { FilterStore } from '$lib/filters';
	import type { Locale } from '$lib/i18n';
	import type { RouteIndexEntry, StopIndexEntry } from '$lib/v1';
	import MapFilters from './MapFilters.svelte';
	import { copy as MAP_COPY } from './map.copy';

	interface Props {
		store: FilterStore;
		locale: Locale;
		routes?: readonly RouteIndexEntry[];
		stops?: readonly StopIndexEntry[];
		hidden?: boolean;
	}

	let { store, locale, routes = [], stops = [], hidden = false }: Props = $props();
	const t = $derived(MAP_COPY[locale]);
	const activeCount = $derived(store.chips.length);

	let drawerOpen = $state(false);
	let pillBtn = $state<HTMLButtonElement>();
	let drawerEl = $state<HTMLElement>();

	function closeDrawer(restoreFocus = false): void {
		drawerOpen = false;
		if (restoreFocus) pillBtn?.focus();
	}

	function onKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape' && drawerOpen) {
			e.stopPropagation();
			closeDrawer(true);
		}
	}

	$effect(() => {
		if (hidden && drawerOpen) {
			closeDrawer(false);
			return;
		}
		if (drawerOpen && drawerEl) {
			drawerEl.querySelector<HTMLElement>('.mf-chip')?.focus();
		}
	});
</script>

<svelte:window onkeydown={onKeydown} />

{#if !hidden}
	<div class="map-filter-pill-container" data-testid="map-filter-pill">
		<button
			bind:this={pillBtn}
			type="button"
			class="tap-press map-filter-pill"
			onclick={() => (drawerOpen = !drawerOpen)}
			aria-expanded={drawerOpen}
			aria-label={`${t.filterTitle} ${activeCount} · ${t.filterTitle}`}
		>
			<div class="map-filter-pill-dot"></div>
			<span class="map-filter-pill-name">{t.filterTitle}</span>
			<span class="map-filter-pill-counter">{activeCount}</span>
			<ChevronToggle open={drawerOpen} size="sm" direction="down" />
		</button>

		{#if drawerOpen}
			<button
				type="button"
				class="map-filter-drawer-backdrop"
				tabindex="-1"
				onclick={() => closeDrawer(true)}
				aria-label={t.filterClose}
			></button>

			<div class="map-filter-drawer" data-testid="map-filter-drawer" bind:this={drawerEl}>
				<MapFilters
					{store}
					{locale}
					{routes}
					{stops}
					collapsible={false}
					onselect={() => closeDrawer(true)}
					class="map-filter-drawer-panel"
				/>
			</div>
		{/if}
	</div>
{/if}

<style>
	.map-filter-pill-container {
		position: fixed;
		bottom: calc(2.5rem + env(safe-area-inset-bottom, 0px));
		left: 0.75rem;
		transform: none;
		z-index: var(--z-sheet);
	}

	.map-filter-pill {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		max-width: calc(100vw - 2rem);
		padding: 12px 20px;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: color-mix(in srgb, var(--foreground) 65%, transparent);
		white-space: nowrap;
		background: color-mix(in srgb, var(--background) 95%, transparent);
		border: 1px solid color-mix(in srgb, var(--primary) 20%, transparent);
		border-radius: var(--radius-pill);
		backdrop-filter: blur(8px);
		cursor: pointer;
	}

	.map-filter-pill-dot {
		width: 0.375rem;
		height: 0.375rem;
		flex: none;
		border-radius: 999px;
		background: var(--primary);
	}

	.map-filter-pill-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.map-filter-pill-counter {
		color: color-mix(in srgb, var(--primary) 85%, transparent);
		flex-shrink: 0;
	}

	.map-filter-drawer-backdrop {
		position: fixed;
		inset: 0;
		z-index: -1;
		background: transparent;
		border: none;
		cursor: default;
	}

	.map-filter-drawer {
		position: absolute;
		bottom: calc(100% + 10px);
		left: 0;
		width: min(21rem, calc(100vw - 2rem));
		max-height: min(72dvh, calc(100dvh - 7rem));
		overflow-y: auto;
		background: color-mix(in srgb, var(--background) 97%, transparent);
		border: 1px solid color-mix(in srgb, var(--primary) 15%, transparent);
		border-radius: 12px;
		box-shadow: var(--shadow-sheet);
		backdrop-filter: blur(12px);
		transform: none;
		padding-bottom: env(safe-area-inset-bottom, 0px);
		overscroll-behavior: contain;
	}

	.map-filter-drawer :global(.map-filter-drawer-panel) {
		width: 100%;
		max-width: none;
		padding: 1rem;
		background: transparent;
		border: none;
		box-shadow: none;
		backdrop-filter: none;
	}

	.map-filter-pill:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}

	@media (min-width: 761px) {
		.map-filter-pill-container {
			display: none;
		}
	}
</style>
