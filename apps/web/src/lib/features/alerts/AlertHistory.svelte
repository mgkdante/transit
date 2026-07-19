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

	  ARTICLE: DetailShell owns one combined filters/contents rail and the shared section
	  registry drives both the numbered TOC and the three disclosure cards. The server
	  breakdown is only the availability signal; current filters derive every rendered
	  cause/effect/severity bucket from the matching alert entries.

  HONESTY: a null/absent field is OMITTED; a generic/empty headline falls back to the
  shared "Service alert"; an empty archive routes to the localized empty state; the
  breakdown stands down when no distribution was published; a truncated window shows
  an honest cap note. Tokens only, no hex. All prose is in ./alerts.copy.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { getLocale, localizeHref, type Locale } from '$lib/i18n';
	import { getAlertArchiveIndex, getAlertArchiveRange, getAlertHistory } from '$lib/v1';
	import type {
		AlertArchiveEntry,
		AlertHistory,
		AlertHistoryEntry,
		SeverityCode,
	} from '$lib/v1/schemas';
	import { createResource, type Resource } from '$lib/v1/resource.svelte';
	import {
		availabilityFromAlertIndex,
		datesForAvailability,
		type HistoryAvailability,
		type HistoryCorrection,
	} from '$lib/v1/history';
	import { formatDateKey, formatUtc } from '$lib/utils/time';
	import { fromSearchParams, type AlertAffects, type DateWindow } from '$lib/filters';
	import { mirrorSearchParams } from '$lib/site/urlMirror';
	import {
		ArticleControlDisclosure,
		createRailDisclosureController,
		ResourceBoundary,
	} from '$lib/components/surface';
	import {
		ArticleHeader,
		ArticleSectionStack,
		DetailShell,
		type ArticleMetaEntry,
	} from '$lib/components/layout';
	import { StateNotice } from '$lib/components/edge';
	import {
		CollapsibleSection,
		TocNav,
		reconcileActiveToc,
		revealTocTarget,
		type TocEntry,
	} from '$lib/components/shared';
	import QuietModeButton from '$lib/components/shared/QuietModeButton.svelte';
	import { quietModeStore } from '$lib/stores/quiet-mode.svelte';
	import { prefersReducedMotion } from '@yesid/motion/stores/reducedMotion';
	import type { SurfaceRailContext } from '$lib/components/surface/SurfaceRail.svelte';
	import { ExplainedMetricCard } from '$lib/components/dataviz';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type SupplementalMetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	// The shared alert vocabulary, now in the $lib/v1 kernel (no cross-feature import).
	import { alertDisplayText } from '$lib/v1/alertDisplay';
	import { causeLabel, effectLabel } from '$lib/v1/gtfsAlertLabels';
	import { foldSearchText } from '$lib/search/normalize';

	import {
		sortNewestFirst,
		filterAlertLog,
		buildAlertRow,
		summarizeAlertBreakdown,
		toBreakdownRows,
		medianOf,
		type BreakdownKind,
		type AlertRowVM,
	} from './selectors/alertLog';
	import { buildLineOptions, buildStopOptions } from './selectors/entityOptions';
	import AlertFilters from './sections/AlertFilters.svelte';
	import AlertLog from './sections/AlertLog.svelte';
	import AlertBreakdown from './sections/AlertBreakdown.svelte';
	import { alertHistoryCopy } from './alerts.copy';
	import {
		currentAlertWindow,
		resolveAlertHistoryRange,
		sameHistoryWindow,
	} from './data/historySelection';

	const locale: Locale = getLocale();
	const t = $derived(alertHistoryCopy[locale]);
	const railDisclosures = createRailDisclosureController({
		filters: 'alerts-filters',
		toc: 'alerts-toc',
	});

	// The metric-explainer (i) affordance: a one-line tip + a localized deep link to
	// /metrics#<anchor>. Wires the five supplemental alert* dimensions (cause/effect/
	// severity/duration/reach) onto their headings — the SAME `info()` shape every
	// other surface uses (NetworkSurface / RouteDetail / StopReliabilitySurface).
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: SupplementalMetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});

	// The current compatibility payload stays the fast default and supplies the honest
	// current span. The optional retained index decides whether range reads come from
	// partitioned archive pages or keep the legacy newest-window behavior.
	const history = createResource((signal) => getAlertHistory({ signal }), { freshness: true });
	const alertArchiveIndex = createResource((signal) => getAlertArchiveIndex({ signal }), {
		freshness: true,
	});

	/** Max rows rendered before the "+N more" disclosure. */
	const VISIBLE_CAP = 25;
	let expanded = $state(false);

	// --- Codec seed (ONCE) ------------------------------------------------------
	const rawHistoryFrom = page.url.searchParams.get('from');
	const rawHistoryTo = page.url.searchParams.get('to');
	const hasExplicitHistoryWindow = rawHistoryFrom !== null || rawHistoryTo !== null;
	const seed = fromSearchParams(page.url.searchParams);
	// Entity-type + severity are single-select scalars (absent = "all").
	let affects = $state<'all' | AlertAffects>(seed.alertAffects ?? 'all');
	let severity = $state<'all' | SeverityCode>(seed.alertSeverity ?? 'all');
	// The Line / Stop picks reuse the existing ?route/?stop id-set axes (first id; the
	// pickers are single-select), the StopsIndex precedent.
	let route = $state<string | null>([...seed.routes][0] ?? null);
	let stop = $state<string | null>([...seed.stops][0] ?? null);
	let pickedWindow = $state<DateWindow | undefined>();
	let defaultWindow = $state<DateWindow | null>(null);
	let historyCorrection = $state<HistoryCorrection | null>(null);
	let windowSettled = $state(false);
	$effect(() => {
		if (windowSettled) return;
		if (!history.settled || !alertArchiveIndex.settled) return;
		if (history.error != null || alertArchiveIndex.error != null || history.data == null) return;

		defaultWindow = currentAlertWindow(history.data, alertArchiveIndex.data);
		const resolved = resolveAlertHistoryRange(
			history.data,
			alertArchiveIndex.data,
			rawHistoryFrom,
			rawHistoryTo,
		);
		pickedWindow = resolved.selection ?? undefined;
		historyCorrection = resolved.correction;
		windowSettled = true;
	});

	const historyAvailability = $derived.by<HistoryAvailability>(() => {
		const indexed = availabilityFromAlertIndex(alertArchiveIndex.data);
		if (indexed != null) return indexed;
		if (defaultWindow != null) {
			return {
				kind: 'continuous',
				firstDate: defaultWindow.from,
				lastDate: defaultWindow.to,
				gaps: [],
			};
		}
		return { kind: 'empty' };
	});
	const availableDates = $derived<readonly string[]>(datesForAvailability(historyAvailability));

	function windowKey(window: DateWindow): string {
		return `${window.from}:${window.to}`;
	}

	// A paired date edit fires once for each field. Abort the old read immediately,
	// then wait for the short edit burst to settle so From + To issue one range load.
	const RANGE_CHANGE_DEBOUNCE_MS = 120;
	let archiveLoadWindow = $state<DateWindow | null>(null);
	let archiveLoadPrimed = false;
	$effect(() => {
		const selection = pickedWindow;
		if (!windowSettled || alertArchiveIndex.data == null || selection == null) {
			archiveLoadWindow = null;
			return;
		}

		const next = { from: selection.from, to: selection.to };
		if (!archiveLoadPrimed) {
			archiveLoadPrimed = true;
			archiveLoadWindow = next;
			return;
		}
		if (
			sameHistoryWindow(
				untrack(() => archiveLoadWindow),
				next,
			)
		)
			return;

		archiveLoadWindow = null;
		const timer = window.setTimeout(() => {
			archiveLoadWindow = next;
		}, RANGE_CHANGE_DEBOUNCE_MS);
		return () => window.clearTimeout(timer);
	});

	interface SelectedAlertRange {
		readonly window: DateWindow;
		readonly entries: readonly AlertArchiveEntry[];
		readonly generated_utc?: AlertHistory['generated_utc'] | null;
	}
	let rangeAttemptKey: string | null = null;
	const archiveRange = createResource<SelectedAlertRange | null>(
		async (signal) => {
			const index = alertArchiveIndex.data;
			const selection = archiveLoadWindow;
			if (!windowSettled || index == null || selection == null) {
				rangeAttemptKey = null;
				return null;
			}

			const requestedWindow = { from: selection.from, to: selection.to };
			rangeAttemptKey = windowKey(requestedWindow);
			const rangeEntries = await getAlertArchiveRange(index, requestedWindow, { signal });
			return {
				window: requestedWindow,
				entries: rangeEntries,
				generated_utc: history.data?.generated_utc ?? null,
			};
		},
		{ freshness: true },
	);

	const selectedRangeData = $derived.by<SelectedAlertRange | null>(() => {
		if (alertArchiveIndex.data == null || pickedWindow == null) return null;
		const value = archiveRange.data;
		return value != null && sameHistoryWindow(value.window, pickedWindow) ? value : null;
	});
	const catalogLoading = $derived(
		history.loading ||
			alertArchiveIndex.loading ||
			!history.settled ||
			!alertArchiveIndex.settled ||
			!windowSettled,
	);
	const useCompatibilityPayload = $derived.by(() => {
		if (history.data == null || history.error != null) return false;
		if (alertArchiveIndex.error != null) return false;
		if (alertArchiveIndex.settled && alertArchiveIndex.data == null) return true;
		// Until the advertised range confirms it, an empty compatibility array is
		// not enough evidence for a citizen-facing "0 alerts" result.
		if ((history.data.alerts?.length ?? 0) === 0) return false;
		if (hasExplicitHistoryWindow) return false;
		if (!alertArchiveIndex.settled) return true;
		if (
			!windowSettled ||
			pickedWindow == null ||
			defaultWindow == null ||
			!sameHistoryWindow(pickedWindow, defaultWindow)
		) {
			return false;
		}
		const rangeError = archiveRange.error;
		if (rangeAttemptKey === windowKey(pickedWindow) && rangeError != null) return false;
		return selectedRangeData == null;
	});
	const previewingArchive = $derived(
		useCompatibilityPayload &&
			history.data?.truncated === true &&
			alertArchiveIndex.data != null &&
			selectedRangeData == null,
	);
	const displayError = $derived.by<Error | null>(() => {
		// Read this unconditionally so a rejection wakes the derived value even when a
		// just-changed selection briefly sees the preceding attempt key.
		const rangeError = archiveRange.error;
		if (history.error != null) return history.error;
		if (alertArchiveIndex.error != null) return alertArchiveIndex.error;
		if (catalogLoading || alertArchiveIndex.data == null || pickedWindow == null) return null;
		return rangeAttemptKey === windowKey(pickedWindow) ? rangeError : null;
	});
	const displayLoading = $derived.by(() => {
		if (displayError != null) return false;
		if (useCompatibilityPayload) return false;
		if (catalogLoading) return true;
		if (alertArchiveIndex.data == null || pickedWindow == null) return false;
		const matchingRange = selectedRangeData;
		return (
			archiveRange.loading ||
			!archiveRange.settled ||
			rangeAttemptKey !== windowKey(pickedWindow) ||
			matchingRange == null
		);
	});

	interface AlertHistoryView {
		readonly entries: readonly AlertHistoryEntry[];
	}
	const displayData = $derived.by<AlertHistoryView | null>(() => {
		if (displayError != null || history.data == null) return null;
		if (useCompatibilityPayload) return { entries: history.data.alerts ?? [] };
		if (displayLoading) return null;
		if (alertArchiveIndex.data == null) return { entries: history.data.alerts ?? [] };
		if (pickedWindow == null) return { entries: [] };
		return selectedRangeData == null ? null : { entries: selectedRangeData.entries };
	});
	const displayResource: Resource<AlertHistoryView> = {
		get data() {
			return displayData;
		},
		get error() {
			return displayError;
		},
		get loading() {
			return displayLoading;
		},
		get settled() {
			return !displayLoading;
		},
		reload() {
			if (
				history.error != null ||
				alertArchiveIndex.error != null ||
				!history.settled ||
				!alertArchiveIndex.settled
			) {
				history.reload();
				alertArchiveIndex.reload();
				return;
			}
			if (alertArchiveIndex.data != null && pickedWindow != null) archiveRange.reload();
			else {
				history.reload();
				alertArchiveIndex.reload();
			}
		},
	};

	// Every calculation reads one display array. The fast compatibility payload may
	// render while the default retained range finishes, then the archive array swaps
	// in atomically; a user-selected non-default range never inherits stale rows.
	const entries = $derived<readonly AlertHistoryEntry[]>(displayData?.entries ?? []);
	const sorted = $derived(sortNewestFirst(entries));
	const historyCoverageText = $derived.by<string | null>(() => {
		if (historyAvailability.kind !== 'continuous') return null;
		return t.filters.history.coverage(
			formatDateKey(historyAvailability.firstDate, locale),
			formatDateKey(historyAvailability.lastDate, locale),
		);
	});
	const historySelectionText = $derived(
		pickedWindow == null
			? null
			: t.filters.history.selection(
					formatDateKey(pickedWindow.from, locale),
					formatDateKey(pickedWindow.to, locale),
				),
	);
	const historyAnnouncement = $derived(
		historyCorrection == null ? null : t.filters.history.correction[historyCorrection.reason],
	);

	function selectHistoryWindow(next: DateWindow | undefined): void {
		historyCorrection = null;
		if (!windowSettled) return;
		if (next == null) {
			pickedWindow = defaultWindow ?? undefined;
			return;
		}
		if (history.data == null) return;
		const resolved = resolveAlertHistoryRange(
			history.data,
			alertArchiveIndex.data,
			next.from,
			next.to,
		);
		pickedWindow = resolved.selection ?? defaultWindow ?? undefined;
		historyCorrection = resolved.correction;
	}

	// --- Batched URL mirror -----------------------------------------------------
	// ONE mirrorSearchParams so back-to-back single writes never clobber each other.
	// 'all'/null/undefined null out the key for a clean canonical URL.
	$effect(() => {
		if (!windowSettled) return;
		const mirroredWindow =
			pickedWindow != null && !sameHistoryWindow(pickedWindow, defaultWindow) ? pickedWindow : null;
		mirrorSearchParams({
			affects: affects === 'all' ? null : affects,
			severity: severity === 'all' ? null : severity,
			route: route,
			stop: stop,
			from: mirroredWindow?.from ?? null,
			to: mirroredWindow?.to ?? null,
		});
	});

	// --- ONE mapping pass -------------------------------------------------------
	/** The headline for a history entry, via the SAME resolver the live surfaces use. */
	function headline(entry: AlertHistoryEntry): string {
		return alertDisplayText(entry, locale);
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
	const readyMatchCount = $derived(displayData == null ? null : filtered.length);
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
			!sameHistoryWindow(pickedWindow, defaultWindow),
	);
	function clearFilters(): void {
		affects = 'all';
		severity = 'all';
		route = null;
		stop = null;
		pickedWindow = defaultWindow ?? undefined;
		historyCorrection = null;
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
	const truncated = $derived(
		useCompatibilityPayload && history.data?.truncated === true && !previewingArchive,
	);
	const totalInWindow = $derived(
		useCompatibilityPayload ? (history.data?.total_in_window ?? null) : null,
	);

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
	const breakdownPublished = $derived(
		alertArchiveIndex.data != null
			? entries.length > 0
			: history.data?.breakdown != null &&
					((history.data.breakdown.by_cause?.length ?? 0) > 0 ||
						(history.data.breakdown.by_effect?.length ?? 0) > 0 ||
						(history.data.breakdown.by_severity?.length ?? 0) > 0),
	);
	const filteredBreakdown = $derived(summarizeAlertBreakdown(filtered));
	const causeRows = $derived(
		toBreakdownRows(filteredBreakdown.by_cause, 'cause', breakdownResolvers),
	);
	const effectRows = $derived(
		toBreakdownRows(filteredBreakdown.by_effect, 'effect', breakdownResolvers),
	);
	const severityRows = $derived(
		toBreakdownRows(filteredBreakdown.by_severity, 'severity', breakdownResolvers),
	);
	const hasBreakdown = $derived(
		causeRows.length > 0 || effectRows.length > 0 || severityRows.length > 0,
	);
	const archiveReady = $derived(displayData != null && entries.length > 0);
	const controlsReady = $derived(
		windowSettled && (availableDates.length > 0 || entries.length > 0),
	);
	const sectionDefs = $derived([
		{
			id: 'alerts-window',
			sectionKey: 'alerts-card-window',
			number: 1,
			title: t.cards.window.title,
			subtitle: t.cards.window.subtitle,
			present: archiveReady,
		},
		{
			id: 'alerts-breakdown',
			sectionKey: 'alerts-card-breakdown',
			number: 2,
			title: t.cards.breakdown.title,
			subtitle: t.cards.breakdown.subtitle,
			present: archiveReady && breakdownPublished,
		},
		{
			id: 'alerts-log',
			sectionKey: 'alerts-card-log',
			number: 3,
			title: t.cards.log.title,
			subtitle: t.cards.log.subtitle,
			present: archiveReady,
		},
	]);
	const tocEntries = $derived<TocEntry[]>(
		sectionDefs
			.filter((section) => section.present)
			.map((section) => ({
				id: section.id,
				title: section.title,
				level: 2,
				badge: { kind: 'number' as const, value: section.number },
				children: [],
			})),
	);
	const openableAnchors = $derived(new Set(tocEntries.map((entry) => entry.id)));
	const articleMeta = $derived.by((): readonly ArticleMetaEntry[] => {
		const meta: ArticleMetaEntry[] = [];
		if (generatedUtc) {
			meta.push({
				text: formatUtc(generatedUtc, locale),
				datetime: generatedUtc,
				label: t.asOf,
			});
		}
		if (displayData != null) {
			meta.push(t.article.matches(filtered.length));
			meta.push(t.article.sections(tocEntries.length));
		}
		return meta;
	});

	let activeId = $state('');
	let cardOpenSignals = $state<Record<string, number>>({});
	let navigationGeneration = 0;
	let previousTocIds: string[] = [];
	function openCard(id: string): void {
		cardOpenSignals = {
			...cardOpenSignals,
			[id]: (cardOpenSignals[id] ?? 0) + 1,
		};
	}
	function cardOpenSignal(id: string): number {
		return quietModeStore.openSignal + (cardOpenSignals[id] ?? 0);
	}
	async function navigate(id: string): Promise<void> {
		const generation = ++navigationGeneration;
		await revealTocTarget(id, {
			beforeReveal: openableAnchors.has(id) ? openCard : undefined,
			isCurrent: () => generation === navigationGeneration,
			behavior: $prefersReducedMotion ? 'auto' : 'smooth',
		});
	}
	$effect(() => {
		const next = tocEntries.map((entry) => entry.id);
		activeId = reconcileActiveToc(activeId, previousTocIds, next);
		previousTocIds = next;
	});

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

<p
	class="sr-only"
	data-slot="history-page-announcement"
	role="status"
	aria-live="polite"
	aria-atomic="true"
>
	{historyAnnouncement ?? ''}
</p>

<DetailShell
	class="alert-history-detail"
	bind:activeId
	{tocEntries}
	combinedRailConfig={controlsReady
		? {
				label: t.rail.label,
				summary: readyMatchCount == null ? undefined : t.filters.pillSummary(readyMatchCount),
				openAria: t.rail.open,
				closeAria: t.rail.close,
			}
		: undefined}
>
	{#snippet articleHeader()}
		<ArticleHeader
			watermark={t.article.watermark}
			category={t.kicker}
			title={t.heading}
			tags={t.article.tags}
			tagsAria={t.article.tagsAria}
			backHref={localizeHref('/', locale)}
			backLabel={t.article.back}
			meta={articleMeta}
			metaPending={displayResource.loading || !displayResource.settled}
			titleId="alerts-title"
		>
			{#snippet controls()}
				<QuietModeButton />
			{/snippet}
		</ArticleHeader>
	{/snippet}

	{#snippet combinedRail({ closeSheet }: SurfaceRailContext)}
		<ArticleControlDisclosure
			title={t.filters.railLabel}
			bind:open={
				() => railDisclosures.isOpen('filters'), (next) => railDisclosures.set('filters', next)
			}
		>
			<AlertFilters
				bind:affects
				bind:severity
				bind:route
				window={pickedWindow}
				bind:stop
				{lineOptions}
				{stopOptions}
				{availableDates}
				{filtersActive}
				matchCount={readyMatchCount}
				copy={t}
				{locale}
				{historyCoverageText}
				{historySelectionText}
				{historyAnnouncement}
				onWindowChange={selectHistoryWindow}
				onClear={clearFilters}
			/>
		</ArticleControlDisclosure>
		{#if tocEntries.length > 0}
			<div class="alert-history-rail-toc" data-slot="section-toc">
				<TocNav
					entries={tocEntries}
					{activeId}
					heading={t.rail.toc}
					counterPrefix={t.rail.counterPrefix}
					bind:open={
						() => railDisclosures.isOpen('toc'), (next) => railDisclosures.set('toc', next)
					}
					onNavigate={(id) => {
						closeSheet();
						void navigate(id);
					}}
				/>
			</div>
		{/if}
	{/snippet}

	{#snippet center()}
		<!-- HONEST ABSENCE: a zero-length alert archive is the GOOD empty — the network ran
		     normally with no disruptions. Route it to the green network-healthy verdict. -->
		<ResourceBoundary
			resource={displayResource}
			lang={locale}
			isEmpty={(d: AlertHistoryView) => d.entries.length === 0}
			emptyVariant="empty-avis"
		>
			<ArticleSectionStack data-slot="alert-sections">
				{#if previewingArchive}
					<p class="alert-history-preview" data-slot="alert-archive-preview" role="status">
						{t.archivePreviewNote(entries.length)}
					</p>
				{/if}
				{#each sectionDefs as section (section.id)}
					{#if section.present}
						<CollapsibleSection
							title={section.title}
							subtitle={section.subtitle}
							headerVariant="article-summary"
							anchor={section.id}
							sectionKey={section.sectionKey}
							index={section.number - 1}
							open={true}
							closeSignal={quietModeStore.closeSignal}
							openSignal={cardOpenSignal(section.id)}
							bulkCollapsed={quietModeStore.enabled}
						>
							{#if section.id === 'alerts-window'}
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
							{:else if section.id === 'alerts-breakdown'}
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
							{:else}
								<div class="alert-history-content" data-slot="alert-log-content">
									<div class="alert-history-head">
										<SectionHeading level={3} overline={t.logSection} explainer={reachInfo} />
										<span class="alert-history-count" data-slot="alert-count">
											{t.count(visibleRows.length, filtered.length)}
										</span>
									</div>

									{#if truncated && totalInWindow != null}
										<p class="alert-history-truncated" data-slot="alert-truncated">
											{t.truncatedNote(entries.length, totalInWindow)}
										</p>
									{/if}

									{#if !hasMatches}
										<StateNotice
											title={t.filters.noMatch}
											presentation="silo"
											role="status"
											ariaLive="polite"
											data-slot="alert-no-match"
										/>
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
							{/if}
						</CollapsibleSection>
					{/if}
				{/each}
			</ArticleSectionStack>
		</ResourceBoundary>
	{/snippet}
</DetailShell>

<style>
	.alert-history-rail-toc {
		margin-top: 0.25rem;
	}
	.alert-history-headline {
		margin-bottom: 0.25rem;
	}
	.alert-history-preview {
		margin: 0;
		padding: 0.75rem 1rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.5;
		color: var(--secondary-foreground);
		background: color-mix(in srgb, var(--accent) 8%, transparent);
		border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
		border-radius: var(--radius-sm);
	}
	.alert-history-content {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
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
</style>
