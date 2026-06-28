<!--
  Detail — the lightweight "Show the detail" progressive-disclosure expander.

  The reliability surface leads each rider-question section with a verdict line +
  ONE always-visible primary chart; the dense analyst charts (distribution,
  crosstab, per-shift breakdowns, confidence bands) live one opt-in level deeper,
  behind this control. Closed by DEFAULT — that is the whole point of progressive
  disclosure: a calm default view, the full data one tap away. Keep to ONE
  disclosure level (research: designs past 2 levels lose users — NN/g 2006).

  Built on the bits-ui Collapsible (CollapsibleTrigger/Content) so it inherits
  aria-expanded + aria-controls wiring, Enter/Space keyboard, and the grid-rows
  0fr→1fr open/close animation (reduced-motion-guarded). Styled as a CONTROL
  (chevron + "Show/Hide" text), never a link — the WCAG disclosure pattern + the
  a11y research (Label-in-Name: the visible label IS the accessible name).

  Locale-agnostic: the labels are passed in (FR-canonical copy lives with the
  consumer), so this primitive performs no i18n.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import {
		Collapsible,
		CollapsibleTrigger,
		CollapsibleContent,
	} from '$lib/components/ui/collapsible';
	import { ChevronToggle } from '$lib/components/brand';

	let {
		label,
		labelOpen = undefined,
		open = $bindable(false),
		class: className,
		children,
	}: {
		/** Control text when collapsed, e.g. "Show the detail". */
		label: string;
		/** Optional control text when expanded, e.g. "Hide the detail". Falls back to `label`. */
		labelOpen?: string;
		/** Expanded state — closed by default (progressive disclosure). Bindable. */
		open?: boolean;
		class?: string;
		children?: Snippet;
	} = $props();

	const currentLabel = $derived(open ? (labelOpen ?? label) : label);
</script>

<div class={cn('detail', className)} data-slot="detail">
	<Collapsible bind:open>
		<CollapsibleTrigger>
			{#snippet child({ props })}
				<button {...props} type="button" class="detail__toggle" data-slot="detail-toggle">
					<ChevronToggle {open} direction="down" size="sm" />
					<span>{currentLabel}</span>
				</button>
			{/snippet}
		</CollapsibleTrigger>
		<CollapsibleContent>
			<div class="detail__body" data-slot="detail-body">
				{@render children?.()}
			</div>
		</CollapsibleContent>
	</Collapsible>
</div>

<style>
	/* A QUIET text+chevron control (operator: "make it simpler, not as sharp" — the heavy
	   tinted-orange pill was over-weighted for a one-tap disclosure). It is still an
	   interactive control, so the brand ORANGE stays on the LABEL (an affordance cue, not a
	   data mark) — but the pill background + border are gone: just the rotating chevron + the
	   label, underlined on hover. The tap target is held by padding (min-height 44px). */
	.detail__toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		/* WCAG 2.2 (2.5.8) tap target, via padding rather than a heavy box. */
		min-height: 44px;
		padding: 0.4rem 0.15rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-weight: 500;
		letter-spacing: var(--tracking-wide);
		color: var(--primary);
		background: none;
		border: none;
		cursor: pointer;
		transition: color var(--duration-fast) var(--ease-default);
	}
	.detail__toggle:hover {
		color: var(--primary-hover);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.detail__toggle:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 3px;
		border-radius: var(--radius-sm, 0.375rem);
	}
	@media (prefers-reduced-motion: reduce) {
		.detail__toggle {
			transition: none;
		}
	}

	/* Generous breathing room: the toggle-to-content gap PLUS a large gap BETWEEN every
	   revealed analyst block, in EVERY section (operator: opened details felt too plump).
	   A flex column with a clamp gap so the blocks read as distinct, uncrowded units. */
	.detail__body {
		display: flex;
		flex-direction: column;
		gap: clamp(1.75rem, 4vw, 2.75rem);
		padding-top: 1.5rem;
	}
</style>
