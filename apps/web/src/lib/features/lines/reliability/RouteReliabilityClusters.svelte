<!--
  RouteReliabilityClusters — the composed slice-9.6 historic Reliability surface
  (approach B: one band per cluster). This is the single component a route mounts;
  it owns the control spine and stitches the snapshot strip + the five numbered
  cluster bands into one edge-to-edge column.

  Shape:
    - a control spine (grain selector: Today / This week / This month + a
      specific-date affordance) drives WHICH grain the snapshot strip answers
      for. The headline answer is visible with ZERO interaction (the default
      grain, 'day'); the control only refines it.
    - `toReliabilityClusters(data, { grain })` is called ONCE ($derived) and each
      slice is handed to its band — the bands are pure presenters of their VM.
    - the full-bleed SnapshotStrip first, then bands 01→05 in order, each its own
      band with the mono numbered overline (the bands own their SectionLabel).

  HONESTY DOCTRINE (inherited from the VMs + enforced here):
    - a cluster whose VM `isEmpty` STILL renders its band (with the band's own
      no-data note) — never silently dropped. We render all six unconditionally.
    - the grain control never fabricates data: selecting a grain the contract has
      no period for resolves (via the mapper) to the first period, and an absent
      metric stays null → the band shows its honest empty, never a fake 0.

  Bilingual: FR is the canonical product voice. `locale` is threaded as a prop
  and the co-located `reliabilityCopy` bundle is passed to every band, so no band
  performs its own i18n lookup. Reduced-motion is honoured by the primitives.
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import { formatDateKey } from '$lib/utils/time';
	import { page } from '$app/state';
	import { mirrorSearchParams } from '$lib/site/urlMirror';
	import {
		fromSearchParams,
		toSearchParams,
		emptyFilterState,
		resolveWindow,
		type DateWindow,
	} from '$lib/filters';
	import type { Locale } from '$lib/i18n';
	import { describeAbsence } from '$lib/site/absence';
	import {
		availabilityFromCollectionIndex,
		datesForAvailability,
		historyRangeRequestFromSearchParams,
		type RawHistoryRangeRequest,
		type RouteReliability,
	} from '$lib/v1';
	import { SvelteSet } from 'svelte/reactivity';
	import { onMount } from 'svelte';
	import {
		GrainPicker,
		HistoryNavigator,
		SurfaceRail,
		type GrainSegment,
	} from '$lib/components/surface';
	import { observeActiveToc, TocNav, type TocEntry } from '$lib/components/shared';
	import { Button } from '$lib/components/ui/button';
	import { toReliabilityClusters } from './clusters';
	import { reliabilityCopy } from './reliability.copy';
	import { applyRetainedLineHistory, clearRetainedLineHistory } from './data/retainedHistory';
	import type { LineHistoryResource } from './data/lineHistoryResource.svelte';
	import Section0Verdict from './sections/Section0Verdict.svelte';
	import Section1WhenToRide from './sections/Section1WhenToRide.svelte';
	import Section2TheWait from './sections/Section2TheWait.svelte';
	import Section3RunAndFit from './sections/Section3RunAndFit.svelte';
	import Section4WorstStops from './sections/Section4WorstStops.svelte';

	interface RouteReliabilityClustersProps {
		/** The raw historic reliability archive for this route. */
		data: RouteReliability;
		/** Active locale (FR canonical) — threaded to every band, not looked up here. */
		locale: Locale;
		/**
		 * dir (GTFS direction_id) → real destination headsign, from the static route file.
		 * Lets the direction-keyed bands name directions the way a rider reads them ("Est"),
		 * not "Direction 0/1". Empty record → bands fall back to a neutral "Direction N".
		 */
		directionHeadsigns?: Record<number, string>;
		/** Optional extra class for the surface column. */
		class?: string;
		/** Route-keyed retained range resource, owned by RouteDetail. */
		history?: LineHistoryResource;
	}

	let {
		data,
		locale,
		directionHeadsigns = {},
		class: className,
		history,
	}: RouteReliabilityClustersProps = $props();

	const copy = $derived(reliabilityCopy[locale]);

	/* ── control spine ────────────────────────────────────────────────────────
	   The grain the snapshot strip answers for. The headline shows with ZERO
	   interaction at the default 'day' grain; the control only refines.

	   The three discrete grains map to free-string contract grains the mapper
	   selects against. "Date range" is an affordance that swaps in a start+end
	   pair of <select>s over the dated day-periods the contract actually carries.
	   start == end is a single day (exact, with percentiles); a wider span shows
	   the MEAN on-time/avg-delay across the in-range days (percentiles are not
	   averageable → a no-data mark) and zooms the trend to the range. A range the
	   archive has no day for fabricates nothing — the mapper falls back honestly.

	   The discrete grains + the lines-only "Date range" affordance now ride ONE
	   SHARED GrainPicker (seated in a ControlsRail) as a single mutually-exclusive
	   radiogroup: day | week | month | range. Folding range into the SAME control
	   guarantees EXACTLY ONE active chip at a time — selecting range deselects the
	   grain (and vice-versa), with no competing dual highlight — and keeps the
	   control a single a11y-correct radiogroup. `viewKey` is the one binding; the
	   effective window `mode` IS `viewKey`. The "range" segment is offered only when
	   the contract carries dated day-periods (else there is nothing to range over).

	   The reliability surface OWNS ?grain + ?from/?to (the rail lives here): seed the selection from
	   ?grain (and the custom range from ?from/?to) on load + mirror them back, so a windowed OR
	   date-range view is shareable/deep-linkable. The URL is a HINT, never a data source — an unknown
	   or unavailable grain is clamped to 'day', a ?from/?to bound the contract has no day for is
	   dropped, and a complete valid from+to implies range intent (the availability clamp below).
	   replaceState (not pushState) keeps view switches out of the history stack. */
	type GrainMode = 'day' | 'week' | 'month' | 'range';
	// S7.5 P1: the URL layer is now the SHARED $lib/filters codec — parse ?grain/?from/?to ONCE
	// through fromSearchParams (drops a legacy ?grain=range, which is not a Grain; folds ?from/?to
	// into a normalized {from,to} window). The rail keeps its own GrainMode UI (day|week|month|range
	// radiogroup + range dropdowns); 'range' is a UI mode, NOT a Grain — it is DERIVED from
	// window-presence, exactly as the codec models it. The seed reads the codec, then the availability
	// clamp below validates the window against the real dated window (resolveWindow).
	const seed = fromSearchParams(page.url.searchParams);
	// The legacy lines-only ?grain=range token is NOT a Grain (the codec drops it), but the rail
	// still honours it as its UI range-mode hint so a deep-linked ?grain=range shows the range
	// affordance (and its "pick a start and end date" prompt) even before both bounds are picked —
	// preserving today's behaviour. A complete window (?from&?to) implies range mode regardless.
	// The EXPLICIT legacy ?grain=range token — the deliberate "range intent" half-pick hint,
	// distinct from range implied ONLY by a decoded ?from/?to window. We keep it separate so the
	// availability clamp can tell an explicit range request (keep the "pick a start and end date"
	// prompt when the window drops) from a bare ?from/?to whose bounds fall outside the published
	// window (revert to the day view — there is no deliberate range intent to honour).
	const explicitRangeToken = page.url.searchParams.get('grain') === 'range';
	const seededRange = seed.window != null || explicitRangeToken;
	// The single radiogroup selection — exactly one of day|week|month|range is active. A seeded
	// window (?from&?to) or the ?grain=range hint implies range mode; otherwise the seeded grain
	// (day|week|month), default day.
	// ENUM-GUARD (not a cast): seed.grain is a codec Grain, which can be 'live' — a valid
	// Grain but NOT a lines GrainMode. Casting it would let 'live' corrupt viewKey (a
	// radiogroup with zero checked chips). Only the two coarse calendar grains this surface
	// serves pass through; anything else (incl. 'day', 'live', undefined) falls to the 'day'
	// default. A seeded window / ?grain=range hint still wins (range mode), as before.
	let viewKey = $state<GrainMode>(
		seededRange ? 'range' : seed.grain === 'week' || seed.grain === 'month' ? seed.grain : 'day',
	);
	// The effective window mode IS the single selection (range when 'range' is picked,
	// otherwise the calendar grain). Kept as a named derived so the mapper/caption
	// logic below reads unchanged from the prior single-select model.
	const mode = $derived<GrainMode>(viewKey);
	let localHistoryRequest = $state.raw<RawHistoryRangeRequest>(
		historyRangeRequestFromSearchParams(page.url.searchParams),
	);
	const activeHistoryRequest = $derived(history?.request ?? localHistoryRequest);
	const emptyHistoryRequest = (): RawHistoryRangeRequest => ({
		hasFrom: false,
		hasTo: false,
		rawFrom: null,
		rawTo: null,
	});
	function setHistoryRequest(request: RawHistoryRangeRequest): void {
		if (history) history.setRequest(request);
		else localHistoryRequest = request;
	}

	// Dated DAY-grain periods the contract carries (for the range picker), sorted
	// ascending so the start/end dropdowns read oldest→newest. A day-grain period
	// with a non-empty `date` qualifies — both bounds are concrete real dates.
	const datedPeriods = $derived(
		(data.periods ?? [])
			.filter((p): p is typeof p & { date: string } => p.grain === 'day' && !!p.date)
			// Dedupe by date: the contract can carry a duplicate day period for the
			// same date; keep the first so the picker options (and their keyed each)
			// stay unique. Without this the start/end selects crash on a dup key.
			.filter((p, i, arr) => arr.findIndex((q) => q.date === p.date) === i)
			.slice()
			.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
	);
	const currentAvailableDates = $derived(datedPeriods.map((period) => period.date));
	const historyAvailability = $derived(
		history?.index == null ? null : availabilityFromCollectionIndex(history.index),
	);
	const retainedAvailableDates = $derived(
		historyAvailability == null ? [] : datesForAvailability(historyAvailability),
	);
	const availableDates = $derived(
		retainedAvailableDates.length > 0 ? retainedAvailableDates : currentAvailableDates,
	);
	const hasDatedPeriods = $derived(availableDates.length > 0);

	// Which calendar grains the contract actually carries — so we never offer a
	// grain segment that resolves to nothing (an empty grain is disabled, not a
	// silent no-op). The mapper still falls back honestly if reached.
	const availableGrains = $derived.by<Set<string>>(() => {
		const set = new SvelteSet<string>();
		for (const p of data.periods ?? []) {
			if (p.grain === 'day' || p.grain === 'week' || p.grain === 'month') set.add(p.grain);
		}
		return set;
	});

	// Direct component renders without a retained resource preserve the legacy singleton clamp.
	// Production route pages defer all older-range validation to the shared retained coordinator.
	let settled = false;
	$effect(() => {
		if (settled) return;
		settled = true;
		if (history == null) {
			const window = resolveWindow(seed.window, new Set(currentAvailableDates));
			setHistoryRequest(
				window == null
					? emptyHistoryRequest()
					: { hasFrom: true, hasTo: true, rawFrom: window.from, rawTo: window.to },
			);
			if (window) viewKey = 'range';
			else if (viewKey === 'range' && !explicitRangeToken) viewKey = 'day';
		}
		if ((viewKey === 'week' || viewKey === 'month') && !availableGrains.has(viewKey))
			viewKey = 'day';
		else if (viewKey === 'range' && !hasDatedPeriods && history == null) viewKey = 'day';
	});

	let historyAnnouncement = $state<string | null>(null);
	let handledHistoryCorrection = '';
	const getRangeWindow = (): DateWindow | undefined => {
		const from = activeHistoryRequest.rawFrom;
		const to = activeHistoryRequest.rawTo;
		if (!activeHistoryRequest.hasFrom || !activeHistoryRequest.hasTo || !from || !to)
			return undefined;
		return from <= to ? { from, to } : { from: to, to: from };
	};
	const setRangeWindow = (w: DateWindow | undefined): void => {
		historyAnnouncement = null;
		handledHistoryCorrection = '';
		setHistoryRequest(
			w == null
				? emptyHistoryRequest()
				: { hasFrom: true, hasTo: true, rawFrom: w.from, rawTo: w.to },
		);
	};

	const rangeWindow = $derived(getRangeWindow());
	const hasRangePick = $derived(mode === 'range' && rangeWindow != null);
	const normalizedRange = $derived<{ start: string; end: string } | undefined>(
		hasRangePick && rangeWindow ? { start: rangeWindow.from, end: rangeWindow.to } : undefined,
	);
	const historyRequested = $derived(activeHistoryRequest.hasFrom || activeHistoryRequest.hasTo);
	const explicitHistory = $derived(
		history != null && historyRequested && history.state !== 'current',
	);
	const retainedReady = $derived(history?.state === 'ready' || history?.state === 'partial');
	const historyLiveAnnouncement = $derived.by(() => {
		if (historyAnnouncement != null) return historyAnnouncement;
		if (!explicitHistory) return '';
		if (history?.state === 'loading-index' || history?.state === 'loading-range')
			return copy.history.loading;
		if (history?.state === 'partial') return copy.history.partial;
		if (history?.state === 'no-data') return copy.history.noData;
		if (history?.state === 'error') return copy.history.error;
		if (history?.state === 'ready') return copy.history.ready;
		return '';
	});

	$effect(() => {
		if (mode === 'range' || !historyRequested) return;
		setHistoryRequest(emptyHistoryRequest());
	});

	$effect(() => {
		const correction = history?.resolved?.correction;
		if (correction == null || correction.key === handledHistoryCorrection) return;
		handledHistoryCorrection = correction.key;
		historyAnnouncement = copy.history.correction[correction.reason];
		setHistoryRequest(emptyHistoryRequest());
		if (!explicitRangeToken) viewKey = 'day';
	});

	$effect(() => {
		if (
			history == null ||
			!historyRequested ||
			history.state !== 'current' ||
			history.index != null
		)
			return;
		setHistoryRequest(emptyHistoryRequest());
		if (!explicitRangeToken) viewKey = 'day';
	});

	const historyCoverageText = $derived.by<string | null>(() => {
		if (historyAvailability?.kind !== 'continuous') return null;
		return copy.history.coverage(
			formatDateKey(historyAvailability.firstDate, locale),
			formatDateKey(historyAvailability.lastDate, locale),
		);
	});
	const historySelectionText = $derived.by<string | null>(() => {
		if (normalizedRange == null) return null;
		return copy.history.selection(
			formatDateKey(normalizedRange.start, locale),
			formatDateKey(normalizedRange.end, locale),
		);
	});

	// S7.5 P1: the SERIALIZED wire format for ?grain/?from/?to is now owned by the shared codec
	// (toSearchParams) — the rail maps its view state to a minimal FilterState and lets the codec
	// canonicalize it. In range mode with a COMPLETE window the window IS the state (grain omitted:
	// range = window-presence, so a shared link decodes back to range mode from the window alone).
	// Outside range mode the grain is the state (day is the surface default, so it is omitted for a
	// clean canonical URL — never written as grain=day). The custom range mirrors ONLY when COMPLETE
	// + normalized (a half-picked or inverted bound never leaks into a shared URL).
	//
	// MED-1: a range mode with NO complete window (the half-picked state) still emits the legacy
	// `grain=range` token so that in-progress state stays SHAREABLE — matching the pre-codec
	// behaviour. This token is a lines-UI range-mode HINT that the RRC seed honours (via
	// explicitRangeToken), NOT a codec Grain (fromSearchParams drops it); the codec never produces
	// it, so we set it directly here on top of the codec's canonical from/to.
	const wireParams = $derived.by<{ grain: string | null; from: string | null; to: string | null }>(
		() => {
			const state = emptyFilterState();
			if (mode === 'range') {
				if (normalizedRange)
					state.window = { from: normalizedRange.start, to: normalizedRange.end };
			} else if (mode !== 'day') {
				state.grain = mode;
			}
			const sp = toSearchParams(state);
			return {
				// In range mode without a complete window, keep the shareable legacy hint; otherwise
				// defer to the codec (which never emits grain=range and omits the day default).
				grain: mode === 'range' && !normalizedRange ? 'range' : sp.get('grain'),
				from: sp.get('from'),
				to: sp.get('to'),
			};
		},
	);
	// ONE batched mirrorSearchParams call (never N single writes: replaceState updates page.url async,
	// so back-to-back single writes clobber each other). mirrorSearchParams MERGES into the live URL —
	// it preserves RouteDetail's ?tab and any other owner's params, nulling only the keys we own.
	$effect(() => mirrorSearchParams(wireParams));

	// What the mapper resolves for. In range mode we thread the picked window to
	// the mapper via `dateRange` (grain stays 'day') so the strip aggregates the
	// in-range days + the trend zooms. Outside range mode the segment IS the grain.
	const selectedData = $derived.by<RouteReliability>(() => {
		if (!explicitHistory) return data;
		if (retainedReady && history?.value != null) {
			return applyRetainedLineHistory(data, history.value);
		}
		return clearRetainedLineHistory(data);
	});
	const mapperOpts = $derived(
		mode === 'range'
			? {
					grain: 'day',
					dateRange: normalizedRange,
					...(retainedReady && history?.value != null ? { retained: history.value } : {}),
				}
			: { grain: mode },
	);

	// One mapping pass — every band reads its slice of this.
	const clusters = $derived(toReliabilityClusters(selectedData, mapperOpts));

	// Instance-unique id prefix so the mobile drawer's disabled-reason description ids never
	// collide with another surface's controls on the same page.
	const uid = $props.id();
	// Segments carry an `available` flag; an unavailable grain renders disabled
	// (never selectable) so the control can't resolve to an empty grain. ONE control:
	// the three calendar grains PLUS the lines-only "range" option (offered only when
	// the contract carries dated day-periods to range over). Folding range in as a 4th
	// mutually-exclusive segment makes the active highlight single-select by
	// construction — picking range deselects the grain and vice-versa.
	//
	// LOW-2: a disabled segment carries the SAME honest-absence reason wiring the desktop
	// SurfaceControls builds (describedById + title via describeAbsence 'no-observations'),
	// so the mobile drawer announces WHY a grain is off at parity with desktop. The matching
	// visually-hidden description spans are rendered in the grainControls snippet below.
	const segmentAvailable = $derived<Record<GrainMode, boolean>>({
		day: availableGrains.has('day'),
		week: availableGrains.has('week'),
		month: availableGrains.has('month'),
		range: hasDatedPeriods,
	});
	const disabledReason = $derived(describeAbsence('no-observations', locale).why);
	const segments = $derived<GrainSegment<GrainMode>[]>(
		(['day', 'week', 'month', 'range'] as const).map((key) => {
			const label =
				key === 'day'
					? copy.controls.today
					: key === 'week'
						? copy.controls.thisWeek
						: key === 'month'
							? copy.controls.thisMonth
							: copy.controls.dateRange;
			const available = segmentAvailable[key];
			return {
				key,
				label,
				available,
				...(available ? {} : { describedById: `${uid}-reason-${key}`, title: disabledReason }),
			};
		}),
	);

	// S7.5 P2: the DESKTOP rail is now the SHARED SurfaceControls primitive (generic over the
	// GrainMode key). Availability is passed as EXPLICIT `available` flags (NOT the MIN_POINTS
	// data-depth clamp) so the enable/disable semantics stay EXACTLY today's per DECISIONS P2-2 —
	// a grain enabled iff the contract carries that grain, `range` iff there are dated day-periods.
	// The GrainPicker `segments` (built below) carry the labels + the explicit-flag
	// availability directly; the rail renders that one radiogroup in both the desktop glass
	// panel and the mobile sheet, sharing ONE viewKey binding (no divergence).

	// Active-window caption under the control spine — names the resolved window so
	// "Today / This week / This month / {range}" is never ambiguous about coverage.
	// In range mode it reads the strip VM's aggregate (the true in-range day count,
	// honest about gaps) for a multi-day span; a single resolved day reads exact.
	const activeWindowCaption = $derived.by<string>(() => {
		const aw = copy.controls.activeWindow;
		if (mode === 'range') {
			if (!normalizedRange) return aw.rangePrompt;
			if (normalizedRange.start === normalizedRange.end) return aw.singleDay(normalizedRange.start);
			const agg = clusters.strip.rangeAggregate;
			if (agg && agg.days > 0) return aw.range(agg.days, agg.start, agg.end);
			return aw.rangeSelection(normalizedRange.start, normalizedRange.end);
		}
		if (mode === 'week') return aw.week;
		if (mode === 'month') return aw.month;
		return aw.day;
	});

	/* ── mobile floating pills ──────────────────────────────────────────────────
	   On a phone the sticky ControlsRail is the wrong shape (it eats the top + still
	   wraps), so the grain controls move into a floating filter PILL and the section
	   jump-to into the shared TocPill — both <lg only; the full desktop rail returns
	   at >=lg. The grain controls render from ONE snippet (grainControls) shared by
	   the rail AND the pill drawer, so there is a single source of truth.
	   `controlsSummary` labels the filter pill with the active window. */
	const controlsSummary = $derived(
		mode === 'range'
			? copy.controls.dateRange
			: mode === 'week'
				? copy.controls.thisWeek
				: mode === 'month'
					? copy.controls.thisMonth
					: copy.controls.today,
	);

	// Section TOC (wayfinding): the rider-question sections a reader can jump to. This list
	// feeds the ONE shared TocNav (below) — the same numbered jump-list every other surface's
	// rail renders — so wayfinding looks identical site-wide. (The old per-section ↻/∞ filter-
	// scope glyph is gone: it read as a "reload" affordance and broke the cross-page sameness.)
	const sectionNav = $derived([
		{ id: 'rel-verdict', label: copy.sections.verdict.label },
		{ id: 'rel-when-to-ride', label: copy.sections.whenToRide.label },
		{ id: 'rel-the-wait', label: copy.sections.theWait.label },
		{ id: 'rel-run-and-fit', label: copy.sections.runAndFit.label },
		{ id: 'rel-worst-stops', label: copy.sections.worstStops.label },
	]);

	// Map the sections to numbered TocEntry rows for the shared TocNav (badge = station-style
	// SEC number; flat list, no children).
	const tocEntries: TocEntry[] = $derived(
		sectionNav.map((s, i) => ({
			id: s.id,
			title: s.label,
			level: 2,
			badge: { kind: 'number' as const, value: i + 1 },
			children: [],
		})),
	);

	// One IntersectionObserver over the bands' [data-toc] anchors owns the active section the
	// rail ToC highlights (client-only; each band carries data-toc below).
	let activeId = $state('');
	onMount(() => observeActiveToc((id) => (activeId = id)));

	// Smooth-scroll to a section when its TocNav row is tapped (TocNav is button-driven).
	function navigate(id: string): void {
		document
			.querySelector(`[data-toc="${id}"]`)
			?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
</script>

<div class={cn('reliability-clusters', className)} data-slot="reliability-clusters">
	<!-- P5.4: the grain/filter controls + the section ToC live in a map-style GLASS LEFT RAIL
	     (SurfaceRail) — a sticky floating panel beside the five rider-question sections on
	     desktop, and ONE merged pill→sheet menu (grain + ToC together) on mobile. The grain
	     refines §0's trend + §3's windowed rates/mix; §1/§2/§4 follow it once their *_by_grain
	     companion is published. --primary lives only on the active control chip. ONE shared
	     GrainPicker owns the whole radiogroup — day|week|month PLUS the lines-only "range"
	     segment — so exactly one chip is active at a time. -->
	<div class="reliability-layout" data-slot="reliability-sections">
		<!-- The grain controls (GrainPicker + range pair + active-window caption). ONE definition,
		     rendered in BOTH the desktop rail AND the mobile filter pill's drawer (single source). -->
		<!-- The range start/end date pair — its own snippet so it seats in BOTH the desktop
		     SurfaceControls `window` slot AND the mobile pill's grainControls (one source). -->
		{#snippet rangeControls()}
			{#if mode === 'range'}
				<HistoryNavigator
					mode="range"
					{availableDates}
					{locale}
					labels={copy.history.navigator}
					value={rangeWindow}
					coverageText={historyCoverageText}
					selectionText={historySelectionText}
					liveAnnouncement={false}
					onRangeChange={setRangeWindow}
				/>
			{/if}
		{/snippet}

		<!-- The rail content — the grain controls (GrainPicker + range pair + caption) + the
		     section ToC. ONE definition, rendered by SurfaceRail in BOTH the desktop glass rail
		     AND the mobile sheet (single source; both bind the same viewKey + track activeId). -->
		{#snippet railContent({ closeSheet }: { closeSheet: () => void })}
			<div class="reliability-control-body" data-slot="controls-body">
				<span class="reliability-rail-view" data-slot="controls-rail-label"
					>{copy.controls.viewLabel}</span
				>
				<GrainPicker {segments} bind:value={viewKey} label={copy.controls.grainLabel} />
				<!-- Disabled-reason descriptions (honest-absence): one visually-hidden span per
				     disabled segment, referenced by its radio via aria-describedby. -->
				{#each segments as seg (seg.key)}
					{#if seg.describedById}
						<span id={seg.describedById} class="reliability-reason" data-slot="controls-reason"
							>{disabledReason}</span
						>
					{/if}
				{/each}
				{@render rangeControls()}
				<!-- Active-window caption: names the window the selection resolves to. -->
				<p class="reliability-window" data-slot="active-window" aria-live="polite">
					{activeWindowCaption}
				</p>
			</div>

			<!-- Section TOC (wayfinding) — the ONE shared TocNav, identical to the metrics /
			     status / network / stops rails: a numbered jump list with TocNav's own
			     "SEC n/m" readout (the rail's ONLY position counter), the active section
			     amber-highlighted. Picking a section also dismisses the mobile sheet through
			     SurfaceRail's explicit closeSheet seam. -->
			<div class="rail-toc" data-slot="section-toc">
				<TocNav
					entries={tocEntries}
					{activeId}
					onNavigate={(id) => {
						navigate(id);
						closeSheet();
					}}
					heading={copy.controls.toc}
					sectionKey="reliability-toc"
				/>
			</div>
		{/snippet}

		<!-- The map-style GLASS LEFT RAIL: a sticky floating panel beside the sections on
		     desktop; ONE pill→sheet (grain + ToC merged into one menu) on mobile. -->
		<SurfaceRail
			rail={railContent}
			label={copy.controls.viewLabel}
			summary={controlsSummary}
			openAria={copy.controls.filterPillOpen}
			closeAria={copy.controls.filterPillClose}
		/>
		<p
			class="reliability-history-announcement"
			data-slot="history-page-announcement"
			role="status"
			aria-live="polite"
			aria-atomic="true"
		>
			{historyLiveAnnouncement}
		</p>

		<!-- The five rider-question sections — the content column beside the rail. -->
		<div class="reliability-content">
			{#if historyAnnouncement}
				<p class="reliability-history-correction" data-slot="history-correction">
					{historyAnnouncement}
				</p>
			{/if}
			{#if explicitHistory}
				<div class="reliability-history-state" data-slot="history-state">
					{#if history?.state === 'loading-index' || history?.state === 'loading-range'}
						<p data-slot="history-loading">{copy.history.loading}</p>
					{:else if history?.state === 'partial'}
						<p data-slot="history-partial">{copy.history.partial}</p>
					{:else if history?.state === 'no-data'}
						<p data-slot="history-no-data">{copy.history.noData}</p>
					{:else if history?.state === 'error'}
						<p data-slot="history-error">{copy.history.error}</p>
						<Button variant="outline" size="sm" onclick={() => history?.retry()}>
							{copy.history.retry}
						</Button>
					{/if}
					<p data-slot="history-current-only">{copy.history.currentOnly}</p>
				</div>
			{/if}
			<!-- §0 Verdict — "Can you count on this line?" The grain rail re-shapes only the trend. -->
			<div class="reliability-band" id="rel-verdict" data-toc="rel-verdict" data-band="verdict">
				<Section0Verdict vm={clusters.punctuality} {locale} {copy} {mode} />
			</div>

			<!-- §1 When to ride — the 7×24 heatmap hero + the time-of-day / weekday detail. -->
			<div
				class="reliability-band"
				id="rel-when-to-ride"
				data-toc="rel-when-to-ride"
				data-band="when-to-ride"
			>
				<Section1WhenToRide
					punctuality={clusters.punctuality}
					habits={clusters.habits}
					{locale}
					{copy}
					{mode}
				/>
			</div>

			<!-- §2 The wait — scheduled-vs-observed headway + (detail) regularity + service span. -->
			<div class="reliability-band" id="rel-the-wait" data-toc="rel-the-wait" data-band="the-wait">
				<Section2TheWait
					wait={clusters.waitRegularity}
					serviceSpans={clusters.serviceDelivered.serviceSpans}
					{locale}
					{copy}
					{directionHeadsigns}
					{mode}
				/>
			</div>

			<!-- §3 Will it run & will you fit — cancellations/skips + crowding (grain-windowed). -->
			<div
				class="reliability-band"
				id="rel-run-and-fit"
				data-toc="rel-run-and-fit"
				data-band="run-and-fit"
			>
				<Section3RunAndFit
					service={clusters.serviceDelivered}
					crowding={clusters.crowding}
					{locale}
					{copy}
					windowLabel={controlsSummary}
					showServiceCompleteness={explicitHistory && retainedReady}
				/>
			</div>

			<!-- §4 Where it's worst — the worst-N stops accountability lollipop. -->
			<div
				class="reliability-band"
				id="rel-worst-stops"
				data-toc="rel-worst-stops"
				data-band="worst-stops"
			>
				<Section4WorstStops punctuality={clusters.punctuality} {locale} {copy} />
			</div>
		</div>
	</div>
</div>

<style>
	.reliability-clusters {
		display: flex;
		flex-direction: column;
		/* §1.3 spacing rhythm: the BETWEEN-section gap must read clearly larger than any
		   within-section gap (the "cramped" fix). 48→80px of whitespace groups each band
		   as one unit by proximity (the spec's --space-section-y), well above the ~8–24px
		   intra-section gaps — so sections never run together. */
		gap: clamp(3rem, 7vw, 5rem);
		width: 100%;
		/* No per-surface sticky override: the floating pill sits OVER #main and the
		   single --chrome-offset knob (AppShell → ControlsRail) clears it correctly
		   here like everywhere else. The hazard-tape separator below the rail gives
		   the visual break. */
	}

	/* The 2-col layout (P5.4): the map-style GLASS LEFT RAIL (SurfaceRail) + the content
	   column at ≥1024; a single column below, where the rail collapses to the mobile
	   pill→sheet. The content column is the rail's sticky CONTAINING BLOCK, so the glass
	   rail stays pinned over the sections. */
	.reliability-layout {
		display: grid;
		grid-template-columns: 1fr;
		gap: clamp(1.5rem, 4vw, 2rem);
		width: 100%;
	}
	@media (min-width: 1024px) {
		.reliability-layout {
			grid-template-columns: 15rem minmax(0, 1fr);
			gap: 2rem;
			align-items: start;
		}
	}
	/* The content column — the five rider-question sections at the page section rhythm. */
	.reliability-content {
		display: flex;
		flex-direction: column;
		gap: clamp(3rem, 7vw, 5rem);
		min-width: 0;
	}

	/* The grain radiogroup wraps so a long localized segment never overflows the narrow
	   rail; the active-chip accent lives in GrainPicker. */
	.reliability-clusters :global([data-slot='grain-picker']) {
		min-width: 0;
		flex-wrap: wrap;
	}

	/* The start + end date pair is now the SHARED DateRangePicker primitive (S8B), which
	   owns its own tokens-only chrome — the bespoke .reliability-range/.reliability-date
	   styles were removed with the inlined <select> markup (DRY). */

	/* Visually-hidden disabled-reason description (mobile drawer) — carried for screen
	   readers via aria-describedby on the disabled radio; never shown, never a layout box.
	   Mirrors SurfaceControls' .surface-controls__reason. */
	.reliability-reason {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	/* Active-window caption — quiet mono, AA against the page surface; chrome, so it
	   stays inside the ControlsRail body alongside the grain control. Full-width so it
	   drops onto its own row beneath the chips. */
	.reliability-window {
		margin: 0;
		/* The grain chips sit on one row; this caption always drops onto its own line
		   beneath them (it names the resolved window — it is a note, not a chip). */
		flex-basis: 100%;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1.3;
		color: var(--muted-foreground);
	}
	.reliability-history-announcement {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
	.reliability-history-state {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.75rem 1rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}
	.reliability-history-state p {
		margin: 0;
	}
	.reliability-history-correction {
		margin: 0;
		padding: 0.75rem 1rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--foreground);
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}

	/* The rail section jump-list rides the ONE shared TocNav (same component the metrics /
	   status / network / stops rails use), so every surface's wayfinding looks identical.
	   Only this thin flex wrapper is local; TocNav owns the rest. */
	.rail-toc {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
	}

	/* ROW 1 (operator): the "View" overline + the "Jump to" nav on ONE row, so the
	   destinations cost no extra height and the sticky rail stays thin. The row now
	   rides SurfaceControls' `nav` slot (.surface-controls__nav, which already lays out
	   flex-wrap/baseline/gap); we only add justify-between so the nav is pushed to the
	   right of the overline, matching the pre-S7.5 .reliability-rail-top layout exactly. */
	.reliability-clusters :global([data-surface-controls] [data-slot='controls-nav']) {
		justify-content: space-between;
	}
	/* The "View" overline — same quiet mono voice as the shared ControlsRail label (we
	   render it ourselves here so it can share the row with the nav). */
	.reliability-rail-view {
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--tracking-eyebrow);
		color: var(--muted-foreground);
	}
	/* The grain controls (View overline + GrainPicker + range + caption), stacked in the
	   rail. Rendered by railContent in BOTH the desktop glass rail and the mobile sheet. */
	.reliability-control-body {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.5rem;
		min-width: 0;
	}

	/* Each band is a block in the content column (no longer full-bleed — the left rail now
	   defines a 2-col reading measure). The [id] rule in app.css parks jumped-to sections
	   below the floating chrome via --chrome-offset. */
	.reliability-band {
		min-width: 0;
	}
	/* Smooth jump-to from the TOC (reduced-motion users get the instant default). */
	@media (prefers-reduced-motion: no-preference) {
		.reliability-layout {
			scroll-behavior: smooth;
		}
	}
	/* Section DIFFERENTIATION: each section AFTER the first opens with a quiet
	   full-width hairline + extra top breathing room, so the sections read as
	   distinct units rather than one long scroll. The adjacent-sibling selector
	   leaves the first band (§0 Verdict) ruleless — the hazard separator already
	   divides it from the control rail. */
	.reliability-band + .reliability-band {
		border-top: 1px solid var(--border);
		padding-top: clamp(1.75rem, 4vw, 2.75rem);
	}
	/* #8 Blueprint frame: each GRAPH block carries a hairline card so its title (top) + chart +
	   caption (bottom) read as ONE unit — a title can never be mistaken for the previous graph's
	   footnote. The section's PRIMARY chart gets an orange left-rule (the yesid hero motif). Scoped
	   global so it reaches the chart blocks the Section components render. The inner stack keeps the
	   blocks' own gap; the frame just bounds it. */
	:global(.reliability-band [data-card]) {
		border: 1px solid var(--border);
		/* SOLID surface — the occlusion law (§C1): a content card must fully occlude
		   the blueprint grid, so no alpha bleed. Was card@70% (grid showed through). */
		background: var(--surface-2);
		border-radius: var(--radius-lg);
		padding: clamp(0.9rem, 2.2vw, 1.35rem);
	}
	:global(.reliability-band [data-card='primary']) {
		/* The section's PRIMARY chart reads as the hero unit via a full brand-rule
		   border (§C4 P7 — the former 3px left-stripe accent is retired; the
		   decorative-rule token = --primary, theme-safe, --primary itself stays
		   reserved for interactive affordances). */
		border-color: var(--border-rule);
	}
	/* Operator: "yellow titles for each card so they tell what the graph is." Every graph
	   card's title (its SectionLabel) wears the yellow wayfinding voice (--accent-text, AA
	   on --card in both themes), so each chart reads as its OWN unit at a glance and a title
	   can never be mistaken for a neighbour's note. ONE rule owns this for ALL sections, so
	   the styling stays identical across every graph (the consistency mandate). The (i)
	   explainer, captions, KPI tiles, and table cells are untouched — only chart titles. */
	:global(.reliability-band [data-card] [data-slot='section-label']) {
		color: var(--accent-text);
		font-weight: 600;
	}

	/* The rider-question section TITLE. Operator: "titles need to be HUGE, like yesid.dev
	   treats titles" — yesid.dev frames each section with a small mono EYEBROW (our
	   SectionLabel) above a DISPLAY-SCALE title. This is the big plain-language frame, sized
	   one full step up (--text-title, ~1.75–2.5rem) from the old timid --text-subheading.
	   ONE definition for all five sections (was duplicated per-section, identical) — declared
	   :global so the orchestrator owns the section heading scale in a single place. The §0
	   VerdictBanner (--text-display) stays the apex; the title sits just under it. */
	:global(.reliability-band .section-question) {
		margin: 0;
		font-family: var(--font-heading);
		font-size: var(--text-title);
		font-weight: 700;
		line-height: 1.12;
		letter-spacing: var(--tracking-tight);
		color: var(--foreground);
		max-inline-size: 28ch;
		text-wrap: balance;
	}
</style>
