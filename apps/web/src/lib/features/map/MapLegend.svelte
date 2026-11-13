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
		<li class="mf-legend-entry" data-legend-entry="status" data-status={code}>
			<span class="mf-legend-mark" style="color:{statusVar(code)}" aria-hidden="true">
				<MarkerGlyph kind="bus" />
			</span>
			<StatusBadge status={code} mode="legend" size="sm" label={STATUS_LABELS[locale][code]} />
		</li>
	{/each}
	<li class="mf-legend-entry" data-legend-entry="heading">
		<span class="mf-legend-mark" aria-hidden="true">
			<svg viewBox="0 0 26 26" role="presentation">
				<path d="M13 5 19 13.5 13 10.6 7 13.5Z" fill="currentColor" />
				<circle cx="13" cy="19" r="2.5" fill="currentColor" opacity="0.45" />
			</svg>
		</span>
		<span class="mf-legend-text">{t.legend.heading}</span>
	</li>
	<li class="mf-legend-entry" data-legend-entry="not-reporting">
		<span class="mf-legend-mark mf-legend-silent" aria-hidden="true">!</span>
		<span class="mf-legend-text">{t.legend.notReporting}</span>
	</li>
	<li class="mf-legend-entry" data-legend-entry="stop">
		<span class="mf-legend-mark mf-legend-stop" aria-hidden="true">
			<MarkerGlyph kind="stop" />
		</span>
		<span class="mf-legend-text">{t.legend.stop}</span>
	</li>
</ul>

<style>
	.mf-legend-lead {
		margin: 0 0 0.5rem;
		font-size: var(--text-caption);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.mf-legend {
		display: grid;
		gap: 0.25rem;
		margin: 0;
		padding: 0 0 0.25rem;
		list-style: none;
	}
	.mf-legend-entry {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		min-height: 1.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--foreground);
	}
	.mf-legend-mark {
		display: inline-grid;
		place-items: center;
		width: 1.25rem;
		height: 1.25rem;
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
		width: 1rem;
		height: 1rem;
		margin-inline: 0.125rem;
		font-family: var(--font-sans);
		font-size: var(--text-micro);
		font-weight: 800;
		line-height: 1;
		color: var(--background);
		background: var(--foreground);
		border-radius: 0.3rem;
	}
	.mf-legend-stop {
		color: var(--map-stop-fill);
	}
	.mf-legend-text {
		min-width: 0;
	}
</style>
