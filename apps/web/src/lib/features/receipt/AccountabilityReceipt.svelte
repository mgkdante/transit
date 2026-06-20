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
	import { layout } from '$lib/nav';
	import { formatDateKey } from '$lib/utils/time';
	import { getReceiptsIndex, getReceipt, type Receipt } from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import { SurfaceHeader, ResourceBoundary, GrainPicker } from '$lib/components/surface';
	import type { GrainSegment } from '$lib/components/surface';
	import { Surface } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';
	import { EdgeState } from '$lib/components/edge';
	import EntityRow from '$lib/components/surface/EntityRow.svelte';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import TerminalChrome from '$lib/components/brand/TerminalChrome.svelte';
	import { copy as COPY } from './receipt.copy';

	const locale: Locale = getLocale();
	const t = $derived(COPY[locale]);

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
	const receipt = createResource<Receipt | null>(() =>
		selectedDate ? getReceipt(selectedDate) : Promise.resolve(null),
	);

	// Date selector segments — one chip per published day, labelled as a localized
	// short date. The GrainPicker is string-keyed; the ISO date IS the key.
	const dateSegments = $derived.by<GrainSegment<string>[]>(() =>
		dates.map((d) => ({ key: d, label: formatDateKey(d, locale) })),
	);

	/** Format a nullable integer percent as "82%" or the honest no-data. */
	function fmtPct(v: number | null | undefined): string {
		return v == null ? t.noData : `${v}${t.units.pct}`;
	}
	/** Format a nullable minute value as "3 min" / "3.4 min" or no-data. */
	function fmtMin(v: number | null | undefined): string {
		if (v == null) return t.noData;
		const n = Number.isInteger(v) ? String(v) : v.toFixed(1);
		return `${n}${t.units.min}`;
	}
	/** Format a nullable fractional severe-share percent as "4.2%" or no-data. */
	function fmtSeverePct(v: number | null | undefined): string {
		return v == null ? t.noData : `${v.toFixed(1)}${t.units.pct}`;
	}
	/** Format a nullable rider-impact score (1 decimal) or no-data. */
	function fmtScore(v: number | null | undefined): string {
		return v == null ? t.noData : v.toFixed(1);
	}
	/** Format a nullable integer count (localized thousands) or no-data. */
	function fmtCount(v: number | null | undefined): string {
		return v == null ? t.noData : v.toLocaleString(locale === 'fr' ? 'fr-CA' : 'en-CA');
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

<Surface width="bleed" class="receipt">
	<SurfaceHeader kicker={t.kicker} heading={t.heading} subheading={t.subheading} lede={t.lede} />

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
			<div class="receipt-datebar">
				<SectionLabel text={t.dateSelectLabel} variant="station" />
				<GrainPicker
					segments={dateSegments}
					bind:value={selectedDate}
					label={t.dateSelectLabel}
					class="receipt-dates"
				/>
			</div>

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
					<!-- Headline figures -->
					<div class="receipt-block">
						<SectionLabel text={t.receiptSection} variant="metric" />
						<div class="receipt-metrics">
							<MetricDisplay value={fmtPct(r.otp_pct)} label={t.metrics.onTime} size="lg" />
							<MetricDisplay value={fmtMin(r.avg_delay_min)} label={t.metrics.avgDelay} size="lg" />
							<MetricDisplay
								value={fmtSeverePct(r.severe_pct)}
								label={t.metrics.severe}
								size="md"
							/>
							<MetricDisplay
								value={fmtScore(r.rider_impact_score)}
								label={t.metrics.riderImpact}
								size="md"
							/>
						</div>
					</div>

					<Separator variant="default" />

					<!-- Affected counts on the day -->
					<div class="receipt-block">
						<SectionLabel text={t.countsSection} variant="metric" />
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
					</div>

					<!-- Worst of the day — linked entity rows, stood down when absent -->
					{#if hasWorst}
						<Separator variant="default" />
						<div class="receipt-block">
							<SectionLabel text={t.worstSection} variant="metric" />
							<div class="receipt-worst">
								{#if hasWorstRoute && worstRoute}
									<EntityRow
										target={{ kind: 'line', id: worstRoute.id }}
										{locale}
										title={worstRoute.name ?? t.worst.unnamed}
										subtitle={`${t.worst.routeLabel} · ${worstRoute.id}`}
										meta={`${t.worst.routeDeltaLabel} ${fmtDelta(worstRoute.otp_delta_pts)}`}
									/>
								{/if}
								{#if hasWorstStop && worstStop}
									<EntityRow
										target={{ kind: 'stop', id: worstStop.id }}
										{locale}
										title={worstStop.name ?? t.worst.unnamed}
										subtitle={`${t.worst.stopLabel} · ${worstStop.id}`}
										meta={`${t.worst.stopDelayLabel} ${fmtMin(worstStop.avg_delay_min)}`}
									/>
								{/if}
							</div>
						</div>
					{/if}
				</TerminalChrome>

				<!-- Honest caveat: a daily observed summary, not a certified report. -->
				<p class="receipt-caveat" data-slot="receipt-caveat">{t.caveat}</p>
			{/if}
		{/if}
	</ResourceBoundary>
</Surface>

<style>
	.receipt-datebar {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	/* TerminalChrome owns its own root element, so scope its width via the slot
	   it stamps (a child-component root the scoped analyzer can't otherwise see). */
	:global(.receipt [data-slot='terminal-chrome']) {
		max-width: 34rem;
	}
	.receipt-block {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.receipt-block + :global(.separator),
	:global(.separator) + .receipt-block {
		margin-block: 0.5rem;
	}
	.receipt-metrics {
		margin: 0;
		display: grid;
		gap: 1rem 1.5rem;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	/* Affected-count grid — a quiet mono description list. */
	.receipt-counts {
		margin: 0;
		display: grid;
		gap: 0.75rem 1.5rem;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	@media (min-width: 480px) {
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
