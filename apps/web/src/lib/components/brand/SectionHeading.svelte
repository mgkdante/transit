<!--
  SectionHeading — display heading + optional mono subheading (Set A).
  Brand primitive: the canonical section/page title block.
  Adapted from yesid.dev SectionHeading; re-themed to transit tokens.

  The trailing dot is a brand FLOURISH (orange = --primary, the interactive
  accent), not a data mark — doctrine-clean.
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';

	export interface SectionHeadingProps extends HTMLAttributes<HTMLDivElement> {
		/** Main heading text. */
		heading: string;
		/** Optional mono subheading (e.g. "// MESURE D'IMPACT"). */
		subheading?: string;
		/** Heading level (1–6). Default 2 for sections; use 1 for page titles. */
		level?: 1 | 2 | 3 | 4 | 5 | 6;
		/** Show the brand orange dot after the heading. */
		dot?: boolean;
		class?: string;
	}

	let {
		heading,
		subheading,
		level = 2,
		dot = true,
		class: className,
		...restProps
	}: SectionHeadingProps = $props();

	let tag = $derived(`h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6');
</script>

<div data-slot="section-heading" class={cn('', className)} {...restProps}>
	<svelte:element this={tag} class="section-heading-text">
		{heading}{#if dot}<span
				data-slot="section-heading-dot"
				class="section-heading-dot"
				aria-hidden="true">.</span
			>{/if}
	</svelte:element>
	{#if subheading}
		<p data-slot="section-heading-sub" class="section-heading-sub">{subheading}</p>
	{/if}
</div>

<style>
	.section-heading-text {
		font-family: var(--font-heading);
		font-size: clamp(2.5rem, 6vw, 4rem);
		font-weight: 900;
		color: var(--foreground);
		letter-spacing: -2px;
		margin-block-end: 6px;
	}
	/* Brand flourish — the interactive-accent orange (doctrine: not a data mark). */
	.section-heading-dot {
		color: var(--primary);
	}
	.section-heading-sub {
		font-family: var(--font-mono);
		font-size: var(--text-mono);
		color: var(--muted-foreground);
		letter-spacing: 2px;
		text-transform: uppercase;
		margin-block-end: 36px;
	}
</style>
