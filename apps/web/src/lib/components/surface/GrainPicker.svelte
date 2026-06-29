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

	/** One offered grain segment. `available:false` renders disabled (never picked). */
	export interface GrainSegment<K extends string = string> {
		readonly key: K;
		readonly label: string;
		readonly available?: boolean;
	}

	export interface GrainPickerProps<K extends string = string> {
		/** The offered segments, in finest→coarsest order. */
		segments: readonly GrainSegment<K>[];
		/** The selected grain key (bindable). */
		value: K;
		/** Accessible group label. */
		label: string;
		/** Optional extra classes on the root. */
		class?: string;
	}

	let { segments, value = $bindable(), label, class: className }: GrainPickerProps = $props();

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
	class={cn('grain-picker', className)}
	role="radiogroup"
	aria-label={label}
	data-slot="grain-picker"
>
	{#each segments as seg, i (seg.key)}
		<button
			bind:this={refs[i]}
			type="button"
			role="radio"
			class="grain-seg"
			class:grain-seg--active={value === seg.key}
			aria-checked={value === seg.key}
			disabled={seg.available === false}
			tabindex={i === checkedIndex ? 0 : -1}
			onclick={() => pick(seg)}
			{onkeydown}
		>
			{seg.label}
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
		border-radius: var(--radius-lg, 0.75rem);
		background-color: var(--card);
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
		padding: 0.4rem 0.8rem;
		border-radius: var(--radius-md, 0.5rem);
		cursor: pointer;
		transition:
			background-color 0.15s ease,
			color 0.15s ease;
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
