<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { absenceShort } from '$lib/site/absence';
	import { fmtPct, fmtCount, fmtDelayMin as sharedFmtDelayMin } from '$lib/utils';
	import { SectionLabel } from '@yesid/ui/brand';
	import CollapsibleSection from './CollapsibleSection.svelte';
	import { AbsentValue } from '$lib/components/edge';
	import { ChartLegend } from '$lib/components/dataviz';
	import { occupancyVar } from '$lib/components/dataviz/tokens';
	import { Chart } from '$lib/components/dataviz/chart';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import {
		CANCEL_RATE_DOMAIN,
		SKIPPED_RATE_DOMAIN,
		SHARE_DOMAIN,
		weekdayLabel,
	} from '$lib/features/reliability/shiftGrains';
	import { OCCUPANCY_CODES, type OccupancyCode } from '$lib/v1/schemas/types';
	import { selectCrowdingDelay } from '../selectors/crowdingDelay';
	import { otpTone, selectBullet } from '../selectors/bullet';
	import { selectOccupancyShare } from '../selectors/occupancyShare';
	import { detailCopy } from '../../lines.copy';
	import type { ServiceDeliveredVM, CrowdingVM } from '../clusters';
	import type { ReliabilityCopy } from '../reliability.copy';
	import Detail from '$lib/components/shared/Detail.svelte';
	import MetricBullet from './MetricBullet.svelte';

	interface Section3RunAndFitProps {
		service: ServiceDeliveredVM;
		crowding: CrowdingVM;
		locale: Locale;
		copy: ReliabilityCopy;
		windowLabel?: string;
		showServiceCompleteness?: boolean;
	}

	let {
		service,
		crowding,
		locale,
		copy,
		windowLabel,
		showServiceCompleteness = false,
	}: Section3RunAndFitProps = $props();

	const pct = (v: number | null): string | null => fmtPct(v, { rounding: 'fixed1' });

	const cancellationRatePct = $derived(service.cancellationRatePct);
	const skippedStopRatePct = $derived(service.skippedStopRatePct);
	const serviceCompletenessPct = $derived(service.serviceCompletenessPct);

	function completeness<T>(
		rows: readonly T[],
		part: (r: T) => number | null | undefined,
		whole: (r: T) => number | null | undefined,
	): { part: number; total: number; sharePct: number } | null {
		let partSum = 0,
			total = 0,
			any = false;
		for (const r of rows) {
			const w = whole(r);
			const p = part(r);
			if (w == null || w <= 0 || p == null || Number.isNaN(p)) continue;
			total += w;
			partSum += p;
			any = true;
		}
		return any && total > 0 ? { part: partSum, total, sharePct: (partSum / total) * 100 } : null;
	}

	const cancellation = $derived(
		completeness(
			service.cancellations,
			(c) => c.canceled_trip_days,
			(c) => c.total_trip_days,
		),
	);
	const skipped = $derived(
		completeness(
			service.skippedStops,
			(s) => s.skipped_stop_count,
			(s) => s.stop_time_update_count,
		),
	);

	const t = $derived(copy.strip);
	const noDataLabel = $derived(absenceShort('no-observations', locale));
	const num = (v: number): string => fmtCount(v, { locale }) ?? `${v}`;

	const bands = $derived(detailCopy[locale].occupancyBands);

	const activeMix = $derived(crowding.mixByGrain ?? crowding.mix);

	const bandLabel = (code: OccupancyCode): string => bands[code];
	const mixTotal = (mix: typeof crowding.mix): number =>
		mix ? OCCUPANCY_CODES.reduce((s, c) => s + ((mix[c] ?? 0) > 0 ? (mix[c] as number) : 0), 0) : 0;

	const mixShareSpec = $derived(
		selectOccupancyShare(activeMix, locale, { title: copy.clusters.crowding, label: bandLabel }),
	);

	const weekdayWeekendCols = $derived.by(() => {
		const ww = crowding.weekdayWeekend;
		if (!ww) return null;
		return {
			weekday: selectOccupancyShare(ww.weekday, locale, {
				title: copy.peak.weekday,
				label: bandLabel,
			}),
			weekend: selectOccupancyShare(ww.weekend, locale, {
				title: copy.peak.weekend,
				label: bandLabel,
			}),
		};
	});

	const weekdayStrips = $derived.by(() => {
		const rows = crowding.byWeekday;
		if (!rows) return null;
		return rows.map((d) => ({
			iso: d.iso,
			label: weekdayLabel(d.iso, locale),
			spec: selectOccupancyShare(d.mix, locale, {
				title: weekdayLabel(d.iso, locale),
				label: bandLabel,
			}),
		}));
	});

	const total = $derived(mixTotal(activeMix));

	const mixLegend = $derived(
		(mixShareSpec?.segments ?? []).map((s) => ({
			colorVar: occupancyVar((s.occupancy ?? 'empty') as OccupancyCode),
			label: `${s.label} ${Math.round(s.share)}%`,
			swatch: 'square' as const,
		})),
	);

	const dominant = $derived.by(() => {
		if (total <= 0) return null;
		let best: { code: OccupancyCode; label: string; share: number } | null = null;
		for (const code of OCCUPANCY_CODES) {
			const v = activeMix ? activeMix[code] : null;
			if (v == null || v <= 0) continue;
			if (best == null || v > best.share) best = { code, label: bands[code], share: v };
		}
		return best;
	});

	const dominantSharePct = $derived(dominant ? (dominant.share / total) * 100 : null);
	const dominantPct = $derived(
		dominantSharePct != null ? `${Math.round(dominantSharePct)}%` : null,
	);

	const cancellationBullet = $derived(
		selectBullet(cancellationRatePct, locale, {
			title: t.cancellationRatePct,
			xLabel: t.cancellationRatePct,
			unit: copy.units.pct,
			domain: CANCEL_RATE_DOMAIN,
			tone: 'warn',
		}),
	);
	const skippedBullet = $derived(
		selectBullet(skippedStopRatePct, locale, {
			title: t.skippedStopRatePct,
			xLabel: t.skippedStopRatePct,
			unit: copy.units.pct,
			domain: SKIPPED_RATE_DOMAIN,
			tone: 'warn',
		}),
	);
	const serviceCompletenessBullet = $derived(
		selectBullet(serviceCompletenessPct, locale, {
			title: t.serviceCompletenessPct,
			xLabel: t.serviceCompletenessPct,
			unit: copy.units.pct,
			domain: SHARE_DOMAIN,
			tone: otpTone(serviceCompletenessPct),
		}),
	);
	const dominantBullet = $derived(
		selectBullet(dominantSharePct, locale, {
			title: dominant?.label ?? copy.clusters.crowding,
			xLabel: dominant?.label ?? copy.clusters.crowding,
			unit: copy.units.pct,
			domain: SHARE_DOMAIN,
			tone: 'neutral',
		}),
	);

	const fmtMin = (v: number | null | undefined): string | null =>
		sharedFmtDelayMin(v, { rounding: 'fixed1' });

	const crowdingDelay = $derived(
		selectCrowdingDelay(crowding.delayByCrowding, locale, {
			title: copy.delayByCrowding.heading,
			rowLabel: copy.delayByCrowding.bandHeader,
			xLabel: copy.strip.avgDelayMin,
			unit: copy.units.min,
			bandLabel: (code) => bands[code],
			noDataMarker: noDataLabel,
			noteFor: (cell) => {
				const p50 = fmtMin(cell.p50_min);
				const n = cell.observation_count ?? null;
				const typical = p50 ? copy.delayByCrowding.typical(p50) : null;
				const nNote = n != null ? `n=${n}` : null;
				return [typical, nNote].filter(Boolean).join(' · ') || undefined;
			},
		}),
	);

	const sectionEmpty = $derived(service.isEmpty && dominant == null);
</script>

{#snippet serviceComparisonInfo()}<MetricInfo
		class="cluster-info"
		metricKey="serviceComparison"
		{locale}
		name={t.serviceCompletenessPct}
		side="bottom"
	/>{/snippet}
{#snippet cancellationInfo()}<MetricInfo
		class="cluster-info"
		metricKey="cancellation"
		{locale}
		name={t.cancellationRatePct}
		side="bottom"
	/>{/snippet}
{#snippet skippedInfo()}<MetricInfo
		class="cluster-info"
		metricKey="skippedStop"
		{locale}
		name={t.skippedStopRatePct}
		side="bottom"
	/>{/snippet}
{#snippet dominantBandInfo()}
	<MetricInfo
		class="cluster-info"
		metricKey="occupancy"
		{locale}
		name={dominant?.label ?? copy.clusters.crowding}
		side="bottom"
	/>
{/snippet}

<CollapsibleSection
	dataSection="run-and-fit"
	number={4}
	eyebrow={copy.sections.runAndFit.label}
	question={copy.sections.runAndFit.question}
>
	{#if sectionEmpty}
		<div data-slot="run-and-fit-empty">
			<AbsentValue variant="block" reason="no-observations" {locale} />
		</div>
	{:else}
		<div class="sub-block" data-slot="run-sub-block" data-card>
			<div class="sub-head">
				<SectionLabel text={copy.clusters.serviceDelivered} variant="metric" />
				<p class="sub-window" data-slot="service-window">{windowLabel ?? copy.windows.trend}</p>
				<p class="sub-rampin" data-slot="ramp-in-note">{t.rampInNote}</p>
			</div>

			{#if service.isEmpty}
				<div data-slot="service-empty-note">
					<AbsentValue variant="block" reason="no-observations" {locale} />
				</div>
			{:else}
				<div class="run-metrics">
					{#if showServiceCompleteness}
						<MetricBullet
							label={t.serviceCompletenessPct}
							valueText={pct(serviceCompletenessPct)}
							spec={serviceCompletenessBullet}
							info={serviceComparisonInfo}
							{locale}
							caption={service.scheduledService
								? t.serviceCompletenessFraction(
										num(service.scheduledService.delivered),
										num(service.scheduledService.scheduled),
										service.scheduledService.silent == null
											? null
											: num(service.scheduledService.silent),
									)
								: undefined}
							data-slot="service-completeness"
						/>
					{/if}

					<MetricBullet
						label={t.cancellationRatePct}
						valueText={pct(cancellationRatePct)}
						spec={cancellationBullet}
						{locale}
						info={cancellationInfo}
						caption={cancellation
							? t.cancellationFraction(num(cancellation.part), num(cancellation.total))
							: undefined}
						data-slot="cancellations"
					/>

					<MetricBullet
						label={t.skippedStopRatePct}
						valueText={pct(skippedStopRatePct)}
						spec={skippedBullet}
						{locale}
						info={skippedInfo}
						caption={skipped ? t.skippedFraction(num(skipped.part), num(skipped.total)) : undefined}
						data-slot="skipped-stops"
					/>
				</div>
			{/if}
		</div>

		<div class="sub-block" data-slot="fit-sub-block" data-card>
			<div class="sub-head">
				<span class="label-with-info">
					<SectionLabel
						id="run-and-fit-crowding-label"
						text={copy.clusters.crowding}
						variant="metric"
					/>
					<MetricInfo
						class="cluster-info"
						metricKey="occupancy"
						{locale}
						name={copy.clusters.crowding}
						side="bottom"
					/>
				</span>
				<p class="sub-window" data-slot="crowding-window">
					{windowLabel ?? copy.windows.crowding}
				</p>
			</div>

			{#if dominant == null}
				<div data-slot="crowding-empty">
					<AbsentValue variant="block" reason="no-observations" {locale} />
				</div>
			{:else}
				<MetricBullet
					label={dominant.label}
					valueText={dominantPct}
					spec={dominantBullet}
					{locale}
					size="lg"
					info={dominantBandInfo}
					data-slot="dominant-band"
				/>
				{#if mixShareSpec}
					<div class="crowding-bar" data-slot="crowding-mix">
						<Chart spec={mixShareSpec} />
						<ChartLegend items={mixLegend} />
					</div>
				{/if}
			{/if}
		</div>

		<Detail label={copy.sections.detailShow} labelOpen={copy.sections.detailHide}>
			<div class="crowding-delay" data-slot="delay-by-crowding" data-card>
				<SectionLabel text={copy.delayByCrowding.heading} variant="metric" />
				<Chart spec={crowdingDelay.spec} />
			</div>

			{#if weekdayWeekendCols}
				<div class="crowding-2col" data-slot="crowding-weekday-weekend" data-card>
					<SectionLabel text={copy.peak.dayType} variant="metric" />
					<div class="crowding-2col-grid">
						<div class="crowding-2col-cell" data-slot="crowding-weekday">
							<span class="crowding-2col-label">{copy.peak.weekday}</span>
							{#if weekdayWeekendCols.weekday}
								<Chart spec={weekdayWeekendCols.weekday} />
							{:else}
								<AbsentValue variant="block" reason="no-observations" {locale} />
							{/if}
						</div>
						<div class="crowding-2col-cell" data-slot="crowding-weekend">
							<span class="crowding-2col-label">{copy.peak.weekend}</span>
							{#if weekdayWeekendCols.weekend}
								<Chart spec={weekdayWeekendCols.weekend} />
							{:else}
								<AbsentValue variant="block" reason="no-observations" {locale} />
							{/if}
						</div>
					</div>
				</div>
			{/if}

			{#if weekdayStrips}
				<div class="crowding-dow" data-slot="crowding-by-dow" data-card>
					<SectionLabel text={copy.byDow.heading} variant="metric" />
					<p class="crowding-dow-caption">{copy.byDow.caption}</p>
					<ul class="crowding-dow-grid" aria-label={copy.byDow.heading}>
						{#each weekdayStrips as day (day.iso)}
							<li class="crowding-dow-cell" data-slot="crowding-dow-cell" data-iso={day.iso}>
								<span class="crowding-dow-label">{day.label}</span>
								{#if day.spec}
									<Chart spec={day.spec} />
								{:else}
									<AbsentValue variant="block" reason="no-observations" {locale} />
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</Detail>
	{/if}
</CollapsibleSection>

<style>
	.sub-block {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.sub-head {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.sub-rampin {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.sub-window {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}

	.run-metrics {
		display: grid;
		gap: var(--space-card-gap);
		grid-template-columns: repeat(auto-fit, minmax(min(13rem, 100%), 1fr));
	}

	.crowding-delay {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.crowding-2col {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}
	.crowding-2col-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(14rem, 100%), 1fr));
		gap: 1rem 1.5rem;
	}
	.crowding-2col-cell {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		min-width: 0;
	}
	.crowding-2col-label {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}

	.crowding-dow {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}
	.crowding-dow-caption {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.crowding-dow-grid {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.crowding-dow-cell {
		display: grid;
		grid-template-columns: 6.5rem 1fr;
		align-items: center;
		gap: 0.875rem;
		min-width: 0;
	}
	.crowding-dow-label {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
		white-space: nowrap;
	}
</style>
