<!--
  MetricInfo — the reusable (i) affordance that sits next to a metric label on
  the reliability surface. On hover/focus/click it reveals a one-line plain
  explanation plus a keyboard-reachable link that deep-links into the in-app
  /metrics explainer at this metric's anchor (NOT Notion, NOT a new tab by
  default — first-party SPA content, back-button-friendly).

  Why hand-rolled (not the bits-ui Tooltip): a tooltip dismisses on blur, so it
  cannot host a focusable action link. This is a small click/focus POPOVER: the
  trigger toggles it; the popover contains the tip + the link; Escape closes and
  returns focus to the trigger; an outside click / focus-out dismisses it.

  DOCTRINE: --primary is fine here — it is an INTERACTIVE affordance (the trigger
  glyph + the link), never a data mark. (doctrine-allow: interactive)
  AA: glyph + link sit on --popover/--popover-foreground; focus ring mirrors the
  reliability segmented-control recipe (2px var(--ring), offset 2px).
  Reduced-motion: the fade/scale transition is dropped under prefers-reduced-motion.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { cn } from '$lib/utils';

	interface MetricInfoProps {
		/** Plain one-line explanation (already localized). */
		tip: string;
		/** Localized href to the explainer at this metric's anchor (e.g. "/fr/metrics#otp"). */
		href: string;
		/** Accessible name for the trigger (e.g. "About on-time %"), localized. */
		label: string;
		/** Link text shown inside the popover (e.g. "How this is measured"), localized. */
		linkLabel: string;
		/** Open the explainer in a new tab. Default false (in-app same-tab nav). */
		newTab?: boolean;
		/** Placement of the popover relative to the trigger. Default 'top'. */
		side?: 'top' | 'bottom';
		/** Extra classes on the inline wrapper. */
		class?: string;
	}

	let {
		tip,
		href,
		label,
		linkLabel,
		newTab = false,
		side = 'top',
		class: className,
	}: MetricInfoProps = $props();

	let open = $state(false);
	let root = $state<HTMLSpanElement | null>(null);
	let trigger = $state<HTMLButtonElement | null>(null);
	let pop = $state<HTMLSpanElement | null>(null);

	const tipId = $props.id();

	// ── Edge-aware placement ────────────────────────────────────────────────────
	// The popover is a position:FIXED layer anchored in VIEWPORT coordinates (so it
	// is immune to ancestor overflow/clip and to the inline wrapper's zero width).
	// On open it measures the trigger + its own box against the viewport, FLIPS
	// top<->bottom when the preferred side would clip, and SHIFTS the horizontal
	// inset so the natural-width box always stays on screen. It REPOSITIONS, never
	// shrinks. Ported from dataviz/ChartTooltip.svelte. (Kept inside `root` so the
	// hover-group / focus-out logic below still sees pointer + focus moves onto it.)
	const GAP = 8; // px between the box edge and the trigger
	const EDGE = 8; // px minimum margin kept from the viewport edge

	let resolvedSide = $state<'top' | 'bottom'>('top');
	let fixedLeft = $state(0);
	let fixedTop = $state(0);
	// Suppresses a one-frame flash at (0,0) before the first measurement lands.
	let placed = $state(false);

	// Per-side base transform: the box is laid out at (left,top) = the trigger's
	// horizontal centre and the chosen edge, then translated so it is centred
	// horizontally and meets the trigger with a GAP above (top) or below (bottom).
	const transform = $derived(
		resolvedSide === 'top'
			? `translate(-50%, calc(-100% - ${GAP}px))`
			: `translate(-50%, ${GAP}px)`,
	);

	// Measure against the VIEWPORT and place the box. Re-runs on open and whenever
	// the content (tip/link length) that drives the box size changes.
	$effect(() => {
		if (!open) {
			resolvedSide = side;
			placed = false;
			return;
		}
		// Read reactive deps so the effect re-runs when content/side changes.
		void tip;
		void linkLabel;
		void side;

		const trig = trigger;
		const box = pop;
		if (!trig || !box) {
			resolvedSide = side;
			return;
		}

		const tr = trig.getBoundingClientRect();
		const pb = box.getBoundingClientRect();
		const vw = typeof window !== 'undefined' ? window.innerWidth : tr.right;
		const vh = typeof window !== 'undefined' ? window.innerHeight : tr.bottom;

		// Anchor X = the trigger's horizontal centre; anchor Y = the relevant edge.
		const anchorX = tr.left + tr.width / 2;
		const topEdge = tr.top; // box sits above this when side === 'top'
		const bottomEdge = tr.bottom; // box sits below this when side === 'bottom'

		// Vertical flip: if the preferred side overflows that viewport edge but the
		// opposite side fits, flip. Otherwise keep the preferred side.
		let next = side;
		if (
			side === 'top' &&
			topEdge - pb.height - GAP < EDGE &&
			bottomEdge + pb.height + GAP <= vh - EDGE
		) {
			next = 'bottom';
		} else if (
			side === 'bottom' &&
			bottomEdge + pb.height + GAP > vh - EDGE &&
			topEdge - pb.height - GAP >= EDGE
		) {
			next = 'top';
		}
		resolvedSide = next;

		// Horizontal shift: the box is centred on `anchorX`; nudge it so both edges
		// sit within [EDGE, viewport - EDGE]. When the box is wider than the
		// viewport, centre it (min wins ≥ max). Width never changes.
		const half = pb.width / 2;
		const minLeft = EDGE + half;
		const maxLeft = vw - EDGE - half;
		fixedLeft = maxLeft >= minLeft ? Math.min(Math.max(anchorX, minLeft), maxLeft) : vw / 2;

		// Vertical anchor. `transform` then offsets the box up/down by GAP from this
		// edge, so the box's resolved top is anchor−height−GAP (top) or anchor+GAP
		// (bottom). When BOTH sides would clip (a tall box on a short viewport), neither
		// flip helps — clamp the resolved box-top into [EDGE, vh − height − EDGE] so the
		// box never runs off the top OR bottom edge, then back out the anchor the
		// transform expects. (min wins ≥ max when the box is taller than the viewport,
		// pinning it to the top edge.)
		const rawTop = next === 'top' ? topEdge - pb.height - GAP : bottomEdge + GAP;
		const minTop = EDGE;
		const maxTop = vh - pb.height - EDGE;
		const clampedBoxTop = maxTop >= minTop ? Math.min(Math.max(rawTop, minTop), maxTop) : minTop;
		// Re-express as the anchor `transform` translates from (it adds +GAP for bottom,
		// −height−GAP for top), so the box's final top equals clampedBoxTop.
		fixedTop = next === 'top' ? clampedBoxTop + pb.height + GAP : clampedBoxTop - GAP;
		placed = true;
	});

	// The (i) trigger + the popover are ONE hover group: hovering either keeps it
	// open; the popover only dismisses once the pointer has left BOTH for a short
	// grace window, so the in-popover link is reachable across the small gap
	// between trigger and tip. ~120ms is long enough to cross that gap, short
	// enough not to feel sticky.
	const GRACE_MS = 120;
	let graceTimer: ReturnType<typeof setTimeout> | null = null;

	// When we RETURN focus to the trigger as part of a dismiss (Escape, or a
	// toggle-close), the resulting `focusin` must NOT reopen the popover. This
	// flag suppresses exactly that one programmatic-focus open; a genuine
	// keyboard tab-in (no dismiss in flight) still opens normally.
	let suppressFocusOpen = false;

	function cancelGrace(): void {
		if (graceTimer !== null) {
			clearTimeout(graceTimer);
			graceTimer = null;
		}
	}

	function openNow(): void {
		cancelGrace();
		open = true;
	}

	// focusin opener: keeps the group open for keyboard users (so the link stays
	// tabbable), except when a dismiss just returned focus to the trigger.
	function onFocusIn(): void {
		if (suppressFocusOpen) {
			suppressFocusOpen = false;
			return;
		}
		openNow();
	}

	// Dismiss after the grace window unless the pointer re-enters the group first.
	function scheduleClose(): void {
		cancelGrace();
		graceTimer = setTimeout(() => {
			graceTimer = null;
			open = false;
		}, GRACE_MS);
	}

	// Return focus to the trigger, arming the focusin-suppression ONLY when the
	// focus actually has to move (otherwise no focusin fires and the flag would
	// linger and wrongly swallow the next genuine tab-in).
	function returnFocusToTrigger(): void {
		if (!trigger) return;
		if (document.activeElement !== trigger) suppressFocusOpen = true;
		trigger.focus();
	}

	function close(returnFocus = false): void {
		cancelGrace();
		open = false;
		if (returnFocus) returnFocusToTrigger();
	}

	async function toggle(): Promise<void> {
		cancelGrace();
		open = !open;
		// Keep focus management predictable when toggled by keyboard.
		if (!open) {
			await tick();
			returnFocusToTrigger();
		}
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && open) {
			event.stopPropagation();
			close(true);
		}
	}

	// Dismiss on focus leaving the whole affordance (trigger + popover), and on an
	// outside pointer click. Hover open/close lives on the wrapper handlers below;
	// focus/click keep it usable by keyboard and pointer alike. focus-within keeps
	// it open for keyboard users so the link stays tabbable.
	function onFocusOut(event: FocusEvent): void {
		const next = event.relatedTarget as Node | null;
		if (next && root?.contains(next)) return;
		close();
	}

	$effect(() => {
		if (!open) return;
		const onDocPointer = (e: PointerEvent) => {
			if (root && !root.contains(e.target as Node)) close();
		};
		// The popover is position:FIXED at viewport coords measured ONCE on open, so a
		// scroll or a resize/rotate moves the trigger while the box stays pinned — it
		// detaches. Dismissing on either is the clean, jank-free behaviour for a small
		// definition popover (and matches common tooltip UX). `capture: true` on scroll
		// catches scrolls in ANY ancestor (scroll does not bubble); all are passive
		// (read-only, never preventDefault). Torn down with the pointerdown/Escape owner
		// below when the popover closes.
		const onDismiss = () => close();
		document.addEventListener('pointerdown', onDocPointer, true);
		window.addEventListener('scroll', onDismiss, { capture: true, passive: true });
		window.addEventListener('resize', onDismiss, { passive: true });
		window.addEventListener('orientationchange', onDismiss, { passive: true });
		return () => {
			document.removeEventListener('pointerdown', onDocPointer, true);
			window.removeEventListener('scroll', onDismiss, true);
			window.removeEventListener('resize', onDismiss);
			window.removeEventListener('orientationchange', onDismiss);
		};
	});

	// Clear any pending grace timer if the component is torn down mid-hover.
	$effect(() => () => cancelGrace());
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
	bind:this={root}
	class={cn('metric-info', className)}
	onmouseenter={openNow}
	onmouseleave={scheduleClose}
	onfocusin={onFocusIn}
	onfocusout={onFocusOut}
	onkeydown={onKeydown}
>
	<button
		bind:this={trigger}
		type="button"
		class="metric-info__trigger"
		aria-label={label}
		aria-expanded={open}
		aria-describedby={open ? tipId : undefined}
		onclick={toggle}
	>
		<span class="metric-info__glyph" aria-hidden="true">i</span>
	</button>

	{#if open}
		<span
			bind:this={pop}
			id={tipId}
			role="tooltip"
			class={cn('metric-info__pop', `metric-info__pop--${resolvedSide}`)}
			class:metric-info__pop--placed={placed}
			style="left: {fixedLeft}px; top: {fixedTop}px; transform: {transform};"
		>
			<span class="metric-info__tip">{tip}</span>
			<a
				class="metric-info__link"
				{href}
				target={newTab ? '_blank' : undefined}
				rel={newTab ? 'noopener noreferrer' : undefined}
			>
				{linkLabel}
				<span aria-hidden="true">&rarr;</span>
			</a>
		</span>
	{/if}
</span>

<style>
	.metric-info {
		position: relative;
		display: inline-flex;
		align-items: center;
		vertical-align: baseline;
	}

	/* Trigger glyph — an INTERACTIVE affordance, so --primary is doctrine-clean
	   here (doctrine-allow: interactive). Muted at rest, accent on hover/focus. */
	.metric-info__trigger {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		inline-size: 1.05rem;
		block-size: 1.05rem;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: transparent;
		color: var(--muted-foreground);
		cursor: pointer;
		line-height: 1;
		transition:
			color var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
	}
	/* Touch target floor (P5.3d §C4 P10): the glyph stays a 17px dot but the
	   HIT area is expanded to --size-tap-min via a centered transparent overlay.
	   Absolutely positioned → zero layout shift on the inline label row. */
	.metric-info__trigger::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		translate: -50% -50%;
		min-inline-size: var(--size-tap-min);
		min-block-size: var(--size-tap-min);
	}
	.metric-info__trigger:hover,
	.metric-info__trigger[aria-expanded='true'] {
		color: var(--primary);
		border-color: var(--primary);
	}
	.metric-info__trigger:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.metric-info__glyph {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-style: italic;
		font-weight: 700;
	}

	/* Popover surface — solid --popover (no alpha, per doctrine), AA text.
	   position:FIXED + viewport coordinates (left/top/transform set inline by the
	   edge-aware effect) so it never clips at a screen edge and never overflows on
	   a narrow viewport. It REPOSITIONS, never shrinks. */
	.metric-info__pop {
		position: fixed;
		left: 0;
		top: 0;
		z-index: var(--z-menu);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		inline-size: max-content;
		/* Cap only so a box never exceeds a tiny viewport; the content's natural
		   width wins on normal screens. */
		max-inline-size: min(18rem, calc(100vw - 2 * 8px));
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--popover);
		color: var(--popover-foreground);
		box-shadow: var(--shadow-card);
		/* Hidden until the first measurement lands (avoids a one-frame flash at 0,0). */
		opacity: 0;
	}
	.metric-info__pop--placed {
		opacity: 1;
		animation: metric-info-in var(--duration-fast) var(--ease-out);
	}
	.metric-info__tip {
		font-size: var(--text-small);
		line-height: 1.5;
		color: var(--popover-foreground);
		text-align: start;
		white-space: normal;
	}
	/* Link is an interactive affordance → --primary is doctrine-clean
	   (doctrine-allow: interactive). */
	.metric-info__link {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		text-transform: uppercase;
		letter-spacing: var(--tracking-eyebrow);
		color: var(--primary);
		text-decoration: none;
	}
	.metric-info__link:hover,
	.metric-info__link:focus-visible {
		text-decoration: underline;
	}
	.metric-info__link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
		border-radius: 2px;
	}

	/* Entrance is a pure opacity fade: the inline `transform` (set by the
	   edge-aware effect) owns positioning, so the keyframe must not touch it. */
	@keyframes metric-info-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.metric-info__trigger {
			transition: none;
		}
		.metric-info__pop--placed {
			animation: none;
		}
	}
</style>
