<!--
  ListingPageShell — the shared yesid.dev Blog/Projects listing architecture.

  Desktop: giant sticky edge title | 2px accent rail | full-width blueprint
  header, then a sticky 220–320px filter rail beside the results. Mobile follows
  yesid.dev Blog/Projects in normal document flow: search, a full-width filter
  disclosure, then results. One controls DOM changes its presentation at the
  breakpoint, so state and labels cannot drift.
-->
<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { ChevronToggle } from '@yesid/ui/brand';
	import { Separator } from '@yesid/ui/separator';
	import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@yesid/ui/collapsible';
	import { isDesktopViewport, layout } from '$lib/nav';
	import { persisted } from '$lib/stores';

	export interface ListingPageShellProps {
		heading: string;
		filterLabel: string;
		filterPersistKey?: string;
		header: Snippet;
		search?: Snippet;
		filters: Snippet;
		children: Snippet;
	}

	let {
		heading,
		filterLabel,
		filterPersistKey,
		header,
		search,
		filters,
		children,
	}: ListingPageShellProps = $props();

	const persistedOpen = untrack(() =>
		filterPersistKey ? persisted(filterPersistKey, false) : null,
	);
	let localOpen = $state(false);
	const desktop = $derived(layout.isDesktop || isDesktopViewport());
	const mobileFilterOpen = $derived(persistedOpen ? persistedOpen.value : localOpen);
	const filterOpen = $derived(desktop || mobileFilterOpen);
	function setFilterOpen(next: boolean): void {
		if (desktop) return;
		if (persistedOpen) persistedOpen.value = next;
		else localOpen = next;
	}
</script>

<section class="listing-layout" data-slot="listing-page-shell">
	<div class="edge-title-column" data-slot="listing-edge-title" aria-hidden="true">
		<div class="edge-title">{heading}<span class="edge-dot">.</span></div>
		<div class="metro-dots metro-dots-top">
			<div class="metro-line"></div>
			<div class="metro-dot metro-dot-sm"></div>
			<div class="metro-dot metro-dot-sm"></div>
			<div class="metro-dot metro-dot-sm"></div>
			<div class="metro-dot metro-dot-lg"></div>
		</div>
		<div class="metro-dots metro-dots-bottom">
			<div class="metro-dot metro-dot-lg"></div>
			<div class="metro-dot metro-dot-sm"></div>
			<div class="metro-dot metro-dot-sm"></div>
			<div class="metro-dot metro-dot-sm"></div>
			<div class="metro-line"></div>
		</div>
	</div>

	<div class="accent-rail" data-slot="listing-accent-rail" aria-hidden="true"></div>

	<div class="listing-main">
		{@render header()}
		<Separator variant="hazard" data-testid="listing-page-separator" />

		<div class="listing-grid">
			<aside class="listing-filter-column" data-slot="listing-filter-column">
				<div class="listing-filter-sticky">
					{#if search}
						<div class="listing-filter-search" data-slot="listing-filter-search">
							{@render search()}
						</div>
					{/if}

					<Collapsible bind:open={() => filterOpen, setFilterOpen}>
						<CollapsibleTrigger>
							{#snippet child({ props })}
								<button
									{...props}
									type="button"
									class="mobile-filter-toggle tap-press"
									data-slot="listing-filter-toggle"
								>
									<span>{filterLabel}</span>
									<ChevronToggle open={filterOpen} size="sm" direction="right" />
								</button>
							{/snippet}
						</CollapsibleTrigger>

						<CollapsibleContent
							forceMount
							class="listing-filter-body"
							data-slot="listing-filter-body"
						>
							<div class="listing-filter-overflow">
								<div class="listing-filter-shell">{@render filters()}</div>
							</div>
						</CollapsibleContent>
					</Collapsible>
				</div>
			</aside>

			<div class="listing-content" data-slot="listing-content">
				{@render children()}
			</div>
		</div>
	</div>
</section>

<style>
	.listing-layout {
		display: block;
		width: 100%;
		min-width: 0;
	}

	.edge-title-column,
	.accent-rail {
		display: none;
	}

	.listing-main,
	.listing-content {
		min-width: 0;
	}

	.listing-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		width: 100%;
	}

	.listing-filter-column {
		min-width: 0;
	}

	.listing-filter-sticky {
		padding: 1.5rem var(--space-page-x) 1rem;
	}

	.listing-filter-search {
		margin-bottom: 1rem;
	}
	.listing-filter-search :global([data-slot='listing-search-field']) {
		margin: 0;
		padding: 0;
		border-top: 0;
	}

	.listing-content {
		padding: 0 var(--space-page-x) 4rem;
	}

	.mobile-filter-toggle {
		display: flex;
		width: 100%;
		min-height: var(--size-tap-min);
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		border-radius: var(--radius-md);
		border: 2px solid var(--border-brand);
		background: var(--card);
		padding: 0.75rem 0.875rem;
		font-family: var(--font-mono);
		font-size: var(--text-control);
		font-weight: 700;
		text-transform: uppercase;
		color: var(--foreground);
		cursor: pointer;
		white-space: nowrap;
		transition:
			border-color var(--duration-normal) var(--ease-default),
			color var(--duration-normal) var(--ease-default),
			box-shadow var(--duration-normal) var(--ease-default);
	}

	.mobile-filter-toggle:hover,
	.mobile-filter-toggle:focus-visible {
		border-color: var(--primary);
		color: var(--primary);
		outline: none;
	}

	:global([data-slot='listing-filter-body'].collapsible-content.listing-filter-body) {
		display: grid;
		grid-template-rows: 0fr;
		transition: grid-template-rows var(--duration-normal) var(--ease-default);
	}

	:global(
		[data-slot='listing-filter-body'].collapsible-content.listing-filter-body[data-state='open']
	) {
		grid-template-rows: 1fr;
	}

	.listing-filter-overflow {
		min-height: 0;
		overflow: hidden;
	}

	.listing-filter-shell {
		margin-top: 0.75rem;
		border: 2px solid var(--border-brand);
		border-radius: var(--radius-md);
		background: var(--card);
		padding: 0.875rem;
	}

	@media (min-width: 768px) and (max-width: 1023px) {
		.listing-filter-sticky {
			padding-inline: 1.5rem;
		}

		.listing-content {
			padding-inline: 1.5rem;
		}
	}

	@media (min-width: 1024px) {
		.listing-layout {
			display: grid;
			grid-template-columns: auto 2px minmax(0, 1fr);
			margin-top: calc(-1 * var(--chrome-offset));
		}

		.listing-main {
			padding-top: var(--chrome-offset);
		}

		.edge-title-column {
			display: flex;
			align-items: center;
			justify-content: center;
			position: sticky;
			top: 0;
			height: 100dvh;
			writing-mode: vertical-rl;
			transform: rotate(180deg);
			padding: 1rem 1.5rem;
		}

		.edge-title {
			font-family: var(--font-heading);
			font-size: clamp(6rem, 12vw, 13rem);
			font-weight: 900;
			color: var(--foreground);
			white-space: nowrap;
			line-height: 1;
			letter-spacing: -0.04em;
		}

		.edge-dot {
			color: var(--primary);
		}

		.accent-rail {
			display: block;
			background: color-mix(in srgb, var(--primary) 35%, transparent);
		}

		.listing-grid {
			grid-template-columns: var(--layout-control-rail-width) minmax(0, 1fr);
		}

		.listing-filter-sticky {
			position: sticky;
			top: var(--chrome-offset);
			max-height: calc(100dvh - var(--chrome-offset));
			overflow-y: auto;
			padding: 1rem;
		}

		.listing-filter-search {
			margin-bottom: 0;
		}
		.listing-filter-search :global([data-slot='listing-search-field']) {
			margin-bottom: 1.5rem;
			padding-top: 0.75rem;
			padding-bottom: 1.25rem;
			border-top: 2px dashed var(--border-rule);
		}

		.mobile-filter-toggle {
			display: none;
		}

		:global([data-slot='listing-filter-body'].collapsible-content.listing-filter-body) {
			display: grid;
			position: static;
			width: auto;
			max-height: none;
			transform: none;
			grid-template-rows: 1fr;
			border: 0;
			border-radius: 0;
			background: transparent;
			box-shadow: none;
			opacity: 1;
			pointer-events: auto;
		}

		.listing-filter-overflow {
			overflow: visible;
		}

		.listing-filter-shell {
			margin-top: 0;
			border: 0;
			border-radius: 0;
			background: transparent;
			padding: 0;
		}

		.listing-content {
			padding: 2rem 1.5rem 4rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.mobile-filter-toggle,
		:global([data-slot='listing-filter-body'].collapsible-content.listing-filter-body) {
			transition: none;
		}
	}

	.metro-dots {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		writing-mode: horizontal-tb;
	}

	.metro-dots-top {
		top: 16px;
	}

	.metro-dots-bottom {
		bottom: 16px;
	}

	.metro-line {
		width: 2px;
		height: 32px;
		background: color-mix(in srgb, var(--primary) 25%, transparent);
	}

	.metro-dot {
		border-radius: 50%;
	}

	.metro-dot-sm {
		width: 6px;
		height: 6px;
		border: 1.5px solid color-mix(in srgb, var(--primary) 35%, transparent);
	}

	.metro-dot-lg {
		width: 10px;
		height: 10px;
		background: color-mix(in srgb, var(--primary) 25%, transparent);
		border: 2px solid color-mix(in srgb, var(--primary) 45%, transparent);
	}
</style>
