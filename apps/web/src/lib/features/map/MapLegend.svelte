<script lang="ts">
	import StatusBadge from '#lib/components/dataviz/StatusBadge.svelte';
	import { statusVar } from '#lib/components/dataviz/tokens.ts';
	import type { Locale } from '#lib/i18n/index.ts';
	import { STATUS_LABELS } from '#lib/v1/enumLabels.ts';
	import { STATUS_CODES } from '#lib/v1/schemas/types.ts';
	import MarkerGlyph from './MarkerGlyph.svelte';
	import { copy } from './map.copy';

	interface Props {
		locale: Locale;
		/** Repeats the sentence under the map title where the title block has no room for it. */
		lead?: boolean;
	}

	let { locale, lead = false }: Props = $props();
	const t = $derived(copy[locale]);
</script>

{#if lead}<p class="mf-legend-lead" data-slot="map-legend-lead">{t.headingLead}</p>{/if}

<ul class="mf-legend" aria-label={t.legend.title} data-slot="map-legend">
	{#each STATUS_CODES as code (code)}
		<li
			class="mf-legend-entry"
			data-legend-group="status"
			data-legend-entry="status"
			data-status={code}
		>
			<span class="mf-legend-mark" style="color:{statusVar(code)}" aria-hidden="true">
				<MarkerGlyph kind="bus" />
			</span>
			<StatusBadge status={code} mode="legend" size="md" label={STATUS_LABELS[locale][code]} />
		</li>
	{/each}
	<li class="mf-legend-entry" data-legend-group="symbols" data-legend-entry="heading">
		<span class="mf-legend-mark" aria-hidden="true">
			<svg viewBox="0 0 26 26" role="presentation">
				<path d="M13 5 19 13.5 13 10.6 7 13.5Z" fill="currentColor" />
				<circle cx="13" cy="19" r="2.5" fill="currentColor" opacity="0.45" />
			</svg>
		</span>
		<span class="mf-legend-text">{t.legend.heading}</span>
	</li>
	<li class="mf-legend-entry" data-legend-group="symbols" data-legend-entry="stop">
		<span class="mf-legend-mark mf-legend-stop" aria-hidden="true">
			<MarkerGlyph kind="stop" />
		</span>
		<span class="mf-legend-text">{t.legend.stop}</span>
	</li>
	<li class="mf-legend-entry" data-legend-group="symbols" data-legend-entry="not-reporting">
		<span class="mf-legend-mark mf-legend-silent" aria-hidden="true">!</span>
		<span class="mf-legend-text">{t.legend.notReporting}</span>
	</li>
</ul>
<p class="mf-legend-note">{t.legend.zoomBadges}</p>

<style>
	.mf-legend-lead {
		margin: 0 0 calc(var(--spacing) * 2);
		font-size: var(--text-caption);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.mf-legend {
		margin: 0;
		padding: 0;
		list-style: none;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0 calc(var(--spacing) * 2);
	}
	.mf-legend-entry[data-legend-group='symbols']:not([data-legend-entry='not-reporting']) {
		margin-top: calc(var(--spacing) / 2);
		padding-top: calc(var(--spacing) / 2);
		border-top: 1px solid var(--border);
	}
	.mf-legend-entry {
		display: grid;
		grid-template-columns: calc(var(--spacing) * 8) minmax(0, 1fr);
		align-items: center;
		gap: var(--spacing);
		min-width: 0;
		font-family: var(--font-body);
		font-size: var(--text-caption);
		line-height: 1.25;
		color: var(--foreground);
	}
	.mf-legend-entry :global([data-slot='status-badge']) {
		display: contents;
		line-height: inherit;
	}
	.mf-legend-entry :global([data-slot='status-badge'] > span:first-child) {
		grid-column: 1;
		grid-row: 1;
		justify-self: end;
	}
	.mf-legend-entry :global([data-slot='status-badge'] > span:last-child) {
		grid-column: 2;
		grid-row: 1;
		font-family: var(--font-body);
	}
	.mf-legend-entry[data-legend-entry='not-reporting'] {
		grid-column: 1 / -1;
	}
	.mf-legend-entry[data-legend-entry='heading'] {
		grid-column-start: 1;
	}
	.mf-legend-mark {
		grid-column: 1;
		grid-row: 1;
		display: inline-grid;
		place-items: center;
		width: calc(var(--spacing) * 4);
		height: calc(var(--spacing) * 4);
		color: var(--foreground);
		--marker-glyph-cut: var(--card);
	}
	.mf-legend-mark svg {
		display: block;
		width: 100%;
		height: 100%;
	}
	.mf-legend-silent {
		font-weight: 800;
		line-height: 1;
		color: var(--background);
		background: var(--foreground);
		border-radius: var(--radius-sm);
	}
	.mf-legend-stop {
		color: var(--map-stop-fill);
	}
	.mf-legend-text {
		min-width: 0;
	}
	.mf-legend-note {
		margin: calc(var(--spacing) / 2) 0 0;
		font-family: var(--font-body);
		font-size: var(--text-micro);
		line-height: 1.25;
		color: var(--muted-foreground);
	}
</style>
