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
	/* A PROMINENT, colourful affordance (operator: "very big and colourful" — the detail
	   toggle is doing a lot, it lets a rider acknowledge the intent before opening). It IS
	   an interactive control, so the brand ORANGE is doctrine-correct here (affordance, not
	   a data mark): a tinted orange pill with a bold label + the rotating chevron. */
	.detail__toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		/* Generous, comfortably above the WCAG 2.2 2.5.8 24px floor. */
		min-height: 48px;
		padding: 0.6rem 1.15rem;
		font-family: var(--font-mono);
		font-size: var(--text-body);
		font-weight: 600;
		letter-spacing: var(--tracking-wide);
		color: var(--primary);
		background: color-mix(in srgb, var(--primary) 9%, transparent);
		border: 1.5px solid var(--border-brand);
		border-radius: var(--radius-pill);
		cursor: pointer;
		transition:
			background var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default);
	}
	.detail__toggle:hover {
		background: color-mix(in srgb, var(--primary) 18%, transparent);
		border-color: var(--primary);
		color: var(--primary-hover);
	}
	.detail__toggle:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	@media (prefers-reduced-motion: reduce) {
		.detail__toggle {
			transition: none;
		}
	}

	/* Breathing room between the toggle and the revealed analyst charts. */
	.detail__body {
		padding-top: 0.75rem;
	}
</style>
