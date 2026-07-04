<!--
  AlertHistory — the /alerts surface screen ("Avis", slice-9.6 Family D; S15 re-seat).

  The citizen-facing ACCOUNTABILITY log of PAST service alerts: a chronological
  (newest-first) list of resolved/expired alerts with their active window(s),
  resolved duration, reach (routes/stops), estimated rider-impact and public link —
  plus the Tier-2 cause/effect/severity distribution when the archive carries one.

  S15 THIN ORCHESTRATOR: this file owns the data port + the codec (seed → clamp →
  ONE batched URL mirror) + ONE mapping pass through the pure ./selectors, then hands
  each zone to a pure presenter (AlertFilters / AlertLog / AlertBreakdown). All
  narrowing logic lives in ./selectors/alertLog; the picker options in
  ./selectors/entityOptions. The alert presentation (headline, cause/effect, severity
  word) is inherited from the shared $lib/v1 kernel (alertDisplay / gtfsAlertLabels /
  enumLabels), so a past alert reads like the live ones a rider already knows — and
  the surface no longer reaches across features (the alerts→map exemption is gone).

  FILTERS (codec-backed, URL-mirrored, batched): entity-type + severity radiogroups
  (?affects / ?severity), a Line + a Stop typeahead picker (?route / ?stop), and a
  date range over the served span (?from / ?to). Every served day is selectable — a
  zero-alert day is a REAL answer. Legacy payloads with no window fields derive the
  span from the entries; nothing datable → the picker hides with honest absence.

  HONESTY: a null/absent field is OMITTED; a generic/empty headline falls back to the
  shared "Service alert"; an empty archive routes to the localized empty state; the
  breakdown stands down when no distribution was published; a truncated window shows
  an honest cap note. Tokens only, no hex. All prose is in ./alerts.copy.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { getLocale, type Locale } from '$lib/i18n';
	import { getAlertHistory } from '$lib/v1';
	import type { AlertHistory, AlertHistoryEntry, Alert, SeverityCode } from '$lib/v1/schemas';
	import { createResource } from '$lib/v1/resource.svelte';
	import { formatUtc } from '$lib/utils/time';
	import {
		fromSearchParams,
		resolveWindow,
		type AlertAffects,
		type DateWindow,
	} from '$lib/filters';
	import { mirrorSearchParams } from '$lib/site/urlMirror';
	import { ResourceBoundary, FreshnessStamp } from '$lib/components/surface';
	import { Surface } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';
	import { ExplainedMetricCard } from '$lib/components/dataviz';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import Masthead from '$lib/components/brand/Masthead.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type SupplementalMetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	// The shared alert vocabulary, now in the $lib/v1 kernel (no cross-feature import).
	import { alertDisplayText } from '$lib/v1/alertDisplay';
	import { causeLabel, effectLabel } from '$lib/v1/gtfsAlertLabels';
	import { foldSearchText } from '$lib/search/normalize';

	import {
		bandSeverity,
		sortNewestFirst,
		filterAlertLog,
		buildAlertRow,
		toBreakdownRows,
		deriveSpan,
		enumerateDates,
		medianOf,
		type BreakdownKind,
		type AlertRowVM,
	} from './selectors/alertLog';
	import { buildLineOptions, buildStopOptions } from './selectors/entityOptions';
	import AlertFilters from './sections/AlertFilters.svelte';
	import AlertLog from './sections/AlertLog.svelte';
	import AlertBreakdown from './sections/AlertBreakdown.svelte';
	import { alertHistoryCopy } from './alerts.copy';

	const locale: Locale = getLocale();
	const t = $derived(alertHistoryCopy[locale]);

	// The metric-explainer (i) affordance: a one-line tip + a localized deep link to
	// /metrics#<anchor>. Wires the five supplemental alert* dimensions (cause/effect/
	// severity/duration/reach) onto their headings — the SAME `info()` shape every
	// other surface uses (NetworkSurface / RouteDetail / StopReliabilitySurface).
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: SupplementalMetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});

	// Historic tier — the daily-rebuilt alert archive (createResource, browser-only).
	const history = createResource(() => getAlertHistory(), { freshness: true });

	/** Max rows rendered before the "+N more" disclosure. */
	const VISIBLE_CAP = 25;
	let expanded = $state(false);

	// --- Codec seed (ONCE) ------------------------------------------------------
	const seed = fromSearchParams(page.url.searchParams);
	// Entity-type + severity are single-select scalars (absent = "all").
	let affects = $state<'all' | AlertAffects>(seed.alertAffects ?? 'all');
	let severity = $state<'all' | SeverityCode>(seed.alertSeverity ?? 'all');
	// The Line / Stop picks reuse the existing ?route/?stop id-set axes (first id; the
	// pickers are single-select), the StopsIndex precedent.
	let route = $state<string | null>([...seed.routes][0] ?? null);
	let stop = $state<string | null>([...seed.stops][0] ?? null);
	// The picked date window (undefined = full served span). Clamped once below.
	let pickedWindow = $state<DateWindow | undefined>(seed.window);

	// --- The log entries + the served span --------------------------------------
	const entries = $derived<readonly AlertHistoryEntry[]>(history.data?.alerts ?? []);
	const sorted = $derived(sortNewestFirst(entries));

	// The served span: prefer the payload's honest window_start/window_end; else derive
	// it from the entries (legacy fallback). Null ⇒ nothing datable ⇒ hide the picker.
	const span = $derived.by<{ start: string; end: string } | null>(() => {
		const ws = history.data?.window_start ?? null;
		const we = history.data?.window_end ?? null;
		if (ws && we) return { start: ws.slice(0, 10), end: we.slice(0, 10) };
		return deriveSpan(sorted);
	});
	// Every served day is selectable (a zero-alert day is a real answer).
	const availableDates = $derived<readonly string[]>(
		span ? enumerateDates(span.start, span.end) : [],
	);

	// One-shot availability clamp: drop a seeded window whose bounds the span has no day
	// for (resolveWindow returns undefined unless BOTH bounds are real dates). The URL is
	// a hint, never a data source. Runs once the served span is known.
	let windowSettled = $state(false);
	$effect(() => {
		if (windowSettled) return;
		// Wait until the resource has settled so availableDates reflects the real span.
		if (!history.settled) return;
		windowSettled = true;
		pickedWindow = resolveWindow(pickedWindow, new Set(availableDates));
	});

	// --- Batched URL mirror -----------------------------------------------------
	// ONE mirrorSearchParams so back-to-back single writes never clobber each other.
	// 'all'/null/undefined null out the key for a clean canonical URL.
	$effect(() => {
		mirrorSearchParams({
			affects: affects === 'all' ? null : affects,
			severity: severity === 'all' ? null : severity,
			route: route,
			stop: stop,
			from: pickedWindow?.from ?? null,
			to: pickedWindow?.to ?? null,
		});
	});

	// --- ONE mapping pass -------------------------------------------------------
	/** The headline for a history entry, via the SAME resolver the live surfaces use. */
	function headline(entry: AlertHistoryEntry): string {
		const shaped: Alert = {
			id: entry.id,
			severity: bandSeverity(entry.severity),
			header_key: '',
			header_text: entry.header_text ?? undefined,
			header_text_en: entry.header_text_en ?? undefined,
		};
		return alertDisplayText(shaped, locale);
	}
	/** A localized wall-clock for a window bound, or null when absent/invalid. */
	function windowTime(iso: string | null | undefined): string | null {
		if (iso == null) return null;
		const text = formatUtc(iso, locale);
		return text === '·' ? null : text; // formatUtc's no-data middot → drop the line
	}

	// The filtered, newest-first log.
	const filtered = $derived<readonly AlertHistoryEntry[]>(
		filterAlertLog(sorted, {
			window: pickedWindow ?? null,
			affects: affects === 'all' ? null : affects,
			severity: severity === 'all' ? null : severity,
			route,
			stop,
		}),
	);
	const hasMatches = $derived(filtered.length > 0);
	const overflow = $derived(Math.max(0, filtered.length - VISIBLE_CAP));
	const visibleEntries = $derived(
		expanded || overflow === 0 ? filtered : filtered.slice(0, VISIBLE_CAP),
	);
	const visibleRows = $derived<readonly AlertRowVM[]>(
		visibleEntries.map((e) => buildAlertRow(e, { headline, windowTime })),
	);

	// The picker options (distinct lines / stops present in the FULL sorted log — a pick
	// stays available even after other axes narrow the visible list).
	const lineOptions = $derived(buildLineOptions(sorted, foldSearchText));
	const stopOptions = $derived(buildStopOptions(sorted, foldSearchText));

	const filtersActive = $derived(
		affects !== 'all' ||
			severity !== 'all' ||
			route != null ||
			stop != null ||
			pickedWindow != null,
	);
	function clearFilters(): void {
		affects = 'all';
		severity = 'all';
		route = null;
		stop = null;
		pickedWindow = undefined;
	}

	// --- In-window headline (ExplainedMetricCard) -------------------------------
	// The count of alerts matching the current filters + their median resolved duration.
	const headlineCount = $derived(filtered.length);
	const headlineMedian = $derived.by<number | null>(() => {
		const durations = filtered
			.map((e) => e.duration_min)
			.filter((d): d is number => d != null && Number.isFinite(d));
		return medianOf(durations);
	});
	const headlineSublabel = $derived(
		headlineMedian != null ? t.headline.median(Math.round(headlineMedian)) : undefined,
	);

	// Freshness off the archive's generated_utc (a daily rebuild, not live).
	const generatedUtc = $derived(history.data?.generated_utc ?? null);

	// Honest cap disclosure: the payload's truncated flag + the true total-in-window.
	// The 'shown' count is the SERVED entry count (the population the newest-first
	// server cap actually clipped) — never the client-filtered subset, which would
	// misread as 'the N most recent' under an active filter (S15 review F1).
	const truncated = $derived(history.data?.truncated === true);
	const totalInWindow = $derived(history.data?.total_in_window ?? null);

	// --- Tier-2 breakdown -------------------------------------------------------
	const SEVERITY_WORD_SET = new Set<string>(['critical', 'high', 'watch']);
	/** Localized title for a breakdown bucket key, per distribution kind. */
	function bucketTitle(key: string, kind: BreakdownKind): string {
		if (kind === 'severity') {
			return SEVERITY_WORD_SET.has(key) ? t.severity[key as SeverityCode] : key;
		}
		if (key.trim().toLowerCase() === 'unknown') return t.breakdown.unspecified;
		const resolved = kind === 'cause' ? causeLabel(key, locale) : effectLabel(key, locale);
		return resolved ?? t.breakdown.unspecified;
	}
	const breakdownResolvers = $derived({
		bucketTitle,
		countDisplay: (n: number) => t.breakdown.buckets(n),
		medianSubtitle: (min: number) => t.breakdown.median(min),
	});
	const causeRows = $derived(
		toBreakdownRows(history.data?.breakdown?.by_cause, 'cause', breakdownResolvers),
	);
	const effectRows = $derived(
		toBreakdownRows(history.data?.breakdown?.by_effect, 'effect', breakdownResolvers),
	);
	const severityRows = $derived(
		toBreakdownRows(history.data?.breakdown?.by_severity, 'severity', breakdownResolvers),
	);
	const hasBreakdown = $derived(
		causeRows.length > 0 || effectRows.length > 0 || severityRows.length > 0,
	);

	const uid = $props.id();
	const logId = `alert-history-log-${uid}`;
</script>

{#snippet headlineInfo()}
	<!-- Wired to the alert-duration explainer: the honest deep link replaces the surface's
	     only bare `/metrics` href (its lone convention break) with metricInfoFor('alertDuration'). -->
	{@const i = info('alertDuration', t.headline.label)}
	<MetricInfo tip={i.tip} href={i.href} label={i.label} linkLabel={i.linkLabel} side="bottom" />
{/snippet}

<!-- The five supplemental alert* explainer tips, each wired onto its heading. cause/effect/
     severity ride the three breakdown sub-headings; reach rides the log section (its rows
     carry the affected-lines/stops counts). duration rides the headline card above. -->
{#snippet causeInfo()}
	{@const i = info('alertCause', t.breakdown.byCause)}
	<MetricInfo tip={i.tip} href={i.href} label={i.label} linkLabel={i.linkLabel} side="bottom" />
{/snippet}
{#snippet effectInfo()}
	{@const i = info('alertEffect', t.breakdown.byEffect)}
	<MetricInfo tip={i.tip} href={i.href} label={i.label} linkLabel={i.linkLabel} side="bottom" />
{/snippet}
{#snippet severityInfo()}
	{@const i = info('alertSeverity', t.breakdown.bySeverity)}
	<MetricInfo tip={i.tip} href={i.href} label={i.label} linkLabel={i.linkLabel} side="bottom" />
{/snippet}
{#snippet reachInfo()}
	{@const i = info('alertReach', t.meta.routes)}
	<MetricInfo tip={i.tip} href={i.href} label={i.label} linkLabel={i.linkLabel} side="bottom" />
{/snippet}

<Surface class="alert-history">
	<Masthead kicker={t.kicker} heading={t.heading} subheading={t.subheading} lede={t.lede}>
		{#snippet meta()}
			<FreshnessStamp variant="updated" {generatedUtc} {locale} />
		{/snippet}
	</Masthead>

	<!-- HONEST ABSENCE: a zero-length alert archive is the GOOD empty — the network ran
	     normally with no disruptions. Route it to the green network-healthy verdict. -->
	<ResourceBoundary
		resource={history}
		lang={locale}
		isEmpty={(d: AlertHistory) => (d.alerts?.length ?? 0) === 0}
		emptyVariant="empty-avis"
	>
		<!-- In-window headline: the alerts-in-window count + median duration. -->
		<div class="alert-history-headline" data-slot="alert-headline">
			<ExplainedMetricCard
				label={t.headline.label}
				value={t.headline.value(headlineCount)}
				explanation={t.headline.explanation}
				sublabel={headlineSublabel}
				info={headlineInfo}
				{locale}
			/>
		</div>

		<Separator variant="hazard" />

		<!-- REORDER (§C5.13): analytics BEFORE the stream. The Tier-2 cause/effect/severity
		     distribution reads first so the citizen gets the SHAPE of the archive before the
		     25-row chronological log. cause/effect/severity headings carry their (i) tips. -->
		<AlertBreakdown
			{causeRows}
			{effectRows}
			{severityRows}
			{hasBreakdown}
			copy={t}
			{locale}
			{causeInfo}
			{effectInfo}
			{severityInfo}
		/>

		<Separator variant="hazard" />

		<div class="alert-history-block">
			<div class="alert-history-head">
				<SectionHeading level={2} overline={t.logSection} explainer={reachInfo} />
				<span class="alert-history-count" data-slot="alert-count">
					{t.count(visibleRows.length, filtered.length)}
				</span>
			</div>

			{#if truncated && totalInWindow != null}
				<!-- Honest cap disclosure: the served window was capped newest-first. -->
				<p class="alert-history-truncated" data-slot="alert-truncated">
					{t.truncatedNote(entries.length, totalInWindow)}
				</p>
			{/if}

			<AlertFilters
				bind:affects
				bind:severity
				bind:route
				bind:window={pickedWindow}
				bind:stop
				{lineOptions}
				{stopOptions}
				{availableDates}
				{filtersActive}
				matchCount={filtered.length}
				copy={t}
				{locale}
				onClear={clearFilters}
			/>

			{#if !hasMatches}
				<!-- Honest no-match: the active filters narrowed the log to zero. -->
				<p class="alert-history-no-match" data-slot="alert-no-match">{t.filters.noMatch}</p>
			{:else}
				<AlertLog
					rows={visibleRows}
					total={filtered.length}
					{expanded}
					{overflow}
					{logId}
					copy={t}
					onToggle={() => (expanded = !expanded)}
				/>
			{/if}
		</div>
	</ResourceBoundary>
</Surface>

<style>
	/* §C5.13: the surface caps at the content lane (no full-bleed — width="bleed" was
	   dropped with A1). The analytics + log read as one column, matching the 52rem log. */
	:global([data-slot='surface'].alert-history) {
		max-width: var(--container-content);
	}
	.alert-history-headline {
		margin-bottom: 0.25rem;
	}
	.alert-history-block {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	/* Section label + the capped-count caption on one row. */
	.alert-history-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.25rem 1rem;
	}
	.alert-history-count {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
		font-variant-numeric: tabular-nums;
	}
	/* Honest cap note — quiet mono caption. */
	.alert-history-truncated {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	/* Honest no-match note — quiet mono caption, never an empty void or a "·". */
	.alert-history-no-match {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
</style>
