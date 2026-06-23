<!--
  AccountabilityReceipt — the /receipt surface screen (slice-9.6, Family D).

  A daily accountability "receipt" rendered in a distinctive terminal-window
  frame (the brand TerminalChrome): a date selector over the published receipt
  index (defaulting to the MOST RECENT day) drives a per-date fetch of one day's
  receipt, which we render as:
    · headline figures   — on-time %, average delay, severe-delay share, the
      rider-impact score (each honest no-data when null);
    · affected counts    — routes / stops / alerts / vehicles touched on the day
      (a count is shown only when present; a null count reads as no-data);
    · worst of the day    — the single worst route (linked to /route/[id]) and
      worst stop (linked to /stop/[id]), each with its delta/avg-delay, stood
      down when the receipt carries none.

  Two resources on the createResource spine: the index (the list of dates) and
  the per-date receipt. The receipt fetcher reads `selectedDate` when invoked, so
  picking another day re-runs the fetch (the spine drops out-of-order responses).

  DOCTRINE: no data mark uses --primary (the date GrainPicker is the only
  --primary affordance — an interactive control). Tokens only, no hex. Honesty
  rule — null/absent → the localized no-data string, NEVER a fabricated 0; a 404
  from getReceipt (the adapter returns null) or an empty index → the localized
  empty state, never an invented receipt. All prose comes from ./receipt.copy.
-->
<script lang="ts">
	import { getLocale, type Locale } from '$lib/i18n';
	import { routeNameFallback, stopNameFallback } from '$lib/site/absence';
	import { layout } from '$lib/nav';
	import { formatDateKey } from '$lib/utils/time';
	import {
		fmtCount as sharedFmtCount,
		fmtDelayMin as sharedFmtDelayMin,
		fmtPct as sharedFmtPct,
	} from '$lib/utils';
	import { getReceiptsIndex, getReceipt, type Receipt } from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import {
		SurfaceHeader,
		ResourceBoundary,
		GrainPicker,
		FreshnessStamp,
	} from '$lib/components/surface';
	import type { GrainSegment } from '$lib/components/surface';
	import { Surface, ControlsRail } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';
	import { EdgeState } from '$lib/components/edge';
	import EntityRow from '$lib/components/surface/EntityRow.svelte';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import TerminalChrome from '$lib/components/brand/TerminalChrome.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import {
		metricInfoFor,
		type MetricKey,
		type SupplementalMetricKey,
	} from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import { copy as COPY } from './receipt.copy';

	const locale: Locale = getLocale();
	const t = $derived(COPY[locale]);

	// The metric-explainer (i) affordance: a one-line tip + a localized deep link to
	// /metrics#<anchor>, wired onto every headline KPI + the section headings so each
	// number carries its honest definition (same wiring as RouteDetail).
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey | SupplementalMetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});

	const edgeLayout = $derived(layout.isDesktop ? 'desktop' : 'mobile');

	// Discovery index — the published receipt dates (ascending). createResource is
	// browser-only ($effect), so the v1 base resolves same-origin here.
	const index = createResource(() => getReceiptsIndex());

	// The index dates, most-recent FIRST (the index publishes ascending). We default
	// the selector to the newest day and offer the rest below it.
	const dates = $derived.by<string[]>(() => {
		const ds = index.data?.dates ?? [];
		return [...ds].reverse();
	});
	const hasDates = $derived(dates.length > 0);

	// The chosen receipt date. Empty until the index settles; the effect below seeds
	// it to the most recent published day exactly once (a rider's pick then sticks).
	let selectedDate = $state('');
	let dateSeeded = $state(false);
	$effect(() => {
		if (!dateSeeded && hasDates) {
			selectedDate = dates[0];
			dateSeeded = true;
		}
	});

	// The receipt for the chosen day. The fetcher reads `selectedDate` when invoked,
	// so changing the day re-runs the fetch. Guard the empty seed: an empty date
	// would 404, so we hold off until a real date is chosen (getReceipt('') is never
	// issued). Returns null on a 404 → the localized empty state, not an error.
	// `freshness: true` feeds the chosen receipt's generated_utc into the shared
	// site-wide newest-data timestamp (latest-wins/monotonic). The null seed (before
	// a date is chosen / on a 404) carries no stamp, so it never poisons the value.
	const receipt = createResource<Receipt | null>(
		() => (selectedDate ? getReceipt(selectedDate) : Promise.resolve(null)),
		{ freshness: true },
	);

	// Freshness off the CHOSEN receipt's generated_utc — a per-day rebuilt document,
	// not a live feed (variant="updated"). The stamp computes its server-anchored,
	// shared-tick age centrally; null before a date is chosen / on a 404 reads the
	// honest "unknown", never a fabricated time. The visible stamp matches the
	// generated_utc this surface already feeds into the shared freshness authority.
	const generatedUtc = $derived(receipt.data?.generated_utc ?? null);

	// Date selector segments — one chip per published day, labelled as a localized
	// short date. The GrainPicker is string-keyed; the ISO date IS the key.
	const dateSegments = $derived.by<GrainSegment<string>[]>(() =>
		dates.map((d) => ({ key: d, label: formatDateKey(d, locale) })),
	);

	/** Format a nullable integer percent as "82%" or the honest no-data. */
	function fmtPct(v: number | null | undefined): string {
		return sharedFmtPct(v, { suffix: t.units.pct, noData: t.noData });
	}
	/** Format a nullable minute value as "3 min" / "3.4 min" or no-data. */
	function fmtMin(v: number | null | undefined): string {
		return sharedFmtDelayMin(v, { rounding: 'auto', suffix: t.units.min, noData: t.noData });
	}
	/** Format a nullable fractional severe-share percent as "4.2%" or no-data. */
	function fmtSeverePct(v: number | null | undefined): string {
		return sharedFmtPct(v, { rounding: 'fixed1', suffix: t.units.pct, noData: t.noData });
	}
	/** Format a nullable rider-impact score (1 decimal) or no-data. */
	function fmtScore(v: number | null | undefined): string {
		return sharedFmtCount(v, { rounding: 'fixed1', noData: t.noData });
	}
	/** Format a nullable integer count (localized thousands) or no-data. */
	function fmtCount(v: number | null | undefined): string {
		return sharedFmtCount(v, { locale, noData: t.noData });
	}
	/** Signed OTP delta in points, e.g. "-8 pts" / "+2 pts", or no-data. */
	function fmtDelta(v: number | null | undefined): string {
		if (v == null) return t.noData;
		const sign = v > 0 ? '+' : '';
		return `${sign}${v}${t.units.pts}`;
	}

	// Worst route/stop are stood down unless the receipt carries one WITH an id.
	const worstRoute = $derived(receipt.data?.worst_route ?? null);
	const worstStop = $derived(receipt.data?.worst_stop ?? null);
	const hasWorstRoute = $derived(!!worstRoute?.id);
	const hasWorstStop = $derived(!!worstStop?.id);
	const hasWorst = $derived(hasWorstRoute || hasWorstStop);
</script>

<!-- A headline KPI = MetricDisplay + its (i) explainer, baseline-aligned. Declared
     once so each receipt figure carries an honest, deep-linked definition. -->
{#snippet kpi(
	value: string,
	label: string,
	key: MetricKey | SupplementalMetricKey,
	size: 'sm' | 'md' | 'lg',
)}
	{@const i = info(key, label)}
	<div class="receipt-kpi">
		<MetricDisplay {value} {label} {size} />
		<MetricInfo tip={i.tip} href={i.href} label={i.label} linkLabel={i.linkLabel} side="bottom" />
	</div>
{/snippet}

<!-- A section heading + its (i) explainer, baseline-aligned. -->
{#snippet sectionInfo(text: string, key: MetricKey | SupplementalMetricKey)}
	{@const i = info(key, text)}
	<span class="receipt-section">
		<SectionLabel {text} variant="station" />
		<MetricInfo tip={i.tip} href={i.href} label={i.label} linkLabel={i.linkLabel} side="bottom" />
	</span>
{/snippet}

<Surface width="bleed" class="receipt">
	<SurfaceHeader kicker={t.kicker} heading={t.heading} subheading={t.subheading} lede={t.lede}>
		<FreshnessStamp variant="updated" {generatedUtc} {locale} />
	</SurfaceHeader>

	<Separator variant="hazard" />

	<!-- Discovery index → date selector. We DON'T hand the boundary an `isEmpty`:
	     an empty index is a legitimate published state with a SPECIFIC honest
	     message (`emptyIndex`, "no receipts yet"), more informative than the generic
	     edge-empty. So the boundary only gates skeleton/error/no-file, and we render
	     the empty-index note ourselves when the published index carries no dates. -->
	<ResourceBoundary resource={index} lang={locale}>
		{#if !hasDates}
			<p class="receipt-note" data-slot="receipt-empty-index">{t.emptyIndex}</p>
		{:else}
			<!-- The date selector lives in a ControlsRail (quiet infra control panel)
			     ABOVE the TerminalChrome receipt frame: the picker is an INTERACTION
			     control, so --primary lives only on the active date chip, never on the
			     rail chrome. The GrainPicker's radiogroup stays inside the rail. -->
			<ControlsRail label={t.controlsLabel} class="receipt-controls">
				<GrainPicker
					segments={dateSegments}
					bind:value={selectedDate}
					label={t.dateSelectLabel}
					class="receipt-dates"
				/>
			</ControlsRail>

			<!-- Hazard tape discerns the controls zone from the data canvas. -->
			<Separator variant="hazard" hazardSize="sm" />

			<!-- The per-date receipt. We branch explicitly rather than via ResourceBoundary
		     because a 404 surfaces as a loaded `null` (the adapter's empty signal) that
		     the boundary cannot tell apart from "not yet loaded" — so a null receipt
		     gets the SPECIFIC localized empty-receipt copy, not the generic empty edge.
		     Error/skeleton still use the shared EdgeState for spine consistency. -->
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
				<TerminalChrome
					title={t.terminalTitle}
					tag={t.terminalTag}
					status={formatDateKey(r.date, locale)}
					footer={[{ label: t.issuedLabel, value: formatDateKey(r.date, locale) }]}
				>
					<!-- The receipt's three readout blocks tile into a fluid board: a
					     multi-column board on desktop (the headline figures, the
					     affected-counts and the worst-of-day each fill their own cell), one
					     column on mobile (auto-fit reflow handles <lg). The worst-of-day tile
					     stands DOWN entirely when the receipt carries no worst route/stop —
					     the grid reflows past it, never a fabricated empty card. -->
					<!-- The container that the @container queries resolve against lives on
						     this WRAPPER, not the grid itself: a query can only restyle the grid
						     as a DESCENDANT of the element that establishes the container. -->
					<div class="receipt-frame" data-slot="receipt-frame">
						<div class="receipt-layout" class:no-worst={!hasWorst} data-slot="receipt-layout">
							<!-- PRIMARY band: the day's headline reliability figures. -->
							<section class="receipt-panel receipt-primary" data-slot="receipt-headline">
								{@render sectionInfo(t.receiptSection, 'otp')}
								<div class="receipt-metrics">
									{@render kpi(fmtPct(r.otp_pct), t.metrics.onTime, 'otp', 'lg')}
									{@render kpi(fmtMin(r.avg_delay_min), t.metrics.avgDelay, 'avgDelay', 'lg')}
									{@render kpi(fmtSeverePct(r.severe_pct), t.metrics.severe, 'severe', 'md')}
									{@render kpi(
										fmtScore(r.rider_impact_score),
										t.metrics.riderImpact,
										'riderImpact',
										'md',
									)}
								</div>
							</section>

							<!-- SECONDARY row, left: affected counts on the day. -->
							<section class="receipt-panel receipt-affected" data-slot="receipt-affected">
								{@render sectionInfo(t.countsSection, 'affectedCounts')}
								<dl class="receipt-counts">
									<div class="receipt-count">
										<dt>{t.counts.routes}</dt>
										<dd>{fmtCount(r.affected_routes)}</dd>
									</div>
									<div class="receipt-count">
										<dt>{t.counts.stops}</dt>
										<dd>{fmtCount(r.affected_stops)}</dd>
									</div>
									<div class="receipt-count">
										<dt>{t.counts.alerts}</dt>
										<dd>{fmtCount(r.alerts)}</dd>
									</div>
									<!-- `vehicles` is structurally always-null on /v1 (the daily receipt
								     carries no per-vehicle count), so we OMIT the cell entirely rather
								     than render a permanent "no data" row. A real count would surface it
								     again. The other counts stay honest (a null reads no-data). -->
									{#if r.vehicles != null}
										<div class="receipt-count">
											<dt>{t.counts.vehicles}</dt>
											<dd>{fmtCount(r.vehicles)}</dd>
										</div>
									{/if}
								</dl>
							</section>

							<!-- SECONDARY row, right: worst of the day — linked entity rows; the
						     whole panel stands down when the receipt carries no worst
						     route/stop (the row collapses to the affected column). -->
							{#if hasWorst}
								<section class="receipt-panel receipt-worst-panel" data-slot="receipt-worst">
									{@render sectionInfo(t.worstSection, 'otp')}
									<div class="receipt-worst">
										{#if hasWorstRoute && worstRoute}
											<EntityRow
												target={{ kind: 'line', id: worstRoute.id }}
												{locale}
												title={worstRoute.name ?? routeNameFallback(worstRoute.id, locale)}
												subtitle={`${t.worst.routeLabel} · ${worstRoute.id}`}
												meta={`${t.worst.routeDeltaLabel} ${fmtDelta(worstRoute.otp_delta_pts)}`}
											/>
										{/if}
										{#if hasWorstStop && worstStop}
											<EntityRow
												target={{ kind: 'stop', id: worstStop.id }}
												{locale}
												title={worstStop.name ?? stopNameFallback(worstStop.id, locale)}
												subtitle={`${t.worst.stopLabel} · ${worstStop.id}`}
												meta={`${t.worst.stopDelayLabel} ${fmtMin(worstStop.avg_delay_min)}`}
											/>
										{/if}
									</div>
								</section>
							{/if}
						</div>
					</div>
				</TerminalChrome>

				<!-- Honest caveat: a daily observed summary, not a certified report. -->
				<p class="receipt-caveat" data-slot="receipt-caveat">{t.caveat}</p>
			{/if}
		{/if}
	</ResourceBoundary>
</Surface>

<style>
	/* The ControlsRail owns its own bordered chrome; the hazard Separator below it
	   discerns the controls zone from the receipt frame. The class lands on the
	   rail's child-component root, so scope the spacing via its data-slot (the
	   scoped analyzer can't otherwise see a child root). */
	:global(.receipt .receipt-controls[data-slot='controls-rail']) {
		margin-bottom: 1rem;
	}
	/* TerminalChrome owns its own root element, so scope its width via the slot
	   it stamps (a child-component root the scoped analyzer can't otherwise see).
	   Widened to a board measure so the inner composed layout reads as a designed
	   receipt rather than the old single-stack 34rem column. */
	:global(.receipt [data-slot='terminal-chrome']) {
		max-width: var(--container-content);
	}

	/* The receipt is a COMPOSED document, not scattered cards. A @container drives
	   the composition off the receipt frame's own width (not the viewport), so the
	   layout is right whatever the page chrome around it. Default (narrow): a clean
	   single stack — headline, then affected, then worst. */
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
	.receipt-primary {
		grid-area: headline;
	}
	.receipt-affected {
		grid-area: affected;
	}
	.receipt-worst-panel {
		grid-area: worst;
	}

	/* Wide receipt frame: a deliberate two-row composition. The headline figures
	   span the FULL width as a banner; the affected counts + worst-of-day sit as a
	   balanced two-column secondary row beneath, sharing the top baseline. When the
	   worst panel stands down (.no-worst), the secondary row is a single column and
	   the affected panel keeps the full width — never a lopsided gap. */
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

	/* Each section is a quiet bordered panel (chrome only: --card bg, --border —
	   never a data mark; the metrics bring their own dataviz colour). They share a
	   common inner rhythm so the three panels read as one designed unit. */
	.receipt-panel {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		padding: 1.1rem 1.2rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--card);
	}
	/* The headline band gets a touch more breathing room as the receipt's lead. */
	.receipt-primary {
		gap: 1rem;
	}
	.receipt-metrics {
		margin: 0;
		display: grid;
		gap: 1.1rem 1.75rem;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	/* On a wide frame the four headline figures read as a single banner row. */
	@container receipt (min-width: 46rem) {
		.receipt-metrics {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}
	/* A headline KPI cell: the MetricDisplay (label + big value) with its (i)
	   explainer pinned top-right beside the quiet label, never over the value. */
	.receipt-kpi {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		min-width: 0;
	}
	.receipt-kpi :global([data-slot='metric-display']) {
		min-width: 0;
	}
	/* Section heading + its (i) explainer share a baseline-aligned inline row. */
	.receipt-section {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}
	/* Affected-count grid — a quiet mono description list. The panel itself is a
	   container so the counts adapt to the COLUMN they land in: 2-up in the narrow
	   secondary column, 4-up when the affected panel spans the full width (the
	   .no-worst case), never a cramped 4-up squeezed into half a frame. */
	.receipt-affected {
		container-type: inline-size;
		container-name: receipt-affected;
	}
	.receipt-counts {
		margin: 0;
		display: grid;
		gap: 0.8rem 1.5rem;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	@container receipt-affected (min-width: 30rem) {
		.receipt-counts {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}
	.receipt-count {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.receipt-count dt {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: 0.5px;
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.receipt-count dd {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-subheading);
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
	}
	.receipt-worst {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
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
