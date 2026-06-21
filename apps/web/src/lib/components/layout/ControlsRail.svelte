<!--
  ControlsRail — the surface control panel (discerns controls from data).

  A visually-distinct, mono-labelled container that COLLECTS the granular
  controls of a surface — grain / window / series / status / date pickers plus
  filter chips — into ONE zone, separated from the data canvas. Reads as an
  infra control panel: a bordered card on --card with a mono group label, a token
  radius, and comfortable padding.

    DESKTOP: an upright control panel; pass `sticky` to park it under the sticky
      chrome (position:sticky at top:5.5rem) so the controls stay in reach while
      the data scrolls. It pairs naturally as the `rail` of a RailLayout.
    MOBILE: a grouped bar whose controls wrap (the sticky offset is dropped — a
      sticky control bar would eat scarce phone viewport).

  Chrome only, doctrine-clean: NO --primary on the rail itself (the panel is
  quiet furniture). --primary belongs only to whatever ACTIVE control chips the
  caller places inside via `children`. Layout + container styling, tokens only.

  `label` is an optional bilingual string from the caller (e.g. "CONTROLS" /
  "CONTRÔLES"); when present it renders as a SectionLabel-style mono overline and
  names a labelled GROUP for assistive tech.

  A11Y: the root is a `<div role="group">`, NOT a `<section>` landmark. A cluster
  of controls is not a top-level page region — one ControlsRail per tab pane (two
  on /stop) as a `region` would add landmark noise. A labelled `group` is the
  correct semantics for a control cluster and carries no landmark weight. When no
  `label` is given there is no name to expose, so `role`/`aria-label` are both
  dropped — a plain grouping div.
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	interface ControlsRailProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
		/** Bilingual group label (caller-supplied). Renders as a mono overline + region name. */
		label?: string;
		/** The granular controls — pickers, toggles, filter chips. */
		children?: Snippet;
		/** Desktop sticky (position:sticky, top:5.5rem). Default false. */
		sticky?: boolean;
		class?: string;
	}

	let {
		label,
		children,
		sticky = false,
		class: className,
		...restProps
	}: ControlsRailProps = $props();
</script>

<!-- role="group" ONLY when labelled: a labelled group is the right semantics for
     a control cluster (and is NOT a landmark, unlike a labelled <section>). With
     no label there is nothing to name, so it stays a plain grouping div. -->
<div
	class={cn('controls-rail', sticky && 'controls-rail--sticky', className)}
	data-slot="controls-rail"
	role={label ? 'group' : undefined}
	aria-label={label}
	{...restProps}
>
	{#if label}
		<span class="controls-rail__label" data-slot="controls-rail-label">{label}</span>
	{/if}
	<div class="controls-rail__body" data-slot="controls-rail-body">
		{@render children?.()}
	</div>
</div>

<style>
	/* The control panel: a quiet, bordered card on --card. Comfortable padding,
	   token radius. NOT a data mark, NOT --primary — chrome only. */
	.controls-rail {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--card);
		min-width: 0;
	}

	/* Mono SectionLabel-style group overline (matches the brand `label-station`
	   voice without a colour cue — the panel chrome stays quiet). */
	.controls-rail__label {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--tracking-eyebrow);
		color: var(--muted-foreground);
	}

	/* Mobile: a grouped bar whose controls wrap. The caller's pickers / chips lay
	   out left-to-right and reflow onto new rows as space runs out. */
	.controls-rail__body {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.625rem;
		min-width: 0;
	}

	@media (min-width: 1024px) {
		/* Desktop sticky: park the panel under the sticky chrome (same 5.5rem inset
		   as RailLayout's rail), so it holds its place while the data canvas scrolls. */
		.controls-rail--sticky {
			position: sticky;
			top: 5.5rem;
		}
	}
</style>
