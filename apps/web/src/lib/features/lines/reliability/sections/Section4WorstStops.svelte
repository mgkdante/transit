<script lang="ts">
	import { localizeHref, type Locale } from '$lib/i18n';
	import { SectionLabel } from '@yesid/ui/brand';
	import CollapsibleSection from './CollapsibleSection.svelte';
	import { AbsentValue } from '$lib/components/edge';
	import { Chart } from '$lib/components/dataviz/chart';
	import { GrainPicker, type GrainSegment } from '$lib/components/surface';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { selectWeakStops } from '../selectors/weakStops';
	import type { PunctualityVM } from '../clusters';
	import type { ReliabilityCopy } from '../reliability.copy';

	interface Section4WorstStopsProps {
		punctuality: PunctualityVM;
		locale: Locale;
		copy: ReliabilityCopy;
	}
	let { punctuality, locale, copy }: Section4WorstStopsProps = $props();

	const WORST_N_SEGMENTS = $derived<GrainSegment<string>[]>([
		{ key: '5', label: '5' },
		{ key: '10', label: '10' },
		{ key: '15', label: copy.strip.worstNAll },
	]);
	let worstN = $state('10');
	const worstNCount = $derived(Number(worstN));

	const weakStopNote = (w: {
		severe_pct?: number | null;
		avg_delay_min?: number | null;
		observation_count?: number | null;
	}): string => {
		const n = copy.strip.weakStopNote;
		const parts: string[] = [];
		if (w.severe_pct != null)
			parts.push(`${n.severe} ${Math.round(w.severe_pct)}${copy.units.pct}`);
		if (w.avg_delay_min != null)
			parts.push(`${n.avg} ${Math.round(w.avg_delay_min * 10) / 10}${copy.units.min}`);
		if (w.observation_count != null) parts.push(`${n.samples}=${w.observation_count}`);
		return parts.join(' · ');
	};

	const weakStops = $derived(
		selectWeakStops(
			punctuality.weakStops,
			worstNCount,
			locale,
			{
				title: copy.strip.weakStopsHeading,
				rowLabel: copy.strip.worstNLabel,
				xLabel: copy.strip.avgDelayMin,
				unit: copy.units.min,
				severeXLabel: copy.strip.severeRateLabel,
				severeUnit: copy.units.pct,
				note: weakStopNote,
				ciLabel: copy.strip.weakStopCi,
				stopHref: (id) => localizeHref(`/stop/${id}`, locale),
			},
			{ preRanked: punctuality.weakStopsWindowed },
		),
	);
	const weakStopsHeading = $derived(
		weakStops.total > weakStops.shown
			? `${copy.strip.weakStopsHeading} · ${weakStops.shown}/${weakStops.total}`
			: `${copy.strip.weakStopsHeading} · ${weakStops.shown}`,
	);
</script>

<CollapsibleSection
	dataSection="worst-stops"
	number={5}
	eyebrow={copy.sections.worstStops.label}
	question={copy.sections.worstStops.question}
>
	{#if weakStops.shown > 0}
		<div class="section-primary" data-slot="weak-stops" data-card="primary">
			<div class="weak-stops-head">
				<span class="label-with-info">
					<SectionLabel text={weakStopsHeading} variant="metric" />
					<MetricInfo
						class="cluster-info"
						metricKey="weakStops"
						{locale}
						name={copy.strip.weakStopsHeading}
						side="bottom"
					/>
				</span>
				{#if weakStops.total > 5}
					<GrainPicker
						segments={WORST_N_SEGMENTS}
						bind:value={worstN}
						label={copy.strip.worstNLabel}
					/>
				{/if}
			</div>
			<p class="caption" data-slot="weak-stops-window">{copy.windows.weakStops}</p>
			<div data-slot="weak-stops-list">
				<Chart spec={weakStops.spec} />
			</div>
		</div>
	{:else}
		<div data-slot="worst-stops-empty">
			<AbsentValue variant="block" reason="no-observations" {locale} />
		</div>
	{/if}
</CollapsibleSection>

<style>
	.section-primary {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}
	.weak-stops-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1rem;
	}
	.label-with-info {
		min-width: 0;
	}
	.caption {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
</style>
