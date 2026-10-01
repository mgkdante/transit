<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import { SectionLabel } from '@yesid/ui/brand';
	import SectionHeading from './SectionHeading.svelte';
	import { Separator } from '@yesid/ui/separator';

	export interface MastheadProps {
		kicker: string;
		heading: string;
		subheading?: string;
		lede?: string;
		level?: 1 | 2 | 3 | 4 | 5 | 6;
		headingId?: string;
		explainer?: Snippet;
		cornerMeta?: Snippet;
		meta?: Snippet;
		children?: Snippet;
		tape?: boolean;
		class?: string;
	}

	let {
		kicker,
		heading,
		subheading,
		lede,
		level = 1,
		headingId,
		explainer,
		cornerMeta,
		meta,
		children,
		tape = true,
		class: className,
	}: MastheadProps = $props();
</script>

<div class={cn('masthead', className)} data-slot="masthead">
	<header class="masthead-head" class:masthead-head--cornered={cornerMeta}>
		{#if cornerMeta}
			{@render cornerMeta()}
		{/if}
		<SectionLabel text={kicker} variant="station" />
		<SectionHeading {heading} {subheading} {level} id={headingId} dot {explainer} />
		{#if lede}
			<p class="masthead-lede">{lede}</p>
		{/if}
		{#if meta}
			<div class="masthead-meta" data-slot="masthead-meta">{@render meta()}</div>
		{/if}
	</header>

	{#if children}
		<div class="masthead-body" data-slot="masthead-body">{@render children()}</div>
	{/if}

	{#if tape}
		<Separator variant="hazard" maxWidth="100%" class="masthead-tape" />
	{/if}
</div>

<style>
	.masthead {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
	.masthead-head {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.masthead-head--cornered {
		position: relative;
	}
	@media (min-width: 768px) {
		.masthead-head--cornered {
			padding-block: 1.75rem;
		}
	}
	.masthead-lede {
		color: var(--muted-foreground);
		font-size: var(--text-subheading);
		line-height: 1.6;
		max-width: var(--measure-lede);
	}
	.masthead-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: var(--tracking-eyebrow);
		color: var(--muted-foreground);
	}
	.masthead-body {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
</style>
