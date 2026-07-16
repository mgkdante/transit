<!--
  BlueprintListingHeader — the shared Blog/Projects listing-header grammar.

  The artwork is a composition of real SVG components supplied by the feature,
  not a responsive raster card. It fills the complete header band behind the
  bottom-left title/subtitle overlay. The desktop edge title lives in
  ListingPageShell, so this h1 is visually hidden there while remaining the one
  semantic page heading.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import { startBlueprintScrub } from '$lib/motion/scrubs/blueprint-scrub';
	import { cn } from '$lib/utils';
	import ListingHeaderStats, { type ListingHeaderStat } from './ListingHeaderStats.svelte';

	export interface BlueprintListingHeaderProps {
		heading: string;
		subtitle: string;
		description?: string;
		blueprint: Snippet;
		statsLabel?: string;
		statsUnknownLabel?: string;
		stats?: readonly ListingHeaderStat[];
		class?: string;
	}

	let {
		heading,
		subtitle,
		description,
		blueprint,
		statsLabel,
		statsUnknownLabel,
		stats,
		class: className,
	}: BlueprintListingHeaderProps = $props();
	let headerElement: HTMLElement;

	onMount(() => startBlueprintScrub(headerElement));
</script>

<header
	bind:this={headerElement}
	class={cn('listing-blueprint-header', className)}
	data-slot="blueprint-listing-header"
>
	<div class="listing-blueprint-art" data-slot="blueprint-listing-art">
		{@render blueprint()}
	</div>

	<div class="listing-header-content" data-slot="blueprint-listing-content">
		<div class="listing-header-text">
			<h1 class="listing-mobile-heading">
				{heading}<span class="listing-heading-dot" aria-hidden="true">.</span>
			</h1>
			<p class="listing-header-subtitle">{subtitle}</p>
			{#if description}
				<p class="listing-header-description">{description}</p>
			{/if}
		</div>

		{#if stats?.length && statsLabel}
			<ListingHeaderStats label={statsLabel} unknownLabel={statsUnknownLabel} {stats} />
		{/if}
	</div>
</header>

<style>
	.listing-blueprint-header {
		position: relative;
		display: grid;
		min-height: calc(208px + var(--chrome-offset));
		overflow: hidden;
		margin-top: calc(-1 * var(--chrome-offset));
		padding-top: var(--chrome-offset);
	}

	.listing-blueprint-art {
		position: absolute;
		inset: 0;
	}

	.listing-header-content {
		position: relative;
		z-index: calc(var(--z-content) + 10);
		display: grid;
		align-content: end;
		gap: 0.875rem;
		width: 100%;
		min-width: 0;
		padding: 1rem var(--space-page-x);
	}

	.listing-header-text {
		min-width: 0;
	}

	.listing-mobile-heading {
		margin: 0;
		font-family: var(--font-heading);
		font-size: var(--text-listing-title);
		font-weight: 900;
		color: var(--foreground);
		letter-spacing: 0;
		line-height: 1;
	}

	.listing-heading-dot {
		color: var(--primary);
	}

	.listing-header-subtitle {
		margin: 0.35rem 0 0;
		max-width: 70ch;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		color: var(--accent-text);
		letter-spacing: 0;
		line-height: 1.35;
		text-transform: uppercase;
	}

	.listing-header-description {
		margin: 0.375rem 0 0;
		max-width: 65ch;
		font-size: var(--text-small);
		color: var(--muted-foreground);
		line-height: 1.4;
	}

	@media (min-width: 1024px) {
		.listing-blueprint-header {
			min-height: calc(160px + var(--chrome-offset));
		}

		.listing-header-content {
			grid-template-columns: minmax(0, 1fr) minmax(18rem, 22rem);
			align-content: stretch;
			align-items: end;
			gap: clamp(2rem, 5vw, 5rem);
		}

		/* The giant sticky edge word is the desktop visual title. Keep this h1 in
		   the accessibility tree while suppressing only its duplicate paint. */
		.listing-mobile-heading {
			position: absolute;
			width: 1px;
			height: 1px;
			padding: 0;
			margin: -1px;
			overflow: hidden;
			clip: rect(0, 0, 0, 0);
			white-space: nowrap;
			border: 0;
		}

		.listing-header-subtitle {
			font-size: var(--text-listing-subtitle-desktop);
		}
	}
</style>
