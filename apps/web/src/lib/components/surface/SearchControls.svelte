<!--
  SearchControls — the ONE search control surface, mounted twice (M6i · F25/F26).

  It carries two things that belong together and were previously stranded apart:

    1. the DATA-COLLECTION DISCLOSURE. On the chrome it used to be an absolutely
       positioned line pinned by `white-space: nowrap`, which painted straight
       over the nav pill; on the search page — the ONLY search a phone ever sees,
       since the in-pill field is desktop-only — it did not exist at all.
    2. the search page's FILTERS: the entity-family SCOPE segmented control and
       the combinable transit-MODE chips. They were locked inside SearchSurface;
       the chrome dropdown had no way to reach them.

  Two live mounts, one implementation:
    · `variant="panel"` — inside the NavPill's focus dropdown, which anchors BELOW
      the pill instead of on it.
    · `variant="page"`  — under the search surface's own field.

  The component is COPY-FREE except for the locale-invariant transit-mode proper
  nouns (Métro / Tram / Bus / Train / Ferry), which come from the single
  `TRANSIT_MODE_FILTERS` vocabulary so a chip can never drift from the tag a
  matching row wears. Every other string is passed in by its surface.

  DOCTRINE: tokens, no hex; --primary interactive-only (the "on" chip + focus
  ring); the disclosure is a QUIET muted-mono line, never a warning banner.
-->
<script module lang="ts">
	/** Result family the scope control restricts to; `all` = every family. */
	export type SearchScopeKey = 'all' | 'route' | 'stop' | 'vehicle';
</script>

<script lang="ts">
	import { cn } from '$lib/utils';
	import type { SvelteSet } from 'svelte/reactivity';
	import { TRANSIT_MODE_FILTERS, type TransitModeKey } from '$lib/search/stopMode';
	import GrainPicker, { type GrainSegment } from './GrainPicker.svelte';

	interface SearchControlsProps {
		/**
		 * The data-collection disclosure for THIS surface, or null where the
		 * surface transmits nothing (a scoped catalogue never fires the geocode).
		 */
		notice?: string | null;
		/**
		 * true → the visible disclosure is decorative because an always-present
		 * sr-only twin elsewhere owns the `aria-describedby` relationship. Keeps
		 * the chrome from announcing the same sentence twice.
		 */
		noticeDecorative?: boolean;
		/** Render the filter row. false → the disclosure stands alone. */
		filters?: boolean;
		scopeLabel: string;
		scopeSegments: readonly GrainSegment<SearchScopeKey>[];
		scope?: SearchScopeKey;
		modeLabel: string;
		/** Reactive, mutated in place — the caller keeps the set, this toggles it. */
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

	// Both mounts can be on screen at once (the search page renders under the
	// chrome), so the mode group's label association must be per-instance.
	const uid = $props.id();
	const modeLabelId = `${uid}-mode`;

	function toggleMode(mode: TransitModeKey): void {
		if (modes.has(mode)) modes.delete(mode);
		else modes.add(mode);
	}
</script>

<!-- Nothing to disclose and nothing to filter = no surface. The panel variant
     wears a card, so an always-rendered empty root would paint a blank glass box
     in the chrome dropdown on the scoped catalogues. -->
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
							<button
								type="button"
								class="search-mode-chip"
								data-on={modes.has(chip.key)}
								aria-pressed={modes.has(chip.key)}
								onclick={() => toggleMode(chip.key)}
							>
								{chip.tag}
							</button>
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

	/* The disclosure — quiet by construction: muted mono, no warning colour, no
	   icon, no border on the panel (the dropdown card is already the container).
	   It WRAPS: the chrome copy is ~448px at one line, and pinning that width with
	   `nowrap` is exactly what used to paint it across the nav pill. */
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

	/* Combinable mode chips — the map's facet toggle pattern: a tinted "on" state,
	   --primary as the interaction accent (never a data mark). */
	.search-mode-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.search-mode-chip {
		appearance: none;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.2;
		padding: 0.375rem 0.75rem;
		color: var(--muted-foreground);
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		cursor: pointer;
		transition:
			color var(--duration-fast) var(--ease-default),
			background-color var(--duration-fast) var(--ease-default),
			border-color var(--duration-fast) var(--ease-default);
	}

	.search-mode-chip:hover {
		color: var(--foreground);
		border-color: color-mix(in srgb, var(--primary) 45%, var(--border) 55%);
	}

	.search-mode-chip[data-on='true'] {
		color: var(--primary-foreground);
		background: var(--primary);
		border-color: var(--primary);
	}

	.search-mode-chip:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}

	/* PAGE — under the surface's own field. The disclosure sits in normal flow and
	   is measure-capped; the FILTER row keeps the shipped desktop sticky so the
	   controls stay in reach while results scroll (the single --chrome-offset knob
	   clears the floating pill). Mobile drops the sticky — a sticky control bar
	   would eat scarce phone viewport. */
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

	@media (min-width: 1024px) {
		.search-controls[data-variant='page'] .search-controls__filters {
			position: sticky;
			top: var(--chrome-offset);
			z-index: var(--z-rail);
			background: color-mix(in srgb, var(--background) 92%, transparent);
			backdrop-filter: blur(16px) saturate(1.1);
			padding-block: 0.5rem;
		}
	}

	/* PANEL — the top card of the NavPill's focus dropdown. Same chassis as the
	   result list below it (96% background mix, brand hairline, --shadow-nav,
	   blur16), so the dropdown reads as one surface in two stacked cards. */
	.search-controls[data-variant='panel'] {
		gap: 0.5rem;
		padding: 0.5rem 0.625rem;
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--background) 96%, transparent);
		border: 1px solid var(--border-brand);
		box-shadow: var(--shadow-nav);
		backdrop-filter: blur(16px) saturate(1.1);
		-webkit-backdrop-filter: blur(16px) saturate(1.1);
	}

	.search-controls[data-variant='panel'] .search-controls__filters {
		gap: 0.5rem 1.25rem;
	}

	.search-controls[data-variant='panel'] .search-controls__notice + .search-controls__filters {
		padding-top: 0.5rem;
		border-top: 1px solid var(--border-subtle);
	}

	@media (prefers-reduced-motion: reduce) {
		.search-mode-chip {
			transition: none;
		}
	}
</style>
