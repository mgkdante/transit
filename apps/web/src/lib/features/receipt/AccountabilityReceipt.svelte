<!--
  AccountabilityReceipt — the /receipt surface ORCHESTRATOR (S13 re-seat).

  A daily accountability "receipt" rendered in the brand TerminalPanel window frame
  (WEB4 — the receipt metaphor STAYS): a SMART availability-aware single-date calendar
  picks the day, driving a per-date fetch of one day's receipt, composed as receipt
  line-groups —
    · headline figures  — on-time %, average delay, severe share, rider impact;
    · affected counts   — lines / stops / alerts touched on the day;
    · worst of the day   — worst line (→ /lines/[id]) + worst stop (→ /stop/[id]);
  and the S13 re-granulated cuts, which sit BELOW the frame (a documented WEB4 hoist —
  a ranked ladder / share-bar list / silent-lines list genuinely breaks the compact
  terminal-tile metaphor, so they render as their own line-groups under the receipt):
    · by time of day    — severe-delay share ranked by shift (absolute SEVERE_DOMAIN);
    · service delivered  — the ONE completeness number + delivered/cancelled/silent split;
    · scheduled but never appeared — the not-reported lines list (silent, not cancelled).

  This file is a THIN orchestrator: the two createResource resources, the codec-seeded
  ?date + the availability index, a bare ControlsRail hosting the single-date picker,
  and the section mount order. All formatting + section markup live in ./selectors,
  ./data, and ./sections — no inline transforms here.

  HONESTY: null/absent → the localized styled honest-absence chip, NEVER a fabricated 0;
  a 404 (getReceipt → null) or an empty index → the localized empty state. The new cuts
  stand DOWN (their `hasData`) during the GC2 ramp — an absent list is honest-absence,
  never a fabricated "everything delivered". DOCTRINE: --primary only on the interactive
  picker; every magnitude mark reads an ABSOLUTE domain literal (chart-doctrine).
-->
<script lang="ts">
	import { page } from '$app/state';
	import { getLocale, type Locale } from '$lib/i18n';
	import { routeNameFallback, stopNameFallback } from '$lib/site/absence';
	import { fromSearchParams } from '$lib/filters';
	import { layout } from '$lib/nav';
	import { mirrorSearchParam } from '$lib/site/urlMirror';
	import { formatDateKey } from '$lib/utils/time';
	import {
		fmtCount as sharedFmtCount,
		fmtDelayMin as sharedFmtDelayMin,
		fmtPct as sharedFmtPct,
	} from '$lib/utils';
	import { shiftLabel } from '$lib/features/reliability/shiftGrains';
	import { getReceiptsIndex, getReceipt, type Receipt } from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import {
		SurfaceHeader,
		ResourceBoundary,
		DateRangePicker,
		FreshnessStamp,
	} from '$lib/components/surface';
	import { Surface, ControlsRail } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';
	import { EdgeState } from '$lib/components/edge';
	import TerminalPanel from '$lib/components/brand/TerminalPanel.svelte';
	import {
		metricInfoFor,
		type MetricKey,
		type SupplementalMetricKey,
	} from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import { copy as COPY } from './receipt.copy';
	// Selectors + data presenters (pure VMs — no transforms in this orchestrator).
	import { selectAvailability } from './data/presentAvailability';
	import { resolveReceiptDate } from './data/presentDates';
	import { selectHeadlineKpis } from './selectors/headlineKpis';
	import { selectAffectedCounts } from './selectors/affectedCounts';
	import { selectWorstOfDay } from './selectors/day-worst';
	import { selectReceiptTimeOfDay } from './selectors/timeOfDay';
	import { selectStateCuts } from './selectors/stateCuts';
	import { selectNotReportedLines } from './selectors/notReportedLines';
	// Sections.
	import SectionHeadline from './sections/SectionHeadline.svelte';
	import SectionAffected from './sections/SectionAffected.svelte';
	import SectionWorst from './sections/SectionWorst.svelte';
	import SectionTimeOfDay from './sections/SectionTimeOfDay.svelte';
	import SectionStateCuts from './sections/SectionStateCuts.svelte';
	import SectionNotReported from './sections/SectionNotReported.svelte';

	const locale: Locale = getLocale();
	const t = $derived(COPY[locale]);

	// The metric-explainer (i) affordance: a one-line tip + a localized deep link to
	// /metrics#<anchor>, wired onto every KPI + section heading (same wiring as RouteDetail).
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey | SupplementalMetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});

	const edgeLayout = $derived(layout.isDesktop ? 'desktop' : 'mobile');

	// Discovery index — the published receipt dates + S13 availability metadata.
	// createResource is browser-only ($effect), so v1 base resolves same-origin.
	const index = createResource(() => getReceiptsIndex());

	// The smart calendar: the FULL span earliest→latest with published days enabled and
	// gap/empty days disabled + reasoned. `enabledDates` is what the default/seed reads.
	const availability = $derived(
		selectAvailability(index.data, {
			formatDate: (iso) => formatDateKey(iso, locale),
			gap: t.datePicker.gapReason,
			empty: t.datePicker.emptyReason,
			scheduleOnly: t.datePicker.scheduleOnlyFlag,
		}),
	);
	const hasDates = $derived(availability.hasAny);

	// The chosen day — seeded ONCE from the codec (?date deep-link → the picked day,
	// else the LATEST published day). resolveReceiptDate self-heals a gap/unknown ?date
	// back to the latest default. A rider's later pick then sticks.
	const seededDate = fromSearchParams(page.url.searchParams).date ?? null;
	let selectedDate = $state('');
	let dateSeeded = $state(false);
	$effect(() => {
		if (!dateSeeded && hasDates) {
			selectedDate = resolveReceiptDate(seededDate, availability.enabledDates) ?? '';
			dateSeeded = true;
		}
	});

	// Deep-linkable: mirror the picked day to ?date (default = latest omitted for a clean
	// canonical URL). Only the latest published day is the default, so drop ?date when it
	// equals the latest enabled day.
	$effect(() => {
		if (!selectedDate) return;
		const latest = availability.enabledDates[availability.enabledDates.length - 1];
		mirrorSearchParam('date', selectedDate === latest ? null : selectedDate);
	});

	// The receipt for the chosen day. The fetcher reads `selectedDate` when invoked, so
	// changing the day re-runs the fetch (the spine drops out-of-order responses). The
	// empty seed would 404, so hold off until a real date is chosen. `freshness: true`
	// feeds the chosen receipt's generated_utc into the shared newest-data timestamp.
	const receipt = createResource<Receipt | null>(
		() => (selectedDate ? getReceipt(selectedDate) : Promise.resolve(null)),
		{ freshness: true },
	);
	const generatedUtc = $derived(receipt.data?.generated_utc ?? null);

	// ── Formatters (null on no-data → the styled honest-absence chip; a real 0 stays 0) ──
	const fmtPct = (v: number | null | undefined) => sharedFmtPct(v, { suffix: t.units.pct });
	const fmtMinTile = (v: number | null | undefined) =>
		sharedFmtDelayMin(v, { rounding: 'auto', suffix: t.units.min });
	const fmtSeverePct = (v: number | null | undefined) =>
		sharedFmtPct(v, { rounding: 'fixed1', suffix: t.units.pct });
	const fmtScore = (v: number | null | undefined) => sharedFmtCount(v, { rounding: 'fixed1' });
	const fmtCount = (v: number | null | undefined) => sharedFmtCount(v, { locale });
	const fmtSharePct = (v: number | null) =>
		sharedFmtPct(v, { rounding: 'fixed1', suffix: t.units.pct });
	// Inline (concatenated into meta text) → keeps the localized no-data STRING.
	const fmtMinInline = (v: number | null | undefined) =>
		sharedFmtDelayMin(v, { rounding: 'auto', suffix: t.units.min, noData: t.noData });
	const fmtDelta = (v: number | null | undefined) => {
		if (v == null) return t.noData;
		return `${v > 0 ? '+' : ''}${v}${t.units.pts}`;
	};

	// ── Section view-models (pure selectors) ─────────────────────────────────────────
	const headlineKpis = $derived(
		receipt.data
			? selectHeadlineKpis(receipt.data, {
					onTime: t.metrics.onTime,
					avgDelay: t.metrics.avgDelay,
					severe: t.metrics.severe,
					riderImpact: t.metrics.riderImpact,
					fmtPct,
					fmtMin: fmtMinTile,
					fmtSeverePct,
					fmtScore,
				})
			: [],
	);
	const affectedCounts = $derived(
		receipt.data
			? selectAffectedCounts(receipt.data, {
					routes: t.counts.routes,
					stops: t.counts.stops,
					alerts: t.counts.alerts,
					vehicles: t.counts.vehicles,
					fmtCount,
				})
			: [],
	);
	const worst = $derived(
		selectWorstOfDay(receipt.data ?? { worst_route: null, worst_stop: null }, {
			routeName: (id, name) => name ?? routeNameFallback(id, locale),
			stopName: (id, name) => name ?? stopNameFallback(id, locale),
			routeLabel: t.worst.routeLabel,
			stopLabel: t.worst.stopLabel,
			routeDeltaLabel: t.worst.routeDeltaLabel,
			stopDelayLabel: t.worst.stopDelayLabel,
			fmtDelta,
			fmtMin: fmtMinInline,
		}),
	);
	const timeOfDay = $derived(
		selectReceiptTimeOfDay(receipt.data?.by_shift, { shiftLabel: (s) => shiftLabel(s, locale) }),
	);
	const stateCuts = $derived(
		selectStateCuts(receipt.data?.service_states, {
			delivered: t.stateCuts.delivered,
			cancelled: t.stateCuts.cancelled,
			silent: t.stateCuts.silent,
			fmtSharePct,
		}),
	);
	const notReported = $derived(
		selectNotReportedLines(receipt.data?.service_states, {
			routeName: (id, name) => name ?? routeNameFallback(id, locale),
			rowLabel: t.notReported.rowLabel,
			href: (id) => `/lines/${id}`,
			viewDetail: (id) => t.notReported.viewDetail(id),
			fmtScheduled: (v) => (v == null ? null : t.notReported.scheduled(v)),
		}),
	);
</script>

<Surface class="receipt">
	<SurfaceHeader kicker={t.kicker} heading={t.heading} subheading={t.subheading} lede={t.lede}>
		<FreshnessStamp variant="updated" {generatedUtc} {locale} />
	</SurfaceHeader>

	<Separator variant="hazard" />

	<!-- Discovery index → smart date picker. We DON'T hand the boundary an `isEmpty`:
	     an empty index has a SPECIFIC honest message (`emptyIndex`), so the boundary
	     only gates skeleton/error/no-file. -->
	<ResourceBoundary resource={index} lang={locale}>
		{#if !hasDates}
			<p class="receipt-note" data-slot="receipt-empty-index">{t.emptyIndex}</p>
		{:else}
			<!-- The smart single-date calendar lives in a bare ControlsRail (quiet infra
			     panel) ABOVE the frame — the receipt is NOT a multi-grain surface, so a
			     bare rail hosts ONLY the availability-bound picker; --primary stays on the
			     interactive control. The full span shows disabled gap-days with honest
			     reasons (WEB3). -->
			<ControlsRail label={t.controlsLabel} class="receipt-controls">
				<DateRangePicker
					mode="single"
					bind:date={selectedDate}
					dateOptions={availability.options}
					{locale}
					labels={{
						group: t.dateSelectLabel,
						start: '',
						end: '',
						clear: '',
						anyStart: '',
						anyEnd: '',
						single: t.datePicker.label,
					}}
				/>
			</ControlsRail>

			<Separator variant="hazard" hazardSize="sm" />

			<!-- The per-date receipt. We branch explicitly rather than via ResourceBoundary
			     because a 404 surfaces as a loaded `null` the boundary can't tell from
			     "not yet loaded" — so a null receipt gets the SPECIFIC empty-receipt copy. -->
			{#if receipt.error}
				<EdgeState
					variant="error-v1"
					lang={locale}
					layout={edgeLayout}
					onRetry={() => receipt.reload()}
				/>
			{:else if receipt.loading || !receipt.settled}
				<EdgeState variant="skeleton" lang={locale} layout={edgeLayout} />
			{:else if receipt.data == null}
				<p class="receipt-note" data-slot="receipt-empty">{t.emptyReceipt}</p>
			{:else}
				{@const r = receipt.data}
				<TerminalPanel
					title={t.terminalTitle}
					tag={t.terminalTag}
					status={formatDateKey(r.date, locale)}
					footerItems={[{ label: t.issuedLabel, value: formatDateKey(r.date, locale) }]}
				>
					<!-- The receipt's readout blocks tile into a fluid board (multi-column
					     desktop, one column mobile). The worst tile stands DOWN entirely when
					     the receipt carries no worst line/stop — the grid reflows past it. -->
					<div class="receipt-frame" data-slot="receipt-frame">
						<div class="receipt-layout" class:no-worst={!worst.hasWorst} data-slot="receipt-layout">
							<SectionHeadline
								kpis={headlineKpis}
								heading={t.receiptSection}
								noData={t.noData}
								{info}
								{locale}
							/>
							<SectionAffected counts={affectedCounts} heading={t.countsSection} {info} {locale} />
							{#if worst.hasWorst}
								<SectionWorst {worst} heading={t.worstSection} {info} {locale} />
							{/if}
						</div>
					</div>
				</TerminalPanel>

				<!-- S13 re-granulated cuts — WEB4 documented hoist: these render as receipt
				     line-groups BELOW the frame because a ranked ladder / share-bar list /
				     silent-lines list genuinely breaks the compact terminal-tile metaphor. Each
				     stands DOWN on ramp-in absence (honest-absence, never a fabricated card). -->
				<div class="receipt-cuts" data-slot="receipt-cuts">
					{#if timeOfDay.hasTimeOfDay}
						<SectionTimeOfDay
							rows={timeOfDay.rows}
							heading={t.timeOfDay.heading}
							subtitle={t.timeOfDay.severeShare}
							caveat={t.timeOfDay.caveat}
							{info}
							{locale}
						/>
					{/if}
					{#if stateCuts.hasData}
						<SectionStateCuts
							state={stateCuts}
							heading={t.stateCuts.heading}
							completenessLabel={t.stateCuts.completenessLabel}
							explainer={t.stateCuts.explainer}
							standDown={t.stateCuts.standDown}
							splitLabel={t.stateCuts.splitLabel}
							noData={t.noData}
							{info}
							{locale}
						/>
					{/if}
					{#if notReported.hasData}
						<SectionNotReported
							list={notReported}
							heading={t.notReported.heading}
							caveat={t.notReported.caveat}
							shownOfTotal={t.notReported.shownOfTotal}
						/>
					{/if}
				</div>

				<!-- Honest caveat: a daily observed summary, not a certified report. -->
				<p class="receipt-caveat" data-slot="receipt-caveat">{t.caveat}</p>
			{/if}
		{/if}
	</ResourceBoundary>
</Surface>

<style>
	:global(.receipt .receipt-controls[data-slot='controls-rail']) {
		margin-bottom: 1rem;
	}
	:global(.receipt [data-slot='terminal-chrome']) {
		max-width: var(--container-content);
	}

	/* The receipt is a COMPOSED document. A @container drives the composition off the
	   frame's own width (not the viewport). Default (narrow): a clean single stack. */
	.receipt-frame {
		container-type: inline-size;
		container-name: receipt;
	}
	.receipt-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-areas:
			'headline'
			'affected'
			'worst';
		gap: 1rem;
	}
	.receipt-layout :global([data-slot='receipt-headline']) {
		grid-area: headline;
	}
	.receipt-layout :global([data-slot='receipt-affected']) {
		grid-area: affected;
	}
	.receipt-layout :global([data-slot='receipt-worst']) {
		grid-area: worst;
	}

	/* Wide frame: the headline banner spans full width; affected + worst share a balanced
	   two-column secondary row. When the worst panel stands down, affected keeps the full
	   width — never a lopsided gap. */
	@container receipt (min-width: 34rem) {
		.receipt-layout {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			grid-template-areas:
				'headline headline'
				'affected worst';
			align-items: start;
		}
		.receipt-layout.no-worst {
			grid-template-areas:
				'headline headline'
				'affected affected';
		}
	}

	/* The S13 cuts sit below the frame as their own stacked line-groups (WEB4 hoist). */
	.receipt-cuts {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		margin-top: 1.25rem;
		max-width: var(--container-content);
	}
	.receipt-note {
		color: var(--muted-foreground);
		font-size: var(--text-small);
		line-height: 1.5;
		padding: 0.5rem 0.875rem;
	}
	.receipt-caveat {
		margin: 0.75rem 0 0;
		max-width: 52ch;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
</style>
