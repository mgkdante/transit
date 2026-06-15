<!--
  MapFilters — the combinable state filter for the live map (slice-9.3).

  This IS the colour legend AND the filter: status + crowding chips, each a
  COLOUR swatch + label (no shape glyph — shape is the entity key's job, colour
  is state). Toggling a chip REPAINTS the matching buses in that state's colour
  and HIDES the rest; status × crowding combine (AND). All state lives in the
  URL via the shared filter store, so a filtered view is shareable +
  deep-linkable from anywhere (`/map?status=late`).

  DOCTRINE: chips show the dataviz state colour (status/occupancy scales);
  --primary stays interactive-only (the active-chip ring/affordance).
-->
<script lang="ts">
	import type { FilterStore } from '$lib/filters';
	import { STATUS_CODES, OCCUPANCY_CODES } from '$lib/v1';
	import { statusVar, occupancyVar } from '$lib/components/dataviz';
	import type { Locale } from '$lib/i18n';
	import { copy as MAP_COPY, STATUS_LABELS, OCCUPANCY_LABELS } from './map.copy';

	interface Props {
		store: FilterStore;
		locale: Locale;
	}
	let { store, locale }: Props = $props();
	const t = $derived(MAP_COPY[locale]);
</script>

<div class="map-filters" role="group" aria-label={t.filterTitle}>
	<div class="mf-head">
		<span class="mf-title">{t.filterTitle}</span>
		{#if !store.isEmpty}
			<button type="button" class="mf-clear" onclick={() => store.clear()}>{t.filterClear}</button>
		{/if}
	</div>

	<div class="mf-group">
		<span class="mf-group-label">{t.modeStatus}</span>
		<div class="mf-chips">
			{#each STATUS_CODES as code (code)}
				<button
					type="button"
					class="mf-chip"
					data-on={store.status.includes(code)}
					aria-pressed={store.status.includes(code)}
					style="--chip:{statusVar(code)}"
					onclick={() => store.toggleStatus(code)}
				>
					<span class="mf-swatch"></span>{STATUS_LABELS[locale][code]}
				</button>
			{/each}
		</div>
	</div>

	<div class="mf-group">
		<span class="mf-group-label">{t.modeOccupancy}</span>
		<div class="mf-chips">
			{#each OCCUPANCY_CODES as code (code)}
				<button
					type="button"
					class="mf-chip"
					data-on={store.occupancy.includes(code)}
					aria-pressed={store.occupancy.includes(code)}
					style="--chip:{occupancyVar(code)}"
					onclick={() => store.toggleOccupancy(code)}
				>
					<span class="mf-swatch"></span>{OCCUPANCY_LABELS[locale][code]}
				</button>
			{/each}
		</div>
	</div>
</div>

<style>
	.map-filters {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		width: 13.5rem;
		max-width: calc(100vw - 2rem);
		padding: 0.8rem 0.85rem;
		background: color-mix(in srgb, var(--card) 90%, transparent);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
		backdrop-filter: blur(8px);
	}
	.mf-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.mf-title {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.mf-clear {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		color: var(--primary);
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
	}
	.mf-clear:hover {
		text-decoration: underline;
	}
	.mf-group {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.mf-group-label {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		color: var(--accent-text);
	}
	.mf-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.mf-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		padding: 0.2rem 0.45rem;
		color: var(--muted-foreground);
		background: var(--muted);
		border: 1px solid var(--border-subtle);
		border-radius: 999px;
		cursor: pointer;
		transition:
			color 120ms ease,
			border-color 120ms ease,
			background-color 120ms ease;
	}
	.mf-chip:hover {
		color: var(--foreground);
		border-color: var(--border);
	}
	.mf-chip:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
	}
	/* Active: the chip adopts its state colour (tinted bg + coloured border + text). */
	.mf-chip[data-on='true'] {
		color: var(--foreground);
		background: color-mix(in srgb, var(--chip) 22%, transparent);
		border-color: var(--chip);
	}
	/* Colour swatch only — the chip's state is its hue, never a shape. */
	.mf-swatch {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
		background: var(--chip);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--chip) 55%, transparent);
		flex: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.mf-chip {
			transition: none;
		}
	}
</style>
