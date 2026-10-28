<script module lang="ts">
	export type SearchScopeKey = 'all' | 'route' | 'stop' | 'vehicle';
</script>

<script lang="ts">
	import { ToggleChip } from '@yesid/ui/brand';
	import { cn } from '$lib/utils';
	import type { SvelteSet } from 'svelte/reactivity';
	import { TRANSIT_MODE_FILTERS, type TransitModeKey } from '$lib/search/stopMode';
	import GrainPicker, { type GrainSegment } from './GrainPicker.svelte';

	interface SearchControlsProps {
		notice?: string | null;
		noticeDecorative?: boolean;
		filters?: boolean;
		scopeLabel: string;
		scopeSegments: readonly GrainSegment<SearchScopeKey>[];
		scope?: SearchScopeKey;
		modeLabel: string;
		modes: SvelteSet<TransitModeKey>;
		variant?: 'page' | 'panel';
		class?: string;
	}

	let {
		notice = null,
		noticeDecorative = false,
		filters = false,
		scopeLabel,
		scopeSegments,
		scope = $bindable('all'),
		modeLabel,
		modes,
		variant = 'page',
		class: className,
	}: SearchControlsProps = $props();

	const uid = $props.id();
	const modeLabelId = `${uid}-mode`;

	function toggleMode(mode: TransitModeKey): void {
		if (modes.has(mode)) modes.delete(mode);
		else modes.add(mode);
	}
</script>

{#if notice || filters}
	<div class={cn('search-controls', className)} data-variant={variant} data-slot="search-controls">
		{#if notice}
			<p
				class="search-controls__notice"
				data-slot="search-notice"
				aria-hidden={noticeDecorative ? 'true' : undefined}
			>
				{notice}
			</p>
		{/if}

		{#if filters}
			<div class="search-controls__filters" data-slot="search-filters">
				<div class="search-control">
					<span class="search-control__label">{scopeLabel}</span>
					<GrainPicker segments={scopeSegments} bind:value={scope} label={scopeLabel} />
				</div>
				<div class="search-control">
					<span class="search-control__label" id={modeLabelId}>{modeLabel}</span>
					<div class="search-mode-chips" role="group" aria-labelledby={modeLabelId}>
						{#each TRANSIT_MODE_FILTERS as chip (chip.key)}
							<ToggleChip pressed={modes.has(chip.key)} onclick={() => toggleMode(chip.key)}>
								{chip.tag}
							</ToggleChip>
						{/each}
					</div>
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	.search-controls {
		display: grid;
		gap: 0.625rem;
		min-width: 0;
	}

	.search-controls__notice {
		margin: 0;
		min-width: 0;
		color: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		line-height: 1.45;
		text-wrap: pretty;
	}

	.search-controls__filters {
		display: flex;
		flex-wrap: wrap;
		gap: 1.25rem 2rem;
		min-width: 0;
	}

	.search-control {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		min-width: 0;
	}

	.search-control__label {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 600;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}

	.search-mode-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.search-controls[data-variant='page'] {
		margin-top: 0.875rem;
	}

	.search-controls[data-variant='page'] .search-controls__notice {
		max-width: var(--measure-notice);
		padding: 0.5rem 0.75rem;
		background: color-mix(in srgb, var(--muted) 55%, transparent);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-sm);
	}

	@media (--desktop-min) {
		.search-controls[data-variant='page'] .search-controls__filters {
			position: sticky;
			top: var(--chrome-offset);
			z-index: var(--z-rail);
			background: color-mix(in srgb, var(--background) 92%, transparent);
			backdrop-filter: blur(var(--glass-blur));
			padding-block: 0.5rem;
		}
	}

	.search-controls[data-variant='panel'] {
		gap: 0.5rem;
		padding: 0.5rem 0.625rem;
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--background) 96%, transparent);
		border: 1px solid var(--border-brand);
		box-shadow: var(--shadow-nav);
		-webkit-backdrop-filter: blur(var(--glass-blur));
		backdrop-filter: blur(var(--glass-blur));
	}

	.search-controls[data-variant='panel'] .search-controls__filters {
		gap: 0.5rem 1.25rem;
	}

	.search-controls[data-variant='panel'] .search-controls__notice + .search-controls__filters {
		padding-top: 0.5rem;
		border-top: 1px solid var(--border-subtle);
	}
</style>
