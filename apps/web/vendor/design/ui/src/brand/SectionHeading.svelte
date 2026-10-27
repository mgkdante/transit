<!--
  Section title with the brand dot, or a mono overline when only `overline` is set.
  The dot stays on the last word's line and is hidden from assistive tech.
-->
<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	export interface SectionHeadingProps extends HTMLAttributes<HTMLDivElement> {
		heading?: string;
		subheading?: string;
		/** Renders the mono overline style; ignored when `heading` is set. */
		overline?: string;
		level?: 1 | 2 | 3 | 4 | 5 | 6;
		dot?: boolean;
		/** Leading zero-padded section number. */
		number?: number;
		numberTone?: 'rest' | 'active';
		/** Inline content after the title, such as an info trigger. */
		explainer?: Snippet;
		/** Second, accent-colored line after the heading. */
		headingAccent?: string;
		class?: string;
	}
</script>

<script lang="ts">
	import { cn } from '../cn/index.js';
	import NumberedChip from './numbered-chip.internal.svelte';

	let {
		heading,
		subheading,
		overline,
		level = 2,
		dot = true,
		number,
		numberTone = 'rest',
		explainer,
		headingAccent,
		class: className,
		...restProps
	}: SectionHeadingProps = $props();

	const tag = $derived(`h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6');
	const isOverline = $derived(overline != null && heading == null);
	const titleText = $derived(isOverline ? (overline ?? '') : (heading ?? ''));

	function splitTail(text: string): { head: string; tail: string } {
		const match = /^([\s\S]*\s)(\S+)$/.exec(text);
		return match ? { head: match[1], tail: match[2] } : { head: '', tail: text };
	}
	const titleParts = $derived(splitTail(titleText));
	const accentParts = $derived(splitTail(headingAccent ?? ''));
</script>

{#snippet brandDot()}<span data-slot="section-heading-dot" class="section-heading-dot" aria-hidden="true"
		>.</span
	>{/snippet}

<div
	data-slot="section-heading"
	data-mode={isOverline ? 'overline' : 'display'}
	class={cn('section-heading', className)}
	{...restProps}
>
	<svelte:element this={tag} class={isOverline ? 'section-heading-overline' : 'section-heading-text'}>
		{#if number != null}<NumberedChip value={number} tone={numberTone} class="section-heading-chip" />{/if}<span
			class="section-heading-title"
			>{#if headingAccent && !isOverline}{titleText}<span
					data-slot="section-heading-accent"
					class="section-heading-accent"
					>{accentParts.head}<span class="section-heading-tail"
						>{accentParts.tail}{#if dot}{@render brandDot()}{/if}</span
					></span
				>{:else if dot && !isOverline}{titleParts.head}<span class="section-heading-tail"
					>{titleParts.tail}{@render brandDot()}</span
				>{:else}{titleText}{/if}</span
		>{#if explainer}<span class="section-heading-explainer">{@render explainer()}</span>{/if}
	</svelte:element>
	{#if subheading && !isOverline}
		<p data-slot="section-heading-sub" class="section-heading-sub">{subheading}</p>
	{/if}
</div>

<style>
	.section-heading-text {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.5rem;
		font-family: var(--font-heading);
		font-size: var(--text-display);
		font-weight: 900;
		color: var(--foreground);
		letter-spacing: -2px;
		margin-block-end: 6px;
	}
	.section-heading-dot {
		color: var(--primary);
	}
	.section-heading-tail {
		white-space: nowrap;
	}
	.section-heading-accent {
		display: block;
		color: var(--primary);
	}
	.section-heading-sub {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
		letter-spacing: 2px;
		text-transform: uppercase;
		margin-block-end: 36px;
	}

	.section-heading-overline {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-mono);
		font-weight: 600;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: color-mix(in srgb, var(--accent-text) 80%, var(--foreground));
		line-height: 1.2;
	}

	.section-heading :global(.section-heading-chip) {
		align-self: center;
	}
	.section-heading-title {
		min-width: 0;
	}
	.section-heading-explainer {
		display: inline-flex;
		align-items: center;
		align-self: center;
	}
</style>
