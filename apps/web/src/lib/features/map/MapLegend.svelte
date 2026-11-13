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
<!-- Entries flow in wrapping rows; each status keeps its marker, glyph and label together. -->
<ul class="mf-legend" aria-label={t.legend.title} data-slot="map-legend">
	{#each STATUS_CODES as code (code)}
		<li class="mf-legend-entry" data-legend-entry="status" data-status={code}>
			<span class="mf-legend-mark" style="color:{statusVar(code)}" aria-hidden="true">
				<MarkerGlyph kind="bus" />
			</span>
			<StatusBadge status={code} mode="legend" size="sm" label={STATUS_LABELS[locale][code]} />
		</li>
	{/each}
	<li class="mf-legend-entry mf-legend-explain" data-legend-entry="heading">
		<span class="mf-legend-mark" aria-hidden="true">
			<svg viewBox="0 0 26 26" role="presentation">
				<path d="M13 5 19 13.5 13 10.6 7 13.5Z" fill="currentColor" />
				<circle cx="13" cy="19" r="2.5" fill="currentColor" opacity="0.45" />
			</svg>
		</span>
		<span class="mf-legend-text">{t.legend.heading}</span>
	</li>
	<li class="mf-legend-entry mf-legend-explain" data-legend-entry="stop">
		<span class="mf-legend-mark mf-legend-stop" aria-hidden="true">
			<MarkerGlyph kind="stop" />
		</span>
		<span class="mf-legend-text">{t.legend.stop}</span>
	</li>
	<li class="mf-legend-entry mf-legend-explain" data-legend-entry="not-reporting">
		<span class="mf-legend-mark mf-legend-silent" aria-hidden="true">!</span>
		<span class="mf-legend-text">{t.legend.notReporting}</span>
	</li>
</ul>
<p class="mf-legend-note">{t.legend.zoomBadges}</p>

<style>
	.mf-legend-lead {
		margin: 0 0 0.5rem;
		font-size: var(--text-caption);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.mf-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.125rem 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.mf-legend-entry {
		display: flex;
		flex: none;
		align-items: flex-start;
		gap: 0.25rem;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		line-height: 1.3;
		color: var(--foreground);
	}
	.mf-legend-entry :global([data-slot='status-badge']) {
		gap: 0.1875rem;
		line-height: 1.3;
	}
	.mf-legend-explain {
		flex: 0 1 auto;
		min-width: 0;
	}
	.mf-legend-mark {
		display: inline-grid;
		place-items: center;
		width: 0.75rem;
		height: 0.75rem;
		margin-block: 0.09375rem;
		flex: none;
		color: var(--foreground);
		--marker-glyph-cut: var(--card);
	}
	.mf-legend-mark svg {
		display: block;
		width: 100%;
		height: 100%;
	}
	.mf-legend-silent {
		font-family: var(--font-body);
		font-size: 0.5625rem;
		font-weight: 800;
		line-height: 1;
		color: var(--background);
		background: var(--foreground);
		border-radius: 0.2rem;
	}
	.mf-legend-stop {
		color: var(--map-stop-fill);
	}
	.mf-legend-text {
		min-width: 0;
	}
	.mf-legend-note {
		margin: 0.125rem 0 0;
		font-family: var(--font-body);
		font-size: var(--text-micro);
		line-height: 1.3;
		color: var(--muted-foreground);
	}
</style>
