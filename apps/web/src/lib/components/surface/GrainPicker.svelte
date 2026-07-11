<!--
  GrainPicker — a small day|week|month segmented control for picking the roll-up
  grain a historic surface reads at.

  Surface-agnostic: the caller supplies the offered segments (already gated on the
  tier's availableGrains AND on which grains actually carry data, so an empty grain
  is never offered) plus their localized labels, and binds `value`. The control
  owns ONLY the radio-group affordance + keyboard semantics; it knows nothing about
  the data behind a grain.

  DOCTRINE: the active chip is an INTERACTION accent → --primary belongs here (an
  interactive control, never a data mark). Bilingual labels come from the caller.
  a11y: a WAI-ARIA radiogroup of role=radio buttons with aria-checked + roving
  tabindex (only the checked segment is tab-focusable); arrow keys move selection
  to the next/previous ENABLED segment (wrapping, skipping disabled). A disabled
  segment is never selectable.

  SCOPE: the lines surface (RouteReliabilityClusters) still ships its own segmented
  control by deliberate choice — it adopts this GrainPicker in the lines-polish
  batch, not here.
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	// F (motion wiring): the grain toggles are the segmented "grain-picker toggles"
	// boop targets — a self-resetting hover pop on desktop (SAFE-ALWAYS, touch-gated),
	// with pressBounce + the .tap-press CSS baseline for touch tactility. All three
	// self-gate (boop/pressBounce no-op on the wrong pointer type; tap-press is
	// PRM-guarded). Vendored actions, never edited.
	import { boop, pressBounce } from '@yesid/motion';

	export type GrainPickerVariant = 'default' | 'time-grid';

	/** One offered grain segment. `available:false` renders disabled (never picked). */
	export interface GrainSegment<K extends string = string> {
		readonly key: K;
		readonly label: string;
		readonly compactLabel?: string;
		readonly available?: boolean;
		/**
		 * Id of a description element wired to aria-describedby, so assistive tech
		 * announces context: for a DISABLED segment, WHY it is off; for an ENABLED
		 * segment, its positive `hint` (what this grain shows). The caller sets it for
		 * whichever it supplied.
		 */
		readonly describedById?: string;
		/** Tooltip carrying the DISABLED reason for pointer users (disabled segments only). */
		readonly title?: string;
		/**
		 * Positive per-grain explainer for an ENABLED segment (e.g. "Weekly granularity")
		 * — surfaced as the segment's pointer `title` so a hover clarifies what the grain
		 * shows (the grain/sub-grain confusion fix). Ignored on disabled segments (they
		 * carry `title` = the absence reason instead).
		 */
		readonly hint?: string;
	}

	export interface GrainPickerProps<K extends string = string> {
		/** The offered segments, in finest→coarsest order. */
		segments: readonly GrainSegment<K>[];
		/** The selected grain key (bindable). */
		value: K;
		/** Accessible group label. */
		label: string;
		/** Optional layout treatment; defaults to the shared flexible control. */
		variant?: GrainPickerVariant;
		/** Optional extra classes on the root. */
		class?: string;
	}

	let {
		segments,
		value = $bindable(),
		label,
		variant = 'default',
		class: className,
	}: GrainPickerProps = $props();

	/** Button refs, keyed by segment index, so keyboard nav can move focus. */
	const refs: (HTMLButtonElement | null)[] = $state([]);

	function pick(seg: GrainSegment): void {
		if (seg.available === false) return;
		value = seg.key;
	}

	/** Is a segment selectable (offered + not disabled)? */
	function isEnabled(seg: GrainSegment): boolean {
		return seg.available !== false;
	}

	/** The index of the currently-checked segment (roving-tabindex anchor). */
	const checkedIndex = $derived(
		Math.max(
			0,
			segments.findIndex((s) => s.key === value),
		),
	);

	/**
	 * WAI-ARIA radiogroup keyboard pattern: ArrowRight/Down → next enabled segment,
	 * ArrowLeft/Up → previous enabled segment, wrapping and skipping disabled ones.
	 * Selecting also moves focus, so the roving tabindex stays on the checked radio.
	 */
	function onkeydown(event: KeyboardEvent): void {
		const dir =
			event.key === 'ArrowRight' || event.key === 'ArrowDown'
				? 1
				: event.key === 'ArrowLeft' || event.key === 'ArrowUp'
					? -1
					: 0;
		if (dir === 0) return;
		const n = segments.length;
		if (n === 0) return;
		// Walk from the checked segment in `dir`, wrapping, until an enabled one is
		// found (or we return to the start → no enabled neighbour, leave as-is).
		for (let step = 1; step <= n; step++) {
			const next = (((checkedIndex + dir * step) % n) + n) % n;
			if (isEnabled(segments[next])) {
				event.preventDefault();
				value = segments[next].key;
				refs[next]?.focus();
				return;
			}
		}
	}
</script>

<div
	class={cn('grain-picker', variant === 'time-grid' && 'grain-picker--time-grid', className)}
	role="radiogroup"
	aria-label={label}
	data-slot="grain-picker"
	data-variant={variant}
>
	{#each segments as seg, i (seg.key)}
		<button
			bind:this={refs[i]}
			type="button"
			role="radio"
			class="tap-press grain-seg"
			class:grain-seg--active={value === seg.key}
			aria-checked={value === seg.key}
			aria-describedby={seg.describedById}
			aria-label={seg.compactLabel ? seg.label : undefined}
			title={seg.available === false
				? seg.title
				: (seg.hint ?? (seg.compactLabel ? seg.label : undefined))}
			disabled={seg.available === false}
			tabindex={i === checkedIndex ? 0 : -1}
			onclick={() => pick(seg)}
			use:boop={{ scale: 1.04 }}
			use:pressBounce
			{onkeydown}
		>
			{seg.compactLabel ?? seg.label}
		</button>
	{/each}
</div>

<style>
	.grain-picker {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		padding: 0.25rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background-color: var(--card);
	}
	.grain-picker--time-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		grid-template-rows: repeat(2, 52px);
		width: 100%;
		min-width: 0;
		gap: 0;
		padding: 0;
		overflow: hidden;
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--primary) 6%, var(--card));
	}
	.grain-picker--time-grid .grain-seg {
		width: 100%;
		min-width: 0;
		min-height: 52px;
		padding-inline: 0.375rem;
		border-radius: 0;
		scale: 1 !important;
		transform: none !important;
		white-space: nowrap;
		overflow-wrap: normal;
		word-break: keep-all;
	}
	.grain-picker--time-grid .grain-seg:nth-child(odd) {
		border-inline-end: 1px solid var(--border);
	}
	.grain-picker--time-grid .grain-seg:nth-child(-n + 2) {
		border-block-end: 1px solid var(--border);
	}
	.grain-picker--time-grid .grain-seg--active {
		box-shadow:
			var(--shadow-glow-sm),
			inset 0 1px 0 var(--edge-highlight);
	}
	.grain-picker--time-grid .grain-seg:focus-visible {
		outline-offset: -3px;
	}
	.grain-seg {
		appearance: none;
		border: 0;
		background: transparent;
		color: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.2;
		/* WCAG 2.5.8 tap target: the segmented control sat at ~31px tall while every sibling
		   control (pills, tabs, Detail) holds 44px. Center the label in a 44px-min box. */
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: 0.375rem 0.8rem;
		border-radius: var(--radius-md);
		cursor: pointer;
		transition:
			background-color var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default);
	}
	.grain-seg:hover:not(:disabled) {
		color: var(--foreground);
	}
	/* A grain with no data for this entity is disabled, never a silent no-op. */
	.grain-seg:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	/* The active chip is an INTERACTION accent — --primary belongs here (never on a
	   data mark). The data bands own the data-colour doctrine. */
	.grain-seg--active {
		background-color: var(--primary);
		color: var(--primary-foreground);
	}
	.grain-seg:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	@media (prefers-reduced-motion: reduce) {
		.grain-seg {
			transition: none;
		}
	}
</style>
