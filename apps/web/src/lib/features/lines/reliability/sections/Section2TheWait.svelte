<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { absenceShort } from '$lib/site/absence';
	import { fmtCount, fmtDelayMin, fmtPct } from '$lib/utils';
	import type { HeadwayPeriod, SeverityCode, ServiceSpanPeriod } from '$lib/v1';
	import { Chart } from '$lib/components/dataviz/chart';
	import { DeltaStat } from '$lib/components/dataviz';
	import DataTable, { type DataTableColumn } from '$lib/components/data/DataTable.svelte';
	import { priorDelta } from '../selectors/priorDelta';
	import { selectHeadwayDumbbell } from '../selectors/headwayDumbbell';
	import { selectShiftBars } from '../selectors/shiftBars';
	import { selectDirectionAsymmetry } from '../selectors/directionAsymmetry';
	import { selectBullet } from '../selectors/bullet';
	import { selectServiceSpan } from '../selectors/serviceSpan';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import MetricBullet from './MetricBullet.svelte';
	import { SectionLabel } from '@yesid/ui/brand';
	import CollapsibleSection from './CollapsibleSection.svelte';
	import { AbsentValue } from '$lib/components/edge';
	import Detail from '$lib/components/shared/Detail.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { WaitRegularityVM } from '../clusters';
	import type { ReliabilityCopy } from '../reliability.copy';
	import {
		shiftLabel as baseShiftLabel,
		bunchingToSeverity,
		covToSeverity,
		HEADWAY_DOMAIN,
		COV_DOMAIN,
		BUNCHED_DOMAIN,
	} from '$lib/features/reliability/shiftGrains';

	interface Section2TheWaitProps {
		wait: WaitRegularityVM;
		serviceSpans?: ServiceSpanPeriod[];
		locale: Locale;
		copy: ReliabilityCopy;
		directionHeadsigns?: Record<number, string>;
		mode?: 'day' | 'week' | 'month' | 'range';
	}

	let {
		wait,
		serviceSpans = [],
		locale,
		copy,
		directionHeadsigns = {},
		mode = 'day',
	}: Section2TheWaitProps = $props();

	const win = $derived<'day' | 'week' | 'month'>(
		mode === 'week' || mode === 'month' ? mode : 'day',
	);

	interface BandCopy {
		readonly headwaySection: string;
		readonly spanSection: string;
		readonly serviceSpan: string;
		readonly firstTripDelay: string;
		readonly lastTripDelay: string;
		readonly tripCount: string;
		readonly moreDetail: string;
		readonly directionGap: string;
		readonly directionShiftCol: string;
		readonly directionCol: (n: number) => string;
		readonly weekendSuffix: string;
		readonly shiftMean: string;
		readonly priorDirectionNote: string;
		readonly excessWaitExplain: string;
		readonly excessWaitProxyExplain: string;
		readonly headwayAxis: string;
		readonly directionAsymmetryLabel: string;
		readonly directionAsymmetry: (
			shift: string,
			slowerDir: string,
			slowerVal: string,
			fasterDir: string,
			fasterVal: string,
		) => string;
	}

	const BAND_COPY: Record<Locale, BandCopy> = {
		fr: {
			headwaySection: 'Attente par période',
			spanSection: 'Premières apparitions de trajets',
			serviceSpan: 'Écart entre premières captures',
			firstTripDelay: 'Premier trajet : retard du premier relevé',
			lastTripDelay: 'Dernier trajet : retard du dernier relevé',
			tripCount: 'Identifiants de trajet observés',
			moreDetail: 'Plus de détail · intervalle observé par direction',
			directionGap: 'Intervalle observé par direction',
			directionShiftCol: 'Période',
			directionCol: (n) => `Direction ${n}`,
			weekendSuffix: 'fin de sem.',
			shiftMean: 'moyenne des périodes rapportées',
			priorDirectionNote: 'La direction la plus achalandée peut changer entre les fenêtres.',
			excessWaitExplain:
				"Chaque période rapportée a le même poids. Le modèle suppose des arrivées uniformes et estime le surplus au-delà de la moitié de l'intervalle prévu. Les apparitions dans le flux ne mesurent pas l'attente aux arrêts.",
			excessWaitProxyExplain:
				"Moyenne non pondérée des écarts médians excédentaires des périodes rapportées, ramenés à zéro au minimum. Ce proxy compare l'intervalle observé à l'intervalle prévu; il n'estime pas l'attente des usagers.",
			headwayAxis: 'Intervalle (min)',
			directionAsymmetryLabel: 'La direction compte',
			directionAsymmetry: (shift, slowerDir, slowerVal, fasterDir, fasterVal) =>
				`Vers ${shift}, l’attente est d’environ ${slowerVal} vers ${slowerDir}, contre ${fasterVal} vers ${fasterDir}.`,
		},
		en: {
			headwaySection: 'Wait by shift',
			spanSection: 'Trip first appearances',
			serviceSpan: 'First-report span',
			firstTripDelay: 'First trip: delay in earliest report',
			lastTripDelay: 'Last trip: delay in latest report',
			tripCount: 'Trip IDs observed',
			moreDetail: 'More detail · observed gap by direction',
			directionGap: 'Observed gap by direction',
			directionShiftCol: 'Shift',
			directionCol: (n) => `Direction ${n}`,
			weekendSuffix: 'weekend',
			shiftMean: 'mean across reported shifts',
			priorDirectionNote: 'The busiest direction can change between windows.',
			excessWaitExplain:
				'Each reported shift has equal weight. The estimates assume uniform rider arrivals and model extra wait above half the scheduled gap. Feed appearances do not measure waits at stops.',
			excessWaitProxyExplain:
				"Unweighted mean of the reported shifts' median-gap excesses, each clamped to zero. This proxy compares observed and scheduled gaps; it does not estimate passenger wait.",
			headwayAxis: 'Headway (min)',
			directionAsymmetryLabel: 'Direction matters',
			directionAsymmetry: (shift, slowerDir, slowerVal, fasterDir, fasterVal) =>
				`Around ${shift}, the wait runs about ${slowerVal} toward ${slowerDir} but ${fasterVal} toward ${fasterDir}.`,
		},
	};

	const t = $derived(BAND_COPY[locale]);

	const dir0Label = $derived(directionHeadsigns[0] ?? t.directionCol(1));
	const dir1Label = $derived(directionHeadsigns[1] ?? t.directionCol(2));
	const terms = $derived(copy.regularityTerms);

	const min = (v: number | null | undefined): string | null =>
		fmtDelayMin(v, { rounding: 'fixed1' });
	const fmtCov = (v: number | null | undefined): string | null => (v == null ? null : v.toFixed(2));
	const pct = (v: number | null | undefined): string | null => fmtPct(v, { rounding: 'round' });
	const count = (v: number | null | undefined): string | null => fmtCount(v);
	const valueNoData = $derived(absenceShort('no-observations', locale));

	const spanCopy = $derived(copy.serviceSpanTimeline);
	const spanDuration = (v: number | null | undefined): string | null => {
		if (v == null || Number.isNaN(v)) return null;
		const total = Math.max(0, Math.round(v));
		const h = Math.floor(total / 60);
		const m = total % 60;
		return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
	};

	interface ShiftRow {
		readonly shift: string;
		readonly baseShift: string;
		readonly directionId: number | null;
		readonly dayType: string | null;
		readonly scheduled: number | null;
		readonly observed: number | null;
		readonly excessWait: number | null;
		readonly cov: number | null;
		readonly bunched: number | null;
		readonly magnitude: number | null;
		readonly severity: SeverityCode;
		readonly covSeverity: SeverityCode;
		readonly priorObserved: number | null;
	}

	function decodeShift(h: HeadwayPeriod): {
		baseShift: string;
		directionId: number | null;
		dayType: string | null;
	} {
		if (h.direction_id != null || h.day_type != null) {
			return {
				baseShift: h.shift,
				directionId: h.direction_id ?? null,
				dayType: h.day_type ?? null,
			};
		}
		const dirMatch = h.shift.match(/_dir(\d)/)?.[1];
		const weekend = h.shift.includes('_weekend');
		return {
			baseShift: h.shift.replace(/_dir\d/, '').replace(/_weekend/, ''),
			directionId: dirMatch != null ? Number(dirMatch) : null,
			dayType: dirMatch != null ? (weekend ? 'weekend' : 'weekday') : null,
		};
	}

	const shiftRows = $derived<ShiftRow[]>(
		wait.headway.map((h) => ({
			shift: h.shift,
			...decodeShift(h),
			scheduled: h.scheduled_min ?? null,
			observed: h.observed_min ?? null,
			excessWait: h.excess_wait_min ?? null,
			cov: h.cov ?? null,
			bunched: h.bunched_pct ?? null,
			magnitude: h.excess_wait_min ?? null,
			severity: bunchingToSeverity(h.bunched_pct),
			covSeverity: covToSeverity(h.cov),
			priorObserved: h.prior_observed_min ?? null,
		})),
	);

	function shiftLabel(row: ShiftRow): string {
		const baseLabel = baseShiftLabel(row.baseShift, locale);
		const extras: string[] = [];
		if (row.directionId != null) extras.push(`dir ${row.directionId}`);
		if (row.dayType === 'weekend') extras.push(locale === 'fr' ? 'fin de sem.' : 'weekend');
		return extras.length > 0 ? `${baseLabel} · ${extras.join(' · ')}` : baseLabel;
	}
	const isPrimaryShift = (row: ShiftRow): boolean => row.directionId == null && row.dayType == null;
	const primaryRows = $derived(shiftRows.filter((r) => isPrimaryShift(r)));
	const advancedRows = $derived(shiftRows.filter((r) => !isPrimaryShift(r)));
	const mainRows = $derived(primaryRows.length > 0 ? primaryRows : advancedRows);
	const hasAdvancedReveal = $derived(primaryRows.length > 0 && advancedRows.length > 0);

	interface WaitCompareRow {
		readonly key: string;
		readonly label: string;
		readonly observed: number | null;
		readonly delta: number | null;
	}
	const waitCompareRows = $derived<WaitCompareRow[]>(
		mainRows
			.filter((r) => r.observed != null)
			.map((r, i) => ({
				key: `${r.shift}-${i}`,
				label: shiftLabel(r),
				observed: r.observed,
				delta: priorDelta(r.observed, r.priorObserved, 1),
			})),
	);
	const hasWaitCompare = $derived(wait.windowed && waitCompareRows.length > 0);
	const fmtMinDelta = (d: number): string => `${d > 0 ? '+' : ''}${d.toFixed(1)}${copy.units.min}`;

	const headwayDumbbell = $derived(
		selectHeadwayDumbbell(
			mainRows.map((r, i) => ({
				key: `${r.shift}-${i}`,
				label: shiftLabel(r),
				scheduled: r.scheduled,
				observed: r.observed,
				excess: null,
				severity: r.severity,
				note:
					[
						r.cov != null ? `${terms.spread} ${fmtCov(r.cov)}` : null,
						r.bunched != null ? `${terms.clumped} ${pct(r.bunched)}` : null,
					]
						.filter(Boolean)
						.join(' · ') || undefined,
			})),
			locale,
			{
				title: t.headwaySection,
				xLabel: t.headwayAxis,
				unit: ' min',
				scheduledLabel: terms.scheduledGap,
				observedLabel: terms.observedGap,
				noDataMarker: valueNoData,
			},
		),
	);

	const SHIFT_ORDER = ['am_peak', 'midday', 'pm_peak', 'evening', 'night'];
	interface DirectionRow {
		readonly key: string;
		readonly label: string;
		readonly dir0: number | null;
		readonly dir1: number | null;
		readonly order: number;
	}
	const directionRows = $derived.by<DirectionRow[]>(() => {
		const groups: Record<
			string,
			{ base: string; weekend: boolean; dir0: number | null; dir1: number | null }
		> = {};
		for (const r of advancedRows) {
			const weekend = r.dayType === 'weekend';
			const dir = r.directionId != null ? String(r.directionId) : null;
			const base = r.baseShift;
			const key = `${base}__${weekend ? 'wknd' : 'week'}`;
			let g = groups[key];
			if (!g) {
				g = { base, weekend, dir0: null, dir1: null };
				groups[key] = g;
			}
			if (dir === '0') g.dir0 = r.observed;
			else if (dir === '1') g.dir1 = r.observed;
		}
		return Object.entries(groups)
			.map(([key, g]) => {
				const si = SHIFT_ORDER.indexOf(g.base);
				return {
					key,
					label: g.weekend
						? `${baseShiftLabel(g.base, locale)} · ${t.weekendSuffix}`
						: baseShiftLabel(g.base, locale),
					dir0: g.dir0,
					dir1: g.dir1,
					order: (si < 0 ? 99 : si) * 2 + (g.weekend ? 1 : 0),
				};
			})
			.sort((a, b) => a.order - b.order);
	});

	const directionAsymmetry = $derived(
		selectDirectionAsymmetry(directionRows, { dir0Label, dir1Label }),
	);

	const excessWaitValues = $derived(
		mainRows.map((r) => r.excessWait).filter((v): v is number => v != null && Number.isFinite(v)),
	);
	const meanShiftExcessWait = $derived<number | null>(
		excessWaitValues.length > 0
			? excessWaitValues.reduce((sum, v) => sum + v, 0) / excessWaitValues.length
			: null,
	);
	const hasExcessHeadline = $derived(meanShiftExcessWait != null);

	const excessBullet = $derived(
		selectBullet(meanShiftExcessWait, locale, {
			title: terms.excessWait,
			xLabel: terms.excessWait,
			unit: ' min',
			domain: HEADWAY_DOMAIN,
			tone: 'warn',
		}),
	);

	const shiftBarRows = $derived(mainRows.map((r, i) => ({ row: r, key: `${r.shift}-${i}` })));
	const excessBars = $derived(
		selectShiftBars(
			shiftBarRows.map(({ row, key }) => ({
				key,
				label: shiftLabel(row),
				value: row.excessWait,
				severity: row.severity,
				note:
					[
						row.cov != null ? `${terms.spread} ${fmtCov(row.cov)}` : null,
						row.bunched != null ? `${terms.clumped} ${pct(row.bunched)}` : null,
					]
						.filter(Boolean)
						.join(' · ') || undefined,
			})),
			locale,
			{
				title: terms.excessWait,
				rowLabel: copy.crosstab.shiftHeader,
				xLabel: terms.excessWait,
				unit: ' min',
				domain: HEADWAY_DOMAIN,
				noDataMarker: valueNoData,
			},
		),
	);
	const covBars = $derived(
		selectShiftBars(
			shiftBarRows.map(({ row, key }) => ({
				key,
				label: shiftLabel(row),
				value: row.cov,
				severity: row.covSeverity,
			})),
			locale,
			{
				title: terms.spread,
				rowLabel: copy.crosstab.shiftHeader,
				xLabel: terms.spread,
				unit: '',
				domain: COV_DOMAIN,
				noDataMarker: valueNoData,
			},
		),
	);
	const bunchedBars = $derived(
		selectShiftBars(
			shiftBarRows.map(({ row, key }) => ({
				key,
				label: shiftLabel(row),
				value: row.bunched,
				severity: row.severity,
			})),
			locale,
			{
				title: terms.clumped,
				rowLabel: copy.crosstab.shiftHeader,
				xLabel: terms.clumped,
				unit: '%',
				domain: BUNCHED_DOMAIN,
				noDataMarker: valueNoData,
			},
		),
	);

	const latestSpan = $derived<ServiceSpanPeriod | null>(
		serviceSpans.length > 0 ? serviceSpans[serviceSpans.length - 1] : null,
	);
	const hasSpan = $derived(latestSpan != null);

	const serviceSpanSpec = $derived(
		latestSpan
			? selectServiceSpan(
					{
						firstTripUtc: latestSpan.first_trip_utc ?? null,
						lastTripUtc: latestSpan.last_trip_utc ?? null,
						firstDelayMin: latestSpan.first_trip_delay_min ?? null,
						lastDelayMin: latestSpan.last_trip_delay_min ?? null,
					},
					locale,
					{
						firstLabel: spanCopy.firstTrip,
						lastLabel: spanCopy.lastTrip,
						firstDelayLabel: spanCopy.firstDelay,
						lastDelayLabel: spanCopy.lastDelay,
						spanLabel:
							spanDuration(latestSpan.service_span_min) != null
								? spanCopy.span(spanDuration(latestSpan.service_span_min)!)
								: null,
						tripsLabel:
							count(latestSpan.trip_count) != null
								? spanCopy.trips(count(latestSpan.trip_count)!)
								: null,
						hourLabel: (h) => `+${h}h`,
						ariaLabel: spanCopy.ariaLabel,
						absentTitle: t.spanSection,
						noDataLabel: valueNoData,
					},
				)
			: null,
	);
</script>

{#snippet excessInfo()}<MetricInfo
		class="cluster-info"
		metricKey="excessWait"
		{locale}
		name={terms.excessWait}
		side="bottom"
	/>{/snippet}

{#snippet waitCompareRow(row: WaitCompareRow)}
	<li
		class="compare-row"
		data-slot="wait-compare-row"
		data-prior={row.delta == null ? 'absent' : row.delta === 0 ? 'flat' : 'change'}
	>
		<span class="compare-label">{row.label}</span>
		<span class="compare-value">{min(row.observed) ?? valueNoData}</span>
		<DeltaStat
			class="compare-delta"
			delta={row.delta}
			display={row.delta != null ? fmtMinDelta(row.delta) : undefined}
			context={row.delta != null ? copy.priorDelta.vsPrior[win] : copy.priorDelta.noPrior[win]}
			ariaNoun={`${row.label} ${copy.priorDelta.waitNoun}`}
		/>
	</li>
{/snippet}

{#snippet directionShiftCell(row: DirectionRow)}
	{row.label}
{/snippet}

{#snippet directionZeroCell(row: DirectionRow)}
	{#if row.dir0 != null}
		{min(row.dir0)}
	{:else}
		<AbsentValue variant="row" reason="no-observations" {locale} />
	{/if}
{/snippet}

{#snippet directionOneCell(row: DirectionRow)}
	{#if row.dir1 != null}
		{min(row.dir1)}
	{:else}
		<AbsentValue variant="row" reason="no-observations" {locale} />
	{/if}
{/snippet}

<CollapsibleSection
	dataSection="the-wait"
	number={3}
	eyebrow={copy.sections.theWait.label}
	question={copy.sections.theWait.question}
>
	{#if wait.isEmpty && !hasSpan}
		<div data-slot="the-wait-empty">
			<AbsentValue variant="block" reason="no-observations" {locale} />
		</div>
	{:else}
		<div class="section-primary" data-slot="headway-dumbbell" data-card="primary">
			<span class="label-with-info">
				<SectionLabel text={t.headwaySection} variant="metric" />
				<MetricInfo
					class="cluster-info"
					metricKey="headway"
					{locale}
					name={t.headwaySection}
					side="bottom"
				/>
				<MetricInfo
					class="cluster-info"
					metricKey="regularityCov"
					{locale}
					name={copy.strip.headwayRegularityCov}
					side="bottom"
				/>
			</span>
			<Chart spec={headwayDumbbell.spec} />
			<p class="bunching-help" data-slot="bunching-help">{terms.bunchingHelp}</p>
		</div>

		{#if directionAsymmetry}
			<div class="direction-callout" data-slot="direction-asymmetry">
				<SectionLabel text={t.directionAsymmetryLabel} variant="metric" />
				<p class="direction-callout__text">
					{t.directionAsymmetry(
						directionAsymmetry.shiftLabel,
						directionAsymmetry.slowerLabel,
						`${Math.round(directionAsymmetry.slowerMin)}${copy.units.min}`,
						directionAsymmetry.fasterLabel,
						`${Math.round(directionAsymmetry.fasterMin)}${copy.units.min}`,
					)}
				</p>
			</div>
		{/if}

		<Detail label={copy.sections.detailShow} labelOpen={copy.sections.detailHide}>
			<div class="cluster-sub" data-sub="headway">
				{#if hasExcessHeadline}
					<MetricBullet
						label={`${terms.excessWait} · ${t.shiftMean}`}
						valueText={min(meanShiftExcessWait)}
						spec={excessBullet}
						{locale}
						size="lg"
						info={excessInfo}
						caption={wait.windowed ? t.excessWaitExplain : t.excessWaitProxyExplain}
						class="excess-wait-headline"
						data-slot="excess-wait-headline"
					/>
				{/if}

				{#if hasWaitCompare}
					<div class="block" data-slot="wait-vs-prior" data-card>
						<span class="label-with-info">
							<SectionLabel text={copy.priorDelta.waitHeading} variant="metric" />
							<MetricInfo
								class="cluster-info"
								metricKey="headway"
								{locale}
								name={copy.priorDelta.waitHeading}
								side="bottom"
							/>
						</span>
						<ul class="compare-list" data-slot="wait-compare">
							{#each waitCompareRows as row (row.key)}{@render waitCompareRow(row)}{/each}
						</ul>
						<p class="compare-caption" data-slot="wait-vs-prior-caption">
							{copy.priorDelta.caption}
							{t.priorDirectionNote}
						</p>
					</div>
				{/if}

				{#if shiftRows.length > 0}
					<div class="shift-charts" data-slot="shift-regularity-charts">
						<div class="shift-chart" data-metric="excess" data-card>
							<span class="label-with-info">
								<SectionLabel text={terms.excessWait} variant="metric" />
								<MetricInfo
									class="cluster-info"
									metricKey="excessWait"
									{locale}
									name={terms.excessWait}
									side="bottom"
								/>
							</span>
							<Chart spec={excessBars} />
						</div>
						<div class="shift-chart" data-metric="cov" data-card>
							<span class="label-with-info">
								<SectionLabel text={terms.spread} variant="metric" />
								<MetricInfo
									class="cluster-info"
									metricKey="regularityCov"
									{locale}
									name={terms.spread}
									side="bottom"
								/>
							</span>
							<Chart spec={covBars} />
						</div>
						<div class="shift-chart" data-metric="bunched" data-card>
							<span class="label-with-info">
								<SectionLabel text={terms.clumped} variant="metric" />
								<MetricInfo
									class="cluster-info"
									metricKey="regularityCov"
									{locale}
									name={terms.clumped}
									side="bottom"
								/>
							</span>
							<Chart spec={bunchedBars} />
						</div>
					</div>
					<p class="shift-caption" data-slot="excess-wait-caption">
						{copy.strip.excessWaitCaption}
						<MetricInfo
							class="cluster-info"
							metricKey="excessWait"
							{locale}
							name={terms.excessWait}
							side="bottom"
						/>
					</p>
					{#if hasAdvancedReveal}
						<div class="shift-direction" data-slot="direction-gaps">
							<SectionLabel text={t.directionGap} variant="metric" />
							<DataTable
								rows={directionRows}
								columns={[
									{
										key: 'shift',
										header: t.directionShiftCol,
										rowHeader: true,
										cell: directionShiftCell,
									},
									{
										key: 'direction-0',
										header: dir0Label,
										numeric: true,
										cell: directionZeroCell,
									},
									{
										key: 'direction-1',
										header: dir1Label,
										numeric: true,
										cell: directionOneCell,
									},
								] satisfies readonly DataTableColumn<DirectionRow>[]}
								key={(row) => row.key}
								caption={t.directionGap}
								responsive={{ mode: 'stack', at: 'compact' }}
								frame="none"
								borderCollapse="collapse"
								headerBand="none"
								tableAttrs={{ 'data-slot': 'direction-table' }}
							/>
						</div>
					{/if}
				{:else}
					<AbsentValue variant="block" reason="no-observations" {locale} />
				{/if}
			</div>

			{#if hasSpan && latestSpan}
				<div class="cluster-sub" data-sub="service-span" data-card>
					<div class="span-head">
						<span class="label-with-info">
							<SectionLabel text={t.spanSection} variant="metric" />
							<MetricInfo
								class="cluster-info"
								metricKey="serviceSpan"
								{locale}
								name={t.spanSection}
								side="bottom"
							/>
						</span>
						<span class="span-window" data-slot="service-span-window">
							{copy.windows.serviceSpan(latestSpan.date ?? null)}
						</span>
					</div>

					{#if serviceSpanSpec}
						<Chart spec={serviceSpanSpec} />
					{/if}
					<p class="span-caption" data-slot="service-span-caption">{spanCopy.caption}</p>

					<div class="shift-metrics">
						<div class="metric-with-info">
							<MetricDisplay
								value={min(latestSpan.service_span_min)}
								absentReason="no-observations"
								{locale}
								label={t.serviceSpan}
								size="sm"
							/>
							<MetricInfo
								class="cluster-info"
								metricKey="serviceSpan"
								{locale}
								name={t.serviceSpan}
								side="bottom"
							/>
						</div>
						<div class="metric-with-info">
							<MetricDisplay
								value={min(latestSpan.first_trip_delay_min)}
								absentReason="no-observations"
								{locale}
								label={t.firstTripDelay}
								size="sm"
							/>
							<MetricInfo
								class="cluster-info"
								metricKey="serviceSpan"
								{locale}
								name={t.firstTripDelay}
								side="bottom"
							/>
						</div>
						<div class="metric-with-info">
							<MetricDisplay
								value={min(latestSpan.last_trip_delay_min)}
								absentReason="no-observations"
								{locale}
								label={t.lastTripDelay}
								size="sm"
							/>
							<MetricInfo
								class="cluster-info"
								metricKey="serviceSpan"
								{locale}
								name={t.lastTripDelay}
								side="bottom"
							/>
						</div>
						<div class="metric-with-info">
							<MetricDisplay
								value={count(latestSpan.trip_count)}
								absentReason="no-observations"
								{locale}
								label={t.tripCount}
								size="sm"
							/>
							<MetricInfo
								class="cluster-info"
								metricKey="serviceSpan"
								{locale}
								name={t.tripCount}
								side="bottom"
							/>
						</div>
					</div>
				</div>
			{/if}
		</Detail>
	{/if}
</CollapsibleSection>

<style>
	.section-primary {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.direction-callout {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.direction-callout :global([data-slot='section-label']) {
		color: var(--accent-text);
	}
	.direction-callout__text {
		margin: 0;
		font-size: var(--text-body);
		line-height: 1.45;
		font-weight: 500;
		color: var(--foreground);
		text-wrap: pretty;
	}

	.cluster-sub {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.shift-charts {
		display: flex;
		flex-direction: column;
		gap: clamp(1rem, 2.5vw, 1.75rem);
	}
	.shift-chart {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.shift-metrics {
		display: flex;
		flex-wrap: wrap;
		gap: 1.25rem;
	}
	.metric-with-info {
		display: inline-flex;
		align-items: flex-start;
		gap: 0.375rem;
	}
	.metric-with-info :global([data-slot='metric-display']) {
		min-width: 0;
	}
	.metric-with-info :global(.cluster-info) {
		flex: none;
	}
	.shift-caption {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.block {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.compare-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.compare-row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.5rem;
		padding: 0.375rem 0;
	}
	.compare-row + .compare-row {
		border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
	}
	.compare-label {
		flex: 0 0 7rem;
		min-width: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-weight: 500;
		color: var(--foreground);
	}
	.compare-value {
		flex: 0 0 auto;
		min-width: 3.25rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
	}
	.compare-caption {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.shift-caption :global(.cluster-info) {
		flex: none;
		white-space: nowrap;
	}
	.shift-direction {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.875rem;
	}
	.span-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.5rem 1rem;
	}
	.span-window {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
	}
	.span-caption {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.bunching-help {
		margin: 0.25rem 0 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.5;
		color: var(--foreground);
	}
</style>
