<!--
  SurfaceRail — the map-style GLASS left rail for granular-filter + section-ToC surfaces.

  ONE component, ONE source of rail content, two presentations:
    • DESKTOP (≥1024): a sticky floating glass panel (the `.glass-chrome` map-overlay look)
      pinned under the chrome (`top: var(--chrome-offset)`), holding the surface's grain /
      filter controls + the section ToC. Sits as the LEFT column of the surface's 2-col grid.
    • MOBILE (<1024): ONE floating pill → ONE sheet that stacks the SAME content (grain /
      filters AND the ToC together — one easy menu), replacing the old pair of separate
      filter-pill + toc-pill.

  The caller passes ONE `rail` snippet (its grain controls + filters + ToC list). It is
  rendered in BOTH the desktop panel and the mobile sheet, so there is a single source of
  truth for the control content — the grain radiogroup + ToC bind the same state in both.

  a11y: the mobile pill is a labelled disclosure (`aria-expanded`), Escape closes + restores
  focus, a backdrop dismisses, the sheet is a `role="dialog"` that grabs first-focusable on
  open. Brand chrome only (glass-chrome + ChevronToggle); tokens, no hex.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import { ChevronToggle } from '$lib/components/brand';

	interface Props {
		/**
		 * The rail content — grain / filter controls + the section ToC. Rendered in BOTH
		 * the desktop glass panel AND the mobile sheet (single source of truth).
		 * The snippet receives `{ closeSheet }` — the EXPLICIT dismissal seam: wire it
		 * into TocNav's `onNavigate` (or any jump control) so picking a section closes
		 * the mobile sheet. On desktop it is a harmless no-op. This replaces the old
		 * `.toc-item` class sniffing, which silently coupled SurfaceRail to TocNav's
		 * private markup (a rename there would have killed sheet dismissal).
		 */
		rail: Snippet<[{ closeSheet: () => void }]>;
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
	}
	let { rail, label, summary, openAria, closeAria, class: className }: Props = $props();

	let sheetOpen = $state(false);
	let pillBtn = $state<HTMLButtonElement>();
	let sheetEl = $state<HTMLElement>();

	function closeSheet(restoreFocus = false): void {
		sheetOpen = false;
		if (restoreFocus) pillBtn?.focus();
	}
	function onKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape' && sheetOpen) {
			e.stopPropagation();
			closeSheet(true);
		}
	}
	// Move focus into the sheet when it opens (first focusable) so keyboard users land
	// inside it; focus returns to the pill button on close (closeSheet). ALSO: a tap on a
	// native ToC jump link (an in-page `#anchor`) closes the sheet so the reader lands on
	// the section — a filter/grain pick (a button) does NOT close, so filters can be
	// changed freely. Component ToCs (TocNav) dismiss through the EXPLICIT seam instead:
	// the rail snippet's `closeSheet` param wired into `onNavigate`. Delegated via
	// addEventListener (not an inline onclick) so the sheet stays a plain container with
	// no static-element-interaction a11y violation.
	$effect(() => {
		if (!sheetOpen || !sheetEl) return;
		sheetEl.querySelector<HTMLElement>('button, a, select, input, [tabindex]')?.focus();
		const onClick = (e: MouseEvent) => {
			if ((e.target as HTMLElement | null)?.closest('a[href^="#"]')) closeSheet(false);
		};
		sheetEl.addEventListener('click', onClick);
		return () => sheetEl?.removeEventListener('click', onClick);
	});
</script>

<svelte:window onkeydown={onKeydown} />

<!-- DESKTOP: the sticky glass rail (≥1024; hidden below, where the pill takes over). -->
<aside
	class={cn('surface-rail glass-chrome', className)}
	data-slot="surface-rail"
	aria-label={label}
>
	{@render rail({ closeSheet: () => closeSheet(false) })}
</aside>

<!-- MOBILE: ONE pill → ONE sheet merging grain/filters + ToC (<1024; hidden ≥1024). -->
<div class="surface-rail-mobile lg:hidden" data-slot="surface-rail-mobile">
	<button
		bind:this={pillBtn}
		class="tap-press surface-rail-pill glass-chrome"
		onclick={() => (sheetOpen = !sheetOpen)}
		aria-expanded={sheetOpen}
		aria-label={`${label}${summary ? ` · ${summary}` : ''} · ${openAria}`}
	>
		<span class="surface-rail-pill-label">{label}</span>
		{#if summary}<span class="surface-rail-pill-summary">{summary}</span>{/if}
		<ChevronToggle open={sheetOpen} size="sm" direction="down" />
	</button>

	{#if sheetOpen}
		<button
			class="surface-rail-backdrop"
			tabindex="-1"
			onclick={() => closeSheet(true)}
			aria-label={closeAria}
		></button>
		<div
			class="surface-rail-sheet glass-chrome"
			bind:this={sheetEl}
			role="dialog"
			aria-label={label}
		>
			{@render rail({ closeSheet: () => closeSheet(false) })}
		</div>
	{/if}
</div>

<style>
	/* ── Desktop glass rail (≥1024) ─────────────────────────────────────────────── */
	.surface-rail {
		display: none;
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
			padding: 1rem;
			border-radius: var(--radius-xl);
			z-index: var(--z-rail);
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
</style>
