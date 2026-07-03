<!--
  SectionProgress — the `SEC n / m` reading-position readout (D4/H4 infra, P5.3b).

  A mono micro line that says which section of how many is currently in view
  (e.g. `SEC 03 / 08`). Extracted from the inline block TocNav hand-rolled so the
  left-rail of DetailTemplate and the ToC share ONE readout. The LED dot is the
  same rest-glow the ToC counter uses.

  Numbers are tabular-nums + zero-padded (mirrors NumberedChip) so the readout
  doesn't reflow as the active index changes. `current` is 1-based; it is clamped
  into [1, total] here so a caller can pass a raw index without guarding.

  a11y: it is a live position indicator, so it renders as a real text line (not
  `aria-hidden`); `role="status"` + `aria-live="polite"` so a screen reader hears
  the position update as the reader scrolls, worded via the localized `label`.

  DOCTRINE: --primary/--glow here is an interactive/wayfinding affordance (reading
  position), never a data mark. (doctrine-allow: interactive)
-->
<script lang="ts">
	import { cn } from '$lib/utils';

	export interface SectionProgressProps {
		/** 1-based index of the section currently in view. */
		current: number;
		/** Total number of navigable sections. */
		total: number;
		/** Mono prefix (e.g. "SEC"). Default "SEC". */
		prefix?: string;
		/**
		 * Localized accessible sentence, e.g. "Section 3 of 8". When omitted the
		 * visible `SEC n / m` shorthand is the accessible name too.
		 */
		label?: string;
		class?: string;
	}

	let { current, total, prefix = 'SEC', label, class: className }: SectionProgressProps = $props();

	// Clamp to [1, total] so a raw 0-based/overflowing index still reads sanely.
	const safeTotal = $derived(Math.max(1, Math.trunc(total)));
	const safeCurrent = $derived(Math.min(Math.max(1, Math.trunc(current)), safeTotal));
	const pad = $derived((n: number) => String(n).padStart(2, '0'));
</script>

<div
	data-slot="section-progress"
	class={cn('section-progress', className)}
	role="status"
	aria-live="polite"
	aria-label={label}
>
	<span class="section-progress__dot" aria-hidden="true"></span>
	<span class="section-progress__text" aria-hidden={label ? 'true' : undefined}>
		{prefix}
		{pad(safeCurrent)} / {pad(safeTotal)}
	</span>
</div>

<style>
	.section-progress {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	.section-progress__dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--primary);
		/* The lone sanctioned rest-glow family (status/wayfinding LED). */
		box-shadow: 0 0 8px color-mix(in srgb, var(--glow) 40%, transparent);
		flex-shrink: 0;
	}
	.section-progress__text {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: var(--tracking-eyebrow);
		font-variant-numeric: tabular-nums;
		color: color-mix(in srgb, var(--primary) 30%, transparent);
	}
</style>
