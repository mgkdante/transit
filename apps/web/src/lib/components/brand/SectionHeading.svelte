<script lang="ts">
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import NumberedChip from './NumberedChip.svelte';

	export interface SectionHeadingProps extends HTMLAttributes<HTMLDivElement> {
		heading?: string;
		subheading?: string;
		overline?: string;
		level?: 1 | 2 | 3 | 4 | 5 | 6;
		dot?: boolean;
		number?: number;
		numberTone?: 'rest' | 'active';
		explainer?: Snippet;
		headingAccent?: string;
		class?: string;
	}

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
		const m = /^([\s\S]*\s)(\S+)$/.exec(text);
		return m ? { head: m[1], tail: m[2] } : { head: '', tail: text };
	}
	const titleParts = $derived(splitTail(titleText));
	const accentParts = $derived(splitTail(headingAccent ?? ''));
</script>

<div
	data-slot="section-heading"
	data-mode={isOverline ? 'overline' : 'display'}
	class={cn('section-heading', className)}
	{...restProps}
>
	<svelte:element
		this={tag}
		class={isOverline ? 'section-heading-overline' : 'section-heading-text'}
	>
		{#if number != null}<NumberedChip
				value={number}
				tone={numberTone}
				class="section-heading-chip"
			/>{/if}<span class="section-heading-title"
			>{#if headingAccent && !isOverline}{titleText}<span
					data-slot="section-heading-accent"
					class="section-heading-accent"
					>{accentParts.head}<span class="section-heading-tail"
						>{accentParts.tail}{#if dot}<span
								data-slot="section-heading-dot"
								class="section-heading-dot"
								aria-hidden="true">.</span
							>{/if}</span
					></span
				>{:else if dot && !isOverline}{titleParts.head}<span class="section-heading-tail"
					>{titleParts.tail}<span
						data-slot="section-heading-dot"
						class="section-heading-dot"
						aria-hidden="true">.</span
					></span
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
		font-size: var(--text-mono);
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
