<script lang="ts">
	import { STATUS_GLYPH, statusVar } from '#lib/components/dataviz/tokens.ts';
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
			<span class="mf-legend-text" data-slot="map-legend-label"
				>{STATUS_LABELS[locale][code]}<span
					class="mf-legend-glyph"
					style="color:{statusVar(code)}"
					aria-hidden="true">{STATUS_GLYPH[code]}</span
				></span
			>
		</li>
	{/each}
	<li class="mf-legend-entry" data-legend-group="symbols" data-legend-entry="heading">
		<span class="mf-legend-mark" aria-hidden="true">
			<svg viewBox="0 0 26 26" role="presentation">
				<path d="M13 5 19 13.5 13 10.6 7 13.5Z" fill="currentColor" />
				<circle cx="13" cy="19" r="2.5" fill="currentColor" opacity="0.45" />
			</svg>
		</span>
		<span class="mf-legend-text" data-slot="map-legend-label">{t.legend.heading}</span>
	</li>
	<li class="mf-legend-entry" data-legend-group="symbols" data-legend-entry="stop">
		<span class="mf-legend-mark mf-legend-stop" aria-hidden="true">
			<MarkerGlyph kind="stop" />
		</span>
		<span class="mf-legend-text" data-slot="map-legend-label">{t.legend.stop}</span>
	</li>
	<li class="mf-legend-entry" data-legend-group="symbols" data-legend-entry="not-reporting">
		<span class="mf-legend-mark mf-legend-silent" aria-hidden="true">!</span>
		<span class="mf-legend-text" data-slot="map-legend-label">{t.legend.notReporting}</span>
	</li>
</ul>
<p class="mf-legend-note">{t.legend.zoomBadges}</p>

<style>
	.mf-legend-lead {
		margin: 0 0 calc(var(--spacing) * 3);
		font-size: var(--text-caption);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.mf-legend {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.mf-legend-entry {
		display: grid;
		grid-template-columns: calc(var(--spacing) * 5) minmax(0, 1fr);
		align-items: center;
		gap: calc(var(--spacing) * 2);
		min-height: calc(var(--spacing) * 7);
		padding-block: var(--spacing);
		font-family: var(--font-body);
		font-size: var(--text-caption);
		line-height: 1.4;
		color: var(--foreground);
	}
	.mf-legend-entry[data-legend-entry='heading'] {
		margin-top: calc(var(--spacing) * 2);
		padding-top: calc(var(--spacing) * 2);
		border-top: 1px solid var(--border-hairline);
	}
	.mf-legend-mark {
		display: inline-grid;
		place-items: center;
		justify-self: center;
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
	[data-legend-group='status'] .mf-legend-text {
		display: grid;
		grid-template-columns: minmax(0, 1fr) calc(var(--spacing) * 4);
	}
	.mf-legend-glyph {
		text-align: center;
	}
	.mf-legend-note {
		margin: calc(var(--spacing) * 3) 0 0;
		font-family: var(--font-body);
		font-size: var(--text-micro);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
</style>
