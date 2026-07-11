<!--
  TocPill - floating pill at the bottom-center of the viewport on mobile (<lg).
  Shared across detail pages. Shows the active heading + counter; tapping opens a
  drawer with the full TOC (same badge marks as the section cards, via TocBadge).

  The PAGE owns the active id (one IntersectionObserver via observeActiveToc) and
  passes it in. The pill renders, it doesn't track. a11y labels come in as props
  so each page sources its own localized chrome.

  Ported from yesid.dev shared/TocPill. Deviation: yesid wraps the drawer in
  `use:scrollChain` (a scroll-containment action transit lacks). Dropped in
  favour of `overscroll-behavior: contain` on the scroll container, which gives
  the same "don't scroll the page behind me" behaviour without the action.
-->
<script lang="ts">
	import { ChevronToggle } from '$lib/components/brand';
	import TocBadge from './TocBadge.svelte';
	import { flattenToc, resolveTocCounter, tocElement, type TocEntry } from './toc';

	let {
		entries,
		activeId,
		openAria,
		closeAria,
		onNavigate,
	}: {
		entries: TocEntry[];
		activeId: string;
		openAria: string;
		closeAria: string;
		/**
		 * Page-owned navigation override (S10): on a default-closed page a jump must
		 * REVEAL its target, not land on a shut card — the page passes its open+scroll
		 * path here (same contract as TocNav's onNavigate). Absent → internal scroll.
		 */
		onNavigate?: (id: string) => void;
	} = $props();

	const flat = $derived(flattenToc(entries));
	const activeIndex = $derived(
		Math.max(
			0,
			flat.findIndex((e) => e.id === activeId),
		),
	);
	const activeName = $derived(flat[activeIndex]?.title ?? '');
	const counter = $derived(resolveTocCounter(entries, activeId));

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

	// Move focus into the drawer when it opens (first item) so keyboard users land
	// inside it; focus returns to the pill button when it closes (closeDrawer).
	$effect(() => {
		if (drawerOpen && drawerEl) {
			drawerEl.querySelector<HTMLElement>('.toc-drawer-item')?.focus();
		}
	});

	function scrollTo(id: string): void {
		// A page-owned navigate path (open-then-scroll on default-closed pages) takes
		// precedence over the internal scroll — S10 review F1: the mobile drawer must
		// never land a reader on a shut card.
		if (onNavigate) {
			onNavigate(id);
			closeDrawer(true);
			return;
		}
		const el = tocElement(id);
		if (el) {
			// Honour prefers-reduced-motion: a reader who opts out of motion gets an instant jump,
			// not a smooth scroll (WCAG 2.3.3 animation-from-interactions).
			const reduce =
				typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
			el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
			closeDrawer(true);
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="toc-pill-container lg:hidden" data-testid="toc-pill">
	<!--
		A11y: the button shows visible text ("{activeName} {n}/{total}") while
		openAria carries the purpose ("Table of contents"). Lighthouse 2.5.3
		(label-content-name-mismatch) requires the visible text to appear as a
		prefix of the accessible name. Compose aria-label so it starts with the
		same visible string, then appends the purpose.
	-->
	<button
		bind:this={pillBtn}
		class="tap-press toc-pill"
		onclick={() => (drawerOpen = !drawerOpen)}
		aria-expanded={drawerOpen}
		aria-label={`${activeName} ${counter.current}/${counter.total} · ${openAria}`}
	>
		<div class="h-1.5 w-1.5 rounded-full bg-primary"></div>
		<span class="toc-pill-name font-mono text-caption">
			{activeName}
		</span>
		<span class="toc-pill-counter font-mono text-micro">
			{counter.current}/{counter.total}
		</span>
		<ChevronToggle open={drawerOpen} size="sm" direction="down" />
	</button>

	{#if drawerOpen}
		<button
			class="toc-drawer-backdrop"
			tabindex="-1"
			onclick={() => closeDrawer(true)}
			aria-label={closeAria}
		></button>

		<div class="toc-drawer" bind:this={drawerEl}>
			<nav class="toc-drawer-nav flex flex-col gap-0.5 p-4">
				{#each entries as entry (entry.id)}
					<button
						class="tap-press toc-drawer-item"
						class:active={activeId === entry.id}
						aria-current={activeId === entry.id ? 'location' : undefined}
						onclick={() => scrollTo(entry.id)}
					>
						<span class="toc-drawer-badge"
							><TocBadge badge={entry.badge} iconClass="h-4 w-4 shrink-0 text-primary" /></span
						>
						<span class="toc-drawer-label">{entry.title}</span>
					</button>
					<!-- Nested sub-headings -->
					{#each entry.children as child (child.id)}
						<button
							class="tap-press toc-drawer-item toc-drawer-sub"
							class:active={activeId === child.id}
							aria-current={activeId === child.id ? 'location' : undefined}
							onclick={() => scrollTo(child.id)}
						>
							<span class="toc-drawer-label">{child.title}</span>
						</button>
					{/each}
				{/each}
			</nav>
		</div>
	{/if}
</div>

<style>
	.toc-pill-container {
		position: fixed;
		bottom: calc(20px + env(safe-area-inset-bottom, 0px));
		left: 50%;
		transform: translateX(-50%);
		z-index: var(--z-sheet);
	}

	.toc-pill {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 20px;
		min-height: 44px;
		/* Never wider than the viewport (with a little breathing room). */
		max-width: calc(100vw - 2rem);
		background: color-mix(in srgb, var(--background) 95%, transparent);
		border: 1px solid color-mix(in srgb, var(--primary) 20%, transparent);
		border-radius: var(--radius-pill);
		backdrop-filter: blur(8px);
		cursor: pointer;
		white-space: nowrap;
	}

	/* The active title shrinks + ellipsizes when the pill hits its max-width; the
	   dot, counter and chevron stay fixed. min-width:0 lets the flex item shrink. */
	.toc-pill-name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: color-mix(in srgb, var(--foreground) 65%, transparent);
	}

	.toc-pill-counter {
		color: color-mix(in srgb, var(--primary) 85%, transparent);
		flex-shrink: 0;
	}

	.toc-drawer-backdrop {
		position: fixed;
		inset: 0;
		background: transparent;
		z-index: -1;
		border: none;
		cursor: default;
	}

	.toc-drawer {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 50%;
		transform: translateX(-50%);
		min-width: 280px;
		max-width: 90vw;
		max-height: 60dvh;
		overflow-y: auto;
		/* Replaces yesid's use:scrollChain: keep wheel/touch scroll inside the
		   drawer instead of chaining to the page behind it. */
		overscroll-behavior: contain;
		background: color-mix(in srgb, var(--background) 97%, transparent);
		border: 1px solid color-mix(in srgb, var(--primary) 15%, transparent);
		border-radius: 12px;
		backdrop-filter: blur(12px);
		box-shadow: var(--shadow-sheet);
	}

	.toc-drawer-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 14px;
		min-height: 44px;
		border: none;
		background: none;
		border-radius: 8px;
		cursor: pointer;
		font-family: var(--font-heading);
		font-size: 14px;
		color: color-mix(in srgb, var(--foreground) 65%, transparent);
		transition:
			background var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default);
		text-align: left;
		width: 100%;
	}

	/* Fixed-width badge slot keeps labels aligned across number/icon/sub rows. */
	.toc-drawer-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.75rem;
		flex-shrink: 0;
	}

	.toc-drawer-label {
		min-width: 0;
	}

	.toc-drawer-item:hover {
		background: color-mix(in srgb, var(--primary) 5%, transparent);
		color: color-mix(in srgb, var(--foreground) 70%, transparent);
	}

	.toc-drawer-item.active {
		color: var(--primary);
		font-weight: 600;
	}

	.toc-drawer-item:focus-visible,
	.toc-pill:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}

	/* Sub-headings indented (no badge slot; align under the parent's label). */
	.toc-drawer-sub {
		padding-left: 40px;
		font-size: 13px;
		color: color-mix(in srgb, var(--foreground) 65%, transparent);
	}

	.toc-drawer-sub:hover {
		color: color-mix(in srgb, var(--foreground) 65%, transparent);
	}

	.toc-drawer-sub.active {
		color: var(--primary);
	}

	@media (prefers-reduced-motion: reduce) {
		.toc-drawer-item {
			transition: none;
		}
	}
</style>
