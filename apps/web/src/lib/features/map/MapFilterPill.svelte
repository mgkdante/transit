<!-- Mobile floating Controls pill, patterned after yesid.dev TocPill. Opens the
     unified Controls drawer (the SAME controls snippet the desktop overlay
     renders): the motion toggle pinned to the top, the filters below. -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ChevronToggle } from '$lib/components/brand';
	import type { FilterStore } from '$lib/filters';
	import type { Locale } from '$lib/i18n';
	import { copy as MAP_COPY } from './map.copy';

	interface Props {
		store: FilterStore;
		locale: Locale;
		hidden?: boolean;
		/**
		 * The unified Controls panel snippet (MapFilters in controlsMode + the
		 * inline motion toggle as its header), shared with the desktop overlay so
		 * there is ONE source of truth. Rendered inside the drawer with
		 * `collapsible: false` (a drawer is always expanded) and an `onselect` that
		 * closes the drawer on a pick. MapHero owns the store/routes/stops wiring,
		 * so the pill stays a thin shell.
		 */
		controls: Snippet<[{ collapsible?: boolean; onselect?: () => void } | undefined]>;
	}

	let { store, locale, hidden = false, controls }: Props = $props();
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
			aria-label={`${t.controlsTitle} ${activeCount} · ${t.controlsTitle}`}
		>
			<div class="map-filter-pill-dot" data-active={activeCount > 0}></div>
			<span class="map-filter-pill-name">{t.controlsTitle}</span>
			<span class="map-filter-pill-counter" data-empty={activeCount === 0}>{activeCount}</span>
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

			<div
				class="map-filter-drawer map-filter-drawer-panel"
				data-testid="map-filter-drawer"
				bind:this={drawerEl}
			>
				{@render controls({ collapsible: false, onselect: () => closeDrawer(true) })}
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
		gap: 0.6rem;
		min-height: 44px;
		max-width: calc(100vw - 2rem);
		padding: 0.65rem 1rem 0.65rem 0.85rem;
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
		backdrop-filter: blur(10px) saturate(1.1);
		cursor: pointer;
		transition:
			border-color var(--duration-fast) var(--ease-default),
			background-color var(--duration-fast) var(--ease-default);
	}

	.map-filter-pill:hover {
		border-color: color-mix(in srgb, var(--primary) 45%, var(--border) 55%);
	}

	.map-filter-pill[aria-expanded='true'] {
		border-color: color-mix(in srgb, var(--primary) 55%, transparent);
	}

	.map-filter-pill-dot {
		width: 0.5rem;
		height: 0.5rem;
		flex: none;
		border-radius: 999px;
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
		padding: 0 0.4rem;
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

	@media (prefers-reduced-motion: reduce) {
		.map-filter-pill,
		.map-filter-pill-dot,
		.map-filter-pill-counter {
			transition: none;
		}
	}

	.map-filter-drawer-backdrop {
		position: fixed;
		inset: 0;
		z-index: -1;
		background: transparent;
		border: none;
		cursor: default;
	}

	/* The drawer wrapper carries the card chrome (surface + hairline + blur); the
	   padding belongs here too so the inner Controls panel can strip its own chrome
	   and fill the drawer flush. */
	.map-filter-drawer {
		position: absolute;
		bottom: calc(100% + 10px);
		left: 0;
		width: min(21rem, calc(100vw - 2rem));
		max-height: min(72dvh, calc(100dvh - 7rem));
		overflow-y: auto;
		padding: 1rem;
		background: color-mix(in srgb, var(--card) 95%, transparent);
		border: 1px solid color-mix(in srgb, var(--border) 78%, var(--primary) 22%);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sheet);
		backdrop-filter: blur(12px) saturate(1.1);
		transform: none;
		padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
		overscroll-behavior: contain;
	}

	/* Strip the inner Controls panel's own card chrome: it borrows the drawer's
	   surface (the wrapper above) and fills its full width. */
	.map-filter-drawer :global(.map-filters) {
		width: 100%;
		max-width: none;
		padding: 0;
		background: transparent;
		border: none;
		box-shadow: none;
		backdrop-filter: none;
	}

	.map-filter-pill:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}

	/* Unified map breakpoint: at the desktop layout (>= 1024px) the pill is gone —
	   the unified Controls panel renders as the left overlay instead. Below it the
	   pill is the only controls affordance. Matches layout.isDesktop and the
	   .map-filter-panel hide rule in MapHero, so panel-hide, pill-hide, and the JS
	   layout snapshot all agree on the single 1024 line. */
	@media (min-width: 1024px) {
		.map-filter-pill-container {
			display: none;
		}
	}
</style>
