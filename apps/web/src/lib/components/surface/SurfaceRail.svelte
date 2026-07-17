<!--
  SurfaceRail — the shared article/control rail for granular-filter + section-ToC surfaces.

  ONE component, ONE live rail body, two presentations:
    • DESKTOP (≥1024): a bare sticky rail, matching the yesid article/listing grammar,
      pinned under the chrome (`top: var(--chrome-offset)`) and holding the surface's grain /
      filter controls + the section ToC. Sits as the LEFT column of the surface's grid.
    • MOBILE (<1024): ONE floating pill → ONE sheet that stacks the SAME content (grain /
      filters AND the ToC together — one easy menu), replacing the old pair of separate
      filter-pill + toc-pill.

  The caller passes ONE `rail` snippet (its grain controls + filters + ToC list). SurfaceRail
  mounts it once in the desktop grid and moves that same DOM subtree into the mobile sheet.
  Controls therefore keep one identity, one focus tree, and one set of element ids.

  a11y: the mobile pill is a labelled disclosure (`aria-expanded`), Escape closes + restores
  focus, a backdrop dismisses, the sheet is a `role="dialog"` that grabs first-focusable on
  open. Brand chrome only (glass-chrome + ChevronToggle); tokens, no hex.
-->
<script lang="ts">
	import { onMount, tick, type Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import { ChevronToggle } from '@yesid/ui/brand';
	import { layout } from '$lib/nav/layout.svelte';
	import { modalSheet } from '$lib/components/shared/modalSheet';

	export type SurfaceRailPresentation = 'desktop' | 'mobile';
	export interface SurfaceRailContext {
		closeSheet: () => void;
		presentation: SurfaceRailPresentation;
	}

	interface Props {
		/**
		 * The rail content — grain / filter controls + the section ToC. Mounted once and
		 * moved between the bare desktop rail and the mobile sheet.
		 * The snippet receives `{ closeSheet, presentation }`: `closeSheet` is the
		 * EXPLICIT dismissal seam to wire into TocNav's `onNavigate` (or any jump
		 * control), while `presentation` follows the shared 1024px viewport state. On
		 * desktop, `closeSheet` is a harmless no-op. This replaces the old
		 * `.toc-item` class sniffing, which silently coupled SurfaceRail to TocNav's
		 * private markup (a rename there would have killed sheet dismissal).
		 */
		rail: Snippet<[SurfaceRailContext]>;
		/** Rail aria-label + the mobile pill/sheet heading (e.g. "View" / "Vue"). */
		label: string;
		/** Optional collapsed-pill summary (e.g. the active grain · section). */
		summary?: string;
		/** aria-label for the mobile pill's open control. */
		openAria: string;
		/** aria-label for the mobile sheet's dismiss control. */
		closeAria: string;
		/** Extra classes on the desktop rail panel. */
		class?: string;
		/** Whether the mobile pill/sheet is relevant in the current page region. */
		mobileVisible?: boolean;
	}
	let {
		rail,
		label,
		summary,
		openAria,
		closeAria,
		class: className,
		mobileVisible = true,
	}: Props = $props();

	let sheetOpen = $state(false);
	let pillBtn = $state<HTMLButtonElement>();
	let sheetEl = $state<HTMLElement>();
	let desktopRailEl = $state<HTMLElement>();
	let railHomeParent: Node | undefined;
	let railHomeNextSibling: Node | null = null;
	let wasDesktop = layout.isDesktop;
	const presentation = $derived<SurfaceRailPresentation>(layout.isDesktop ? 'desktop' : 'mobile');

	onMount(() => {
		railHomeParent = desktopRailEl?.parentNode ?? undefined;
		railHomeNextSibling = desktopRailEl?.nextSibling ?? null;
	});

	function restoreRailHome(): void {
		if (!desktopRailEl || !railHomeParent || desktopRailEl.parentNode === railHomeParent) return;
		railHomeParent.insertBefore(desktopRailEl, railHomeNextSibling);
	}

	function closeSheet(restoreFocus = false): void {
		sheetOpen = false;
		if (restoreFocus) void tick().then(() => pillBtn?.focus());
	}
	// Move the one live rail body into the sheet and focus its first control. Focus returns
	// to the pill button on close (closeSheet). ALSO: a tap on a
	// native ToC jump link (an in-page `#anchor`) closes the sheet so the reader lands on
	// the section — a filter/grain pick (a button) does NOT close, so filters can be
	// changed freely. Component ToCs (TocNav) dismiss through the EXPLICIT seam instead:
	// the rail snippet's `closeSheet` param wired into `onNavigate`. Delegated via
	// addEventListener (not an inline onclick) so the sheet stays a plain container with
	// no static-element-interaction a11y violation.
	$effect(() => {
		if (!sheetOpen || !sheetEl || !desktopRailEl) return;

		const activeSheet = sheetEl;
		activeSheet.append(desktopRailEl);
		const onClick = (e: MouseEvent) => {
			if ((e.target as HTMLElement | null)?.closest('a[href^="#"]')) closeSheet(true);
		};
		activeSheet.addEventListener('click', onClick);
		return () => {
			activeSheet.removeEventListener('click', onClick);
			restoreRailHome();
		};
	});

	// A mobile sheet can own focus when the viewport crosses the shared 1024px
	// breakpoint. Close the hidden presentation and hand focus to the same controls
	// in the desktop rail.
	$effect(() => {
		const desktop = layout.isDesktop;
		const crossedToDesktop = desktop && !wasDesktop;
		wasDesktop = desktop;
		if (!crossedToDesktop || !sheetOpen) return;

		const focusWasInSheet = sheetEl?.contains(document.activeElement) ?? false;
		sheetOpen = false;
		if (!focusWasInSheet) return;

		void tick().then(() => {
			const next = desktopRailEl?.querySelector<HTMLElement>(
				'button, a, select, input, [tabindex]:not([tabindex="-1"])',
			);
			(next ?? desktopRailEl)?.focus();
		});
	});

	$effect(() => {
		if (mobileVisible || !sheetOpen) return;
		closeSheet();
	});
</script>

<!-- DESKTOP: the bare sticky rail (≥1024; hidden below, where the pill takes over). -->
<aside
	bind:this={desktopRailEl}
	class={cn('surface-rail', className)}
	class:surface-rail--mobile={presentation === 'mobile' && sheetOpen}
	data-slot="surface-rail"
	aria-label={label}
	tabindex="-1"
>
	{@render rail({ closeSheet: () => closeSheet(presentation === 'mobile'), presentation })}
</aside>

<!-- MOBILE: ONE pill → ONE sheet merging grain/filters + ToC (<1024; hidden ≥1024). -->
{#if mobileVisible}
	<div class="surface-rail-mobile lg:hidden" data-slot="surface-rail-mobile">
		<button
			bind:this={pillBtn}
			class="tap-press surface-rail-pill glass-chrome"
			onclick={() => (sheetOpen = !sheetOpen)}
			aria-expanded={sheetOpen}
			aria-label={`${label}${summary ? ` ${summary}` : ''} · ${sheetOpen ? closeAria : openAria}`}
		>
			<span class="surface-rail-pill-label">{label}</span>
			{#if summary}<span class="surface-rail-pill-summary">{summary}</span>{/if}
			<ChevronToggle open={sheetOpen} size="sm" direction="down" />
		</button>

		{#if sheetOpen}
			<button
				class="surface-rail-backdrop"
				data-modal-sheet-exempt
				tabindex="-1"
				onclick={() => closeSheet(true)}
				aria-label={closeAria}
			></button>
			<div
				class="surface-rail-sheet glass-chrome"
				bind:this={sheetEl}
				role="dialog"
				aria-modal="true"
				aria-label={label}
				tabindex="-1"
				use:modalSheet={{
					active: presentation === 'mobile' && sheetOpen,
					trigger: pillBtn,
					exempt: desktopRailEl ? [desktopRailEl] : [],
					onDismiss: () => closeSheet(),
				}}
			></div>
		{/if}
	</div>
{/if}

<style>
	/* ── Desktop article rail (≥1024) ───────────────────────────────────────────── */
	.surface-rail {
		display: none;
	}
	.surface-rail.surface-rail--mobile {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: 100%;
	}
	.surface-rail--mobile > :global(*) {
		flex: none;
	}
	@media (min-width: 1024px) {
		.surface-rail {
			display: flex;
			flex-direction: column;
			gap: 1rem;
			position: sticky;
			top: var(--chrome-offset);
			align-self: start;
			max-height: calc(100dvh - var(--chrome-offset) - 1rem);
			overflow-y: auto;
			overscroll-behavior: contain;
			z-index: var(--z-rail);
		}
		.surface-rail > :global(*) {
			flex: none;
		}
	}

	/* ── Mobile pill + sheet (<1024) ────────────────────────────────────────────── */
	.surface-rail-mobile {
		position: fixed;
		bottom: calc(20px + env(safe-area-inset-bottom, 0px));
		left: 50%;
		transform: translateX(-50%);
		z-index: var(--z-sheet);
	}
	.surface-rail-pill {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1.125rem;
		min-height: 44px;
		max-width: calc(100vw - 2rem);
		border-radius: var(--radius-pill);
		cursor: pointer;
		white-space: nowrap;
		font-family: var(--font-mono);
	}
	.surface-rail-pill-label {
		font-size: var(--text-caption);
		color: var(--foreground);
	}
	.surface-rail-pill-summary {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: var(--text-micro);
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--accent-text);
	}
	.surface-rail-backdrop {
		position: fixed;
		inset: 0;
		background: transparent;
		z-index: -1;
		border: none;
	}
	.surface-rail-sheet {
		position: fixed;
		left: 50%;
		transform: translateX(-50%);
		bottom: calc(72px + env(safe-area-inset-bottom, 0px));
		width: min(28rem, calc(100vw - 1.5rem));
		max-height: min(70dvh, 32rem);
		overflow-y: auto;
		overscroll-behavior: contain;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem;
		border-radius: var(--radius-xl);
	}
	.surface-rail-sheet > :global(*) {
		flex: none;
	}
</style>
