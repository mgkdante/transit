<!--
  Listing page frame: on desktop a vertical edge title and accent rail beside the page; a
  blueprint header; the hazard rule; a filter column (search plus a filter panel that collapses
  below 1024px) and the results.

  CSS shows the panel from 1024px in every state, so desktop filters work before hydration and
  without JavaScript. Below 1024px a closed panel is `visibility: hidden`, never `inert`.
-->
<script lang="ts" module>
	import type { Snippet } from 'svelte';

	export interface ListingFrameProps {
		/** The page h1; visually hidden from 1024px, where the edge title shows. */
		heading: string;
		/** Defaults to `heading`. Decorative, so hidden from assistive technology. */
		edgeTitle?: string;
		subtitle: string;
		description?: string;
		/** Header artwork, usually a `BlueprintShell`, drawn in the frame's `--blueprint-ink`. */
		blueprint: Snippet;
		/** Beside the header copy from 1024px, below it on smaller screens. */
		aside?: Snippet;
		/** Runs once on mount, e.g. to start a scroll scrub; the returned cleanup runs on unmount. */
		onHeaderMount?: (header: HTMLElement, frame: HTMLElement) => (() => void) | void;
		/** Text of the button that opens the filter panel below 1024px. */
		filterLabel: string;
		/** Keeps the panel's open state in `persisted(filterPersistKey)`. */
		filterPersistKey?: string;
		search?: Snippet;
		filters: Snippet;
		children: Snippet;
	}
</script>

<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { scrollChain } from '@yesid/motion/actions';
	import ChevronToggle from '../brand/ChevronToggle.svelte';
	import { Separator } from '../primitives/separator/index.js';
	import { persisted } from '../state/persisted.svelte.js';

	let {
		heading,
		edgeTitle,
		subtitle,
		description,
		blueprint,
		aside,
		onHeaderMount,
		filterLabel,
		filterPersistKey,
		search,
		filters,
		children,
	}: ListingFrameProps = $props();

	const uid = $props.id();
	const panelId = `${uid}-filters`;
	const storedOpen = untrack(() => (filterPersistKey ? persisted(filterPersistKey, false) : null));
	let localOpen = $state(false);
	const filterOpen = $derived(storedOpen ? storedOpen.value : localOpen);
	function toggleFilters(): void {
		if (storedOpen) storedOpen.value = !storedOpen.value;
		else localOpen = !localOpen;
	}

	let frameEl: HTMLElement;
	let headerEl: HTMLElement;
	onMount(() => {
		const cleanup = onHeaderMount?.(headerEl, frameEl);
		return () => cleanup?.();
	});
</script>

<section bind:this={frameEl} class="listing-layout" data-slot="listing-frame">
	<div class="edge-title-column" data-slot="listing-edge-title" aria-hidden="true">
		<div class="edge-title">{edgeTitle ?? heading}<span class="edge-dot">.</span></div>
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
		<header
			bind:this={headerEl}
			class="listing-blueprint-header"
			data-slot="blueprint-listing-header"
		>
			<div class="listing-blueprint-art" data-slot="blueprint-listing-art">
				{@render blueprint()}
			</div>

			<div
				class="listing-header-content"
				class:listing-header-content--aside={aside !== undefined}
				data-slot="blueprint-listing-content"
			>
				<div class="listing-header-text">
					<h1 class="listing-mobile-heading">
						{heading}<span class="listing-heading-dot" aria-hidden="true">.</span>
					</h1>
					<p class="listing-header-subtitle">{subtitle}</p>
					{#if description}
						<p class="listing-header-description">{description}</p>
					{/if}
				</div>

				{@render aside?.()}
			</div>
		</header>

		<Separator variant="hazard" data-testid="listing-page-separator" />

		<div class="listing-grid">
			<aside class="listing-filter-column" data-slot="listing-filter-column">
				<div class="listing-filter-sticky" use:scrollChain>
					{#if search}
						<div class="listing-filter-search" data-slot="listing-filter-search">
							{@render search()}
						</div>
					{/if}

					<button
						type="button"
						class="mobile-filter-toggle tap-press"
						data-slot="listing-filter-toggle"
						aria-expanded={filterOpen}
						aria-controls={panelId}
						data-persisted-key={filterPersistKey}
						onclick={toggleFilters}
					>
						<span>{filterLabel}</span>
						<ChevronToggle
							open={filterOpen}
							size="sm"
							direction="right"
							data-persisted-key={filterPersistKey}
						/>
					</button>

					<div
						id={panelId}
						class="listing-filter-panel"
						data-slot="listing-filter-panel"
						data-state={filterOpen ? 'open' : 'closed'}
						data-persisted-key={filterPersistKey}
					>
						<div class="listing-filter-overflow">
							<div class="listing-filter-shell">{@render filters()}</div>
						</div>
					</div>
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

	/* Header */
	.listing-blueprint-header {
		position: relative;
		display: grid;
		align-items: end;
		min-height: calc(100px + var(--chrome-offset, 0px));
		overflow: hidden;
		margin-top: calc(-1 * var(--chrome-offset, 0px));
		padding-top: var(--chrome-offset, 0px);
	}

	/* Every drawing in the header takes this ink, over the opacity BlueprintShell or inline styles give it. */
	.listing-blueprint-art {
		--blueprint-ink: 0.32;
		position: absolute;
		inset: 0;
	}

	:global([data-theme='light']) .listing-blueprint-art,
	:global(.theme-light) .listing-blueprint-art {
		--blueprint-ink: 0.5;
	}

	/* The tokens' light palette also applies with no stored theme when the system is light. */
	@media (prefers-color-scheme: light) {
		:global(:root:not([data-theme='dark'])) .listing-blueprint-art {
			--blueprint-ink: 0.5;
		}
	}

	.listing-blueprint-art :global(.blueprint-bg .hero-svg),
	.listing-blueprint-art :global(.blueprint-bg .edge-details .edge-detail) {
		opacity: var(--blueprint-ink) !important;
	}

	/* Solid page colour under each glyph, then a soft halo where strokes cross the copy. */
	.listing-header-content {
		position: relative;
		z-index: calc(var(--z-content) + 10);
		display: grid;
		gap: 0.875rem;
		min-width: 0;
		padding: 1rem var(--space-page-x);
		text-shadow:
			0 0 0 var(--background),
			0 0 0.2em var(--background),
			0 0 0.5em var(--background);
	}

	.listing-header-text {
		min-width: 0;
	}

	.listing-mobile-heading {
		margin: 0;
		font-family: var(--font-heading);
		font-size: clamp(2rem, 5vw, 2.5rem);
		font-weight: 900;
		color: var(--foreground);
		letter-spacing: 0;
		line-height: 1;
	}

	.listing-heading-dot,
	.edge-dot {
		color: var(--primary);
	}

	.listing-header-subtitle {
		margin: 0.35rem 0 0;
		font-family: var(--font-mono);
		font-size: 1rem;
		color: var(--accent-text);
		letter-spacing: 0;
		text-transform: uppercase;
	}

	.listing-header-description {
		margin: 0.375rem 0 0;
		font-size: var(--text-small);
		color: color-mix(in srgb, var(--muted-foreground) 50%, var(--foreground));
		line-height: 1.4;
	}

	/* Filter column and results */
	.listing-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		width: 100%;
	}

	.listing-filter-column {
		min-width: 0;
	}

	.listing-filter-sticky {
		padding: 1.5rem 1rem 1rem;
	}

	.listing-filter-search {
		margin-bottom: 1rem;
	}

	.listing-content {
		padding: 0 1rem 5.5rem;
	}

	.mobile-filter-toggle {
		display: flex;
		width: 100%;
		min-height: 44px;
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
		letter-spacing: 0;
		text-transform: uppercase;
		color: var(--foreground);
		cursor: pointer;
		white-space: nowrap;
		transition:
			border-color var(--duration-normal) var(--ease-default),
			color var(--duration-normal) var(--ease-default);
	}

	.mobile-filter-toggle:hover,
	.mobile-filter-toggle:focus-visible {
		border-color: var(--primary);
		color: var(--primary);
		outline: none;
	}

	/* Hidden only once the close animation ends, so the content doesn't vanish mid-collapse. */
	.listing-filter-panel {
		display: grid;
		grid-template-rows: 0fr;
		visibility: hidden;
		transition:
			grid-template-rows var(--duration-normal) var(--ease-default),
			visibility 0s linear var(--duration-normal);
	}

	.listing-filter-panel[data-state='open'] {
		grid-template-rows: 1fr;
		visibility: visible;
		transition:
			grid-template-rows var(--duration-normal) var(--ease-default),
			visibility 0s;
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

	@media (min-width: 768px) and (max-width: 1023.98px) {
		.listing-mobile-heading {
			font-size: clamp(2.5rem, 4vw, 3rem);
		}

		.listing-filter-sticky {
			padding: 2rem 1.5rem 1rem;
		}

		.listing-content {
			padding: 0 1.5rem 6rem;
		}
	}

	@media (min-width: 1024px) {
		.listing-layout {
			display: grid;
			grid-template-columns: auto 2px minmax(0, 1fr);
			margin-top: calc(-1 * var(--chrome-offset, 0px));
		}

		.listing-main {
			padding-top: var(--chrome-offset, 0px);
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
			font-size: clamp(3rem, 4vw, 3.5rem);
			font-weight: 900;
			color: var(--foreground);
			max-height: calc(100dvh - 16rem);
			overflow-wrap: anywhere;
			line-height: 1;
			letter-spacing: -0.04em;
		}

		.accent-rail {
			display: block;
			background: color-mix(in srgb, var(--primary) 35%, transparent);
		}

		.listing-blueprint-header {
			min-height: calc(160px + var(--chrome-offset, 0px));
		}

		.listing-header-content--aside {
			grid-template-columns: minmax(0, 1fr) minmax(18rem, 22rem);
			align-items: end;
			gap: clamp(2rem, 5vw, 5rem);
		}

		.listing-mobile-heading {
			position: absolute;
			width: 1px;
			height: 1px;
			padding: 0;
			margin: -1px;
			overflow: hidden;
			clip: rect(0, 0, 0, 0);
			white-space: nowrap;
			border: 0;
		}

		.listing-header-subtitle {
			font-size: 1.1rem;
		}

		.listing-grid {
			grid-template-columns: clamp(220px, 22vw, 320px) minmax(0, 1fr);
		}

		.listing-filter-sticky {
			position: sticky;
			top: var(--chrome-offset, 0px);
			max-height: calc(100dvh - var(--chrome-offset, 0px));
			overflow-y: auto;
			padding: 1rem;
		}

		.listing-filter-search {
			margin-bottom: 1.5rem;
			padding: 0.75rem 0 1.25rem;
			border-top: 2px dashed var(--border-rule);
		}

		.mobile-filter-toggle {
			display: none;
		}

		/* Always shown on desktop, whatever the stored mobile state. Block layout lets the first
		   section's top margin collapse into the search's, as in a plain sidebar. */
		.listing-filter-panel,
		.listing-filter-panel[data-state='open'] {
			display: block;
			visibility: visible;
			transition: none;
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
			padding: 2rem 1.5rem 6rem;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.mobile-filter-toggle,
		.listing-filter-panel,
		.listing-filter-panel[data-state='open'] {
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
