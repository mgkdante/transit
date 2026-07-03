<!--
  ReliabilityFilterPill — the mobile (<lg) floating GRAIN pill for the reliability surface,
  patterned after the map's MapFilterPill (itself ported from yesid.dev's TocPill). On a phone
  the sticky ControlsRail is the wrong shape (it eats the top and still wraps), so the grain
  controls move into a thumb-reachable floating pill that opens a drawer holding the SAME controls
  the desktop rail renders (one source of truth — the `controls` snippet).

  Positioned TOP-CENTRE (operator), just below the app nav; the shared TocPill keeps the bottom
  for jump-to, so the two never collide (filter at the top, jump-to at the bottom). Hidden at the
  desktop layout (>=1024px) where the full rail returns.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	// F (motion wiring): touch tactility on the mobile grain pill — pressBounce
	// alongside the existing .tap-press CSS baseline (both self-gate). Vendored.
	import { pressBounce } from '@yesid/motion';
	import { ChevronToggle } from '$lib/components/brand';

	interface Props {
		/** The eyebrow/title (e.g. "View" / "Vue"). */
		title: string;
		/** The active-window summary shown on the pill (e.g. "Today"). */
		label: string;
		/** The grain controls snippet (GrainPicker + range + active-window caption) — shared with the desktop rail. */
		controls: Snippet;
		/** a11y: opens the drawer. */
		openAria: string;
		/** a11y: closes the drawer. */
		closeAria: string;
	}

	let { title, label, controls, openAria, closeAria }: Props = $props();

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

	// Move focus into the drawer's first control when it opens (keyboard users land inside).
	$effect(() => {
		if (drawerOpen && drawerEl) {
			drawerEl.querySelector<HTMLElement>('button, [role="radio"], select, a, input')?.focus();
		}
	});
</script>

<svelte:window onkeydown={onKeydown} />

<div class="rel-filter-pill-container lg:hidden" data-testid="reliability-filter-pill">
	<!--
		A11y: the visible text ("{title} · {label}") prefixes the accessible name (Lighthouse
		2.5.3), then appends the purpose so it never reads as a bare label mismatch.
	-->
	<button
		bind:this={pillBtn}
		type="button"
		class="tap-press rel-filter-pill"
		use:pressBounce
		onclick={() => (drawerOpen = !drawerOpen)}
		aria-expanded={drawerOpen}
		aria-label={`${title} · ${label} · ${openAria}`}
	>
		<span class="rel-filter-pill-dot" aria-hidden="true"></span>
		<span class="rel-filter-pill-eyebrow">{title}</span>
		<span class="rel-filter-pill-value">{label}</span>
		<ChevronToggle open={drawerOpen} size="sm" direction="down" />
	</button>

	{#if drawerOpen}
		<button
			type="button"
			class="rel-filter-drawer-backdrop"
			tabindex="-1"
			onclick={() => closeDrawer(true)}
			aria-label={closeAria}
		></button>

		<div class="rel-filter-drawer" data-testid="reliability-filter-drawer" bind:this={drawerEl}>
			{@render controls()}
		</div>
	{/if}
</div>

<style>
	/* TOP-CENTRE (operator): the grain filter pill floats just below the floating
	   chrome via the single --chrome-offset knob (which already folds in the notch
	   safe-area); the shared TocPill keeps the bottom for jump-to, so the two never
	   collide (filter top, nav bottom). */
	.rel-filter-pill-container {
		position: fixed;
		top: var(--chrome-offset);
		left: 50%;
		transform: translateX(-50%);
		z-index: var(--z-sheet);
	}

	.rel-filter-pill {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 44px;
		max-width: calc(100vw - 2rem);
		padding: 0.625rem 1rem 0.625rem 0.875rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--foreground);
		white-space: nowrap;
		background: color-mix(in srgb, var(--card) 92%, transparent);
		border: 1px solid color-mix(in srgb, var(--border) 78%, var(--primary) 22%);
		border-radius: var(--radius-pill);
		box-shadow: var(--shadow-card);
		backdrop-filter: blur(16px) saturate(1.1);
		-webkit-backdrop-filter: blur(16px) saturate(1.1);
		cursor: pointer;
		transition:
			border-color var(--duration-fast) var(--ease-default),
			background-color var(--duration-fast) var(--ease-default);
	}
	.rel-filter-pill:hover {
		border-color: color-mix(in srgb, var(--primary) 45%, var(--border) 55%);
	}
	.rel-filter-pill[aria-expanded='true'] {
		border-color: color-mix(in srgb, var(--primary) 55%, transparent);
	}
	.rel-filter-pill-dot {
		width: 0.5rem;
		height: 0.5rem;
		flex: none;
		border-radius: var(--radius-pill);
		background: var(--primary);
	}
	/* The "View" eyebrow stays quiet; the active window is the value voice. */
	.rel-filter-pill-eyebrow {
		flex: none;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--tracking-eyebrow);
		color: var(--muted-foreground);
	}
	.rel-filter-pill-value {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
		color: var(--accent-text);
	}

	.rel-filter-drawer-backdrop {
		position: fixed;
		inset: 0;
		z-index: -1;
		background: transparent;
		border: none;
		cursor: default;
	}

	/* The drawer carries the card chrome; it opens DOWNWARD (the pill sits at the top). */
	.rel-filter-drawer {
		position: absolute;
		top: calc(100% + 10px);
		left: 50%;
		transform: translateX(-50%);
		width: min(22rem, calc(100vw - 1.5rem));
		max-height: min(68dvh, calc(100dvh - 9rem));
		overflow-y: auto;
		overscroll-behavior: contain;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 1rem;
		padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
		background: color-mix(in srgb, var(--card) 95%, transparent);
		border: 1px solid color-mix(in srgb, var(--border) 78%, var(--primary) 22%);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-sheet);
		backdrop-filter: blur(16px) saturate(1.1);
		-webkit-backdrop-filter: blur(16px) saturate(1.1);
	}

	@media (prefers-reduced-motion: reduce) {
		.rel-filter-pill {
			transition: none;
		}
	}
</style>
