<!--
  NumberedChip — the zero-padded section index mark (D4/H4 infra, P5.3b).

  A tiny mono `01`/`02` chip that leads a numbered section title (SectionHeading)
  and the table-of-contents rail. ONE renderer for the numbered-section idiom so
  the chip on a section head can never drift from the chip in its ToC entry.

  Geometry: mono, tabular-nums (so `01`..`12` are all the same width and the
  chips column-align in a ToC), `--tracking-eyebrow`, zero-padded to at least two
  digits. Decorative by default (`aria-hidden`) — the number repeats the section's
  own order, which the heading text + DOM order already convey to assistive tech;
  pass `decorative={false}` for the rare case it must be announced.

  DOCTRINE: --primary here is an interactive/wayfinding affordance mark (the
  numbered index), never a data mark. Fill vocabulary mirrors the active/rest
  split the ToC already uses. (doctrine-allow: interactive)
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';

	export interface NumberedChipProps extends HTMLAttributes<HTMLSpanElement> {
		/** 1-based section index (rendered zero-padded, e.g. 1 → "01"). */
		value: number;
		/** Emphasis: `rest` (quiet outline) or `active` (primary-tinted). */
		tone?: 'rest' | 'active';
		/** Announce the number to assistive tech. Default false (decorative). */
		decorative?: boolean;
		class?: string;
	}

	let {
		value,
		tone = 'rest',
		decorative = true,
		class: className,
		...restProps
	}: NumberedChipProps = $props();

	// Zero-pad to at least two digits; three-digit sections keep all their digits.
	const label = $derived(String(Math.trunc(value)).padStart(2, '0'));
</script>

<span
	data-slot="numbered-chip"
	data-tone={tone}
	class={cn('numbered-chip', className)}
	aria-hidden={decorative ? 'true' : undefined}
	{...restProps}>{label}</span
>

<style>
	.numbered-chip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.75rem;
		height: 1.5rem;
		padding-inline: 0.375rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: transparent;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 600;
		letter-spacing: var(--tracking-eyebrow);
		/* tabular-nums → every index is the same width, so ToC chips column-align. */
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
		flex-shrink: 0;
		line-height: 1;
	}

	/* Active section → the wayfinding-orange tint (interactive affordance, not data). */
	.numbered-chip[data-tone='active'] {
		border-color: color-mix(in srgb, var(--primary) 30%, transparent);
		background: color-mix(in srgb, var(--primary) 15%, transparent);
		color: var(--primary);
	}
</style>
