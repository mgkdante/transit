<!--
  Mobile table of contents: a floating pill with the active heading and counter that opens a
  drawer of entries. The page owns the active id.
-->
<script lang="ts" module>
	import type { TocEntry } from './toc.js';

	export interface TocPillProps {
		entries: TocEntry[];
		activeId: string;
		/** Appended to the visible text to form the pill's accessible name. */
		openAria: string;
		closeAria: string;
		/** Defaults to `navigateToc`, which jumps instead of gliding under reduced motion. */
		onNavigate?: (id: string) => void;
	}
</script>

<script lang="ts">
	import { scrollChain } from '@yesid/motion/actions';
	import ChevronToggle from './ChevronToggle.svelte';
	import TocBadge from './TocBadge.svelte';
	import { flattenToc, navigateToc, resolveTocCounter } from './toc.js';

	let { entries, activeId, openAria, closeAria, onNavigate = navigateToc }: TocPillProps = $props();

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
		if (restoreFocus) pillBtn?.focus({ preventScroll: true });
	}

	function onKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape' && drawerOpen) {
			e.stopPropagation();
			closeDrawer(true);
		}
	}

	$effect(() => {
		if (drawerOpen && drawerEl) {
			drawerEl.querySelector<HTMLElement>('.toc-drawer-item')?.focus();
		}
	});

	function scrollTo(id: string): void {
		closeDrawer(true);
		onNavigate(id);
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="toc-pill-container lg:hidden" data-testid="toc-pill">
	<button
		bind:this={pillBtn}
		class="tap-press toc-pill"
		onclick={() => (drawerOpen = !drawerOpen)}
		aria-expanded={drawerOpen}
		aria-label={`${activeName} ${counter.current}/${counter.total} · ${openAria}`}
	>
		<!-- The accessible name starts with the visible text (WCAG 2.5.3, label in name). -->
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

		<div class="toc-drawer" bind:this={drawerEl} use:scrollChain>
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
	/* Keeps headings landed by navigation clear of the pill. 1023.98px is below the desktop token. */
	@media (max-width: 1023.98px) {
		:global(html:has(.toc-pill-container) .section-header) {
			scroll-margin-bottom: calc(5rem + env(safe-area-inset-bottom, 0px));
		}
	}

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
		max-width: calc(100vw - 2rem);
		background: color-mix(in srgb, var(--background) 95%, transparent);
		border: 1px solid color-mix(in srgb, var(--primary) 20%, transparent);
		border-radius: var(--radius-pill);
		backdrop-filter: blur(8px);
		cursor: pointer;
		white-space: nowrap;
	}

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
		font-size: var(--text-mono);
		color: color-mix(in srgb, var(--foreground) 65%, transparent);
		transition:
			background var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default);
		text-align: left;
		width: 100%;
	}

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

	.toc-drawer-sub {
		padding-left: 40px;
		font-size: var(--text-caption);
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
