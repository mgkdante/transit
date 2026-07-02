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
	import type { RouteReliability } from '$lib/v1';
	import { SvelteSet } from 'svelte/reactivity';
	import { onMount } from 'svelte';
	import { GrainPicker, SurfaceControls, type GrainSegment } from '$lib/components/surface';
	import { Separator } from '$lib/components/ui/separator';
	import { TocPill, observeActiveToc, type TocEntry } from '$lib/components/shared';
	import ReliabilityFilterPill from './ReliabilityFilterPill.svelte';
	import { toReliabilityClusters } from './clusters';
	import { reliabilityCopy } from './reliability.copy';
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
	}

	let {
		data,
		locale,
		directionHeadsigns = {},
		class: className,
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
	// The custom range bounds, seeded from the codec's normalized {from,to} window (already
	// shape-validated + inverted-swapped by the codec). Availability is validated in the clamp below,
	// where the dated window is known. Absent window → empty bounds (no range).
	let rangeStart = $state<string>(seed.window?.from ?? '');
	let rangeEnd = $state<string>(seed.window?.to ?? '');

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
	const hasDatedPeriods = $derived(datedPeriods.length > 0);

	// The available dated day window (for bounding + the prompt). The picker offers
	// only real dates, so an out-of-window pick is impossible by construction.
	const earliestDate = $derived(datedPeriods.length > 0 ? datedPeriods[0].date : '');
	const latestDate = $derived(
		datedPeriods.length > 0 ? datedPeriods[datedPeriods.length - 1].date : '',
	);

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

	// Availability clamp (one-shot): the ?grain seed is validated for SHAPE at init, but availability
	// needs `data` (a $derived) — so clamp once after first render. A URL-seeded grain the contract
	// can't serve (week/month absent, or range with no dated days) falls back to 'day' so the control
	// never resolves to an empty grain.
	let settled = false;
	$effect(() => {
		if (settled) return;
		settled = true;
		// S7.5 P1: validate the URL-seeded window against the real dated window via the SHARED
		// resolveWindow clamp (drop an out-of-window / non-existent bound — the URL is a hint, never
		// fabricates a window). A complete, in-window {from,to} keeps range mode; anything else drops
		// the window (and, if we were in range mode purely because of it, falls back to 'day').
		const availableDates = new Set(datedPeriods.map((p) => p.date));
		const seededWindow: DateWindow | undefined =
			rangeStart && rangeEnd ? { from: rangeStart, to: rangeEnd } : undefined;
		const window = resolveWindow(seededWindow, availableDates);
		rangeStart = window?.from ?? '';
		rangeEnd = window?.to ?? '';
		// A complete, valid window implies range intent (matches the old activateRange: a full range
		// deep-links range mode even without an explicit token).
		if (window) viewKey = 'range';
		// The window was DROPPED (out-of-window / non-existent bounds). Preserve range MODE with its
		// honest "pick a start and end date" prompt ONLY when range was requested EXPLICITLY (the
		// ?grain=range half-pick token). A bare ?from/?to whose bounds fall outside the published
		// window carries no deliberate range intent — revert to the day view (the old behaviour),
		// never a silent empty range prompt for a link that never mentioned range.
		else if (viewKey === 'range' && !explicitRangeToken) viewKey = 'day';
		// Grain availability clamp: a grain the contract can't serve falls back to 'day' so the
		// control never resolves to an empty grain.
		if ((viewKey === 'week' || viewKey === 'month') && !availableGrains.has(viewKey))
			viewKey = 'day';
		else if (viewKey === 'range' && !hasDatedPeriods) viewKey = 'day';
	});

	// A complete range needs both bounds; we normalise start ≤ end so the user can
	// pick the two dates in any order without inverting the window.
	const hasRangePick = $derived(mode === 'range' && !!rangeStart && !!rangeEnd);
	const normalizedRange = $derived<{ start: string; end: string } | undefined>(
		hasRangePick
			? rangeStart <= rangeEnd
				? { start: rangeStart, end: rangeEnd }
				: { start: rangeEnd, end: rangeStart }
			: undefined,
	);

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
	const mapperOpts = $derived<{ grain: string; dateRange?: { start: string; end: string } }>(
		mode === 'range' ? { grain: 'day', dateRange: normalizedRange } : { grain: mode },
	);

	// One mapping pass — every band reads its slice of this.
	const clusters = $derived(toReliabilityClusters(data, mapperOpts));

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
	// The mobile filter pill keeps rendering the same 4-mode GrainPicker (via `grainControls`), so
	// both affordances share ONE viewKey binding + one availability source (no divergence).
	const grainOffered: readonly GrainMode[] = ['day', 'week', 'month', 'range'];
	const grainAvailability = $derived<Partial<Record<GrainMode, { available: boolean }>>>({
		day: { available: availableGrains.has('day') },
		week: { available: availableGrains.has('week') },
		month: { available: availableGrains.has('month') },
		range: { available: hasDatedPeriods },
	});
	const grainLabels = $derived<Partial<Record<GrainMode, string>>>({
		day: copy.controls.today,
		week: copy.controls.thisWeek,
		month: copy.controls.thisMonth,
		range: copy.controls.dateRange,
	});

	// Active-window caption under the control spine — names the resolved window so
	// "Today / This week / This month / {range}" is never ambiguous about coverage.
	// In range mode it reads the strip VM's aggregate (the true in-range day count,
	// honest about gaps) for a multi-day span; a single resolved day reads exact.
	const activeWindowCaption = $derived.by<string>(() => {
		const aw = copy.controls.activeWindow;
		if (mode === 'range') {
			if (!normalizedRange) return aw.rangePrompt;
			const agg = clusters.strip.rangeAggregate;
			if (agg) return aw.range(agg.days, agg.start, agg.end);
			// One in-range day (start == end, or only one dated day in the span).
			return aw.singleDay(normalizedRange.start);
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

	// Section TOC (wayfinding) doubling as the filter-SCOPE map (research): each rider-question
	// section + whether the time window above re-shapes it (↻ windowed) or it reads the full
	// history regardless (∞). §0 trend + §3 rates/mix ALWAYS follow the window. S7-B: §1/§2/§4
	// follow it ONCE the DB publishes their *_by_grain companion (periods/headway/weak_stops
	// by grain) and degrade to the scalar whole-history read until then, so the badge is DATA-
	// DRIVEN off the mapper (honest: ∞ until the windowed data exists, never a fake ↻).
	const sectionNav = $derived([
		{ id: 'rel-verdict', label: copy.sections.verdict.label, windowed: true },
		{
			id: 'rel-when-to-ride',
			label: copy.sections.whenToRide.label,
			windowed: clusters.punctuality.windowed,
		},
		{
			id: 'rel-the-wait',
			label: copy.sections.theWait.label,
			windowed: clusters.waitRegularity.windowed,
		},
		{ id: 'rel-run-and-fit', label: copy.sections.runAndFit.label, windowed: true },
		{
			id: 'rel-worst-stops',
			label: copy.sections.worstStops.label,
			windowed: clusters.punctuality.weakStopsWindowed,
		},
	]);

	// The mobile TocPill reads the SAME sections as the desktop jump-to nav (one source).
	const tocEntries = $derived<TocEntry[]>(
		sectionNav.map((s) => ({ id: s.id, title: s.label, level: 1, children: [] })),
	);
	// One IntersectionObserver over the bands' [data-toc] anchors owns the active section the
	// TocPill highlights (client-only; each band carries data-toc below).
	let activeId = $state('');
	onMount(() => observeActiveToc((id) => (activeId = id)));
</script>

<div class={cn('reliability-clusters', className)} data-slot="reliability-clusters">
	<!-- The page-level grain rail (sticky) sits above the five rider-question sections.
	     The grain refines §0's trend + §3's windowed rates/mix; §1/§2/§4 follow it once their
	     *_by_grain companion is published (else they read the scalar whole history). One column,
	     the rail pinned over it. -->
	<div class="reliability-grain-block" data-slot="reliability-sections">
		<!-- Control panel: the grain/date controls collected into ONE ControlsRail (quiet
	     infra chrome, mono "View" overline) so the control reads identically to /stop
	     and /network. ONE shared GrainPicker owns the whole radiogroup —
	     day|week|month PLUS the lines-only "range" segment — so EXACTLY ONE chip is
	     active at a time (picking range deselects the grain and vice-versa; no dual
	     highlight). The headline shows with ZERO interaction at the default 'day'
	     grain — the controls only refine. --primary lives only on the active control
	     chip, never on the rail chrome. STICKY (S6): the grain control is the main
	     control of the surface, so the rail stays pinned (desktop) while the metric
	     cards + bands scroll under it. -->
		<!-- The grain controls (GrainPicker + range pair + active-window caption). ONE definition,
		     rendered in BOTH the desktop rail AND the mobile filter pill's drawer (single source). -->
		<!-- The range start/end date pair — its own snippet so it seats in BOTH the desktop
		     SurfaceControls `window` slot AND the mobile pill's grainControls (one source). -->
		{#snippet rangeControls()}
			{#if mode === 'range'}
				<!-- Start + end pair over the dated day-periods. start == end = one day (exact);
				     a wider span aggregates the in-range days (mean) + zooms the trend. Bounds are
				     real dates only, so no out-of-window pick is possible. -->
				<div class="reliability-range" data-slot="date-range">
					<label class="reliability-date">
						<span class="reliability-date__label">{copy.controls.rangeStart}</span>
						<select
							class="reliability-date__select"
							value={rangeStart}
							onchange={(e) => (rangeStart = e.currentTarget.value)}
							aria-label={`${copy.controls.dateRange} · ${copy.controls.rangeStart}`}
						>
							<option value="">{earliestDate || ''}</option>
							{#each datedPeriods as p (p.date)}
								<option value={p.date}>{p.date}</option>
							{/each}
						</select>
					</label>
					<label class="reliability-date">
						<span class="reliability-date__label">{copy.controls.rangeEnd}</span>
						<select
							class="reliability-date__select"
							value={rangeEnd}
							onchange={(e) => (rangeEnd = e.currentTarget.value)}
							aria-label={`${copy.controls.dateRange} · ${copy.controls.rangeEnd}`}
						>
							<option value="">{latestDate || ''}</option>
							{#each datedPeriods as p (p.date)}
								<option value={p.date}>{p.date}</option>
							{/each}
						</select>
					</label>
				</div>
			{/if}
		{/snippet}

		<!-- The MOBILE pill's grain controls (GrainPicker + range + caption). Desktop uses
		     SurfaceControls below; this snippet feeds ONLY the mobile filter-pill drawer, driven
		     by the SAME viewKey + segments + range bounds (no behavioural divergence). -->
		{#snippet grainControls()}
			<div class="reliability-control-body" data-slot="controls-body">
				<GrainPicker {segments} bind:value={viewKey} label={copy.controls.grainLabel} />
				<!-- Disabled-reason descriptions (honest-absence parity with the desktop rail): one
				     visually-hidden span per disabled segment, referenced by its radio via
				     aria-describedby (set in the `segments` derived). Never a layout box. -->
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
		{/snippet}

		<!-- The desktop rail's row-1 nav: the "View" overline + the "Jump to" TOC on ONE row
		     (operator layout law). Seated in SurfaceControls' `nav` slot so the primitive owns the
		     rail chrome + sticky while lines keeps its bespoke wayfinding row. -->
		{#snippet desktopNav()}
			<span class="reliability-rail-view" data-slot="controls-rail-label"
				>{copy.controls.viewLabel}</span
			>
			<!-- Section TOC (wayfinding): each entry jumps to its section AND shows its filter
			     scope (↻ follows the window above, ∞ full history). -->
			<nav class="reliability-toc" data-slot="section-toc" aria-label={copy.controls.toc}>
				<span class="reliability-toc__label">{copy.controls.toc}</span>
				<ul class="reliability-toc__list">
					{#each sectionNav as s (s.id)}
						<li>
							<a
								class="reliability-toc__link"
								href={`#${s.id}`}
								data-scope={s.windowed ? 'windowed' : 'whole'}
							>
								<span class="reliability-toc__text">{s.label}</span>
								<span
									class="reliability-toc__scope"
									title={s.windowed ? copy.controls.scopeWindowed : copy.controls.scopeWhole}
									aria-label={s.windowed ? copy.controls.scopeWindowed : copy.controls.scopeWhole}
									>{s.windowed ? '↻' : '∞'}</span
								>
							</a>
						</li>
					{/each}
				</ul>
			</nav>
		{/snippet}

		<!-- DESKTOP (>=lg): the full sticky SurfaceControls rail — row-1 nav ("View" + "Jump to")
		     in the nav slot, the 4-mode grain radiogroup, the range date pair in the window slot,
		     and the active-window caption. Availability = explicit flags (today's exact semantics).
		     Hidden below lg, where the floating pills below take over. -->
		<SurfaceControls
			sticky
			class="reliability-rail-desktop"
			offered={grainOffered}
			availability={grainAvailability}
			bind:value={viewKey}
			labels={grainLabels}
			grainLabel={copy.controls.grainLabel}
			{locale}
			windowCaption={activeWindowCaption}
			nav={desktopNav}
			window={rangeControls}
			role="group"
			aria-label={copy.controls.viewLabel}
		/>

		<!-- MOBILE (<lg): two floating pills replace the rail — the grain FILTER pill opens a drawer
		     with the SAME grain controls; the section JUMP-TO rides the shared TocPill below it,
		     tracking the active section as you scroll. Both hide at >=lg. -->
		<ReliabilityFilterPill
			title={copy.controls.viewLabel}
			label={controlsSummary}
			controls={grainControls}
			openAria={copy.controls.filterPillOpen}
			closeAria={copy.controls.filterPillClose}
		/>
		<TocPill
			entries={tocEntries}
			{activeId}
			openAria={copy.controls.toc}
			closeAria={copy.controls.tocPillClose}
		/>

		<!-- Hazard tape discerns the controls zone from the data canvas. -->
		<Separator variant="hazard" hazardSize="sm" />

		<!-- §0 Verdict — "Can you count on this line?" The grain rail re-shapes only the trend. -->
		<div
			class="reliability-band surface-bleed"
			id="rel-verdict"
			data-toc="rel-verdict"
			data-band="verdict"
		>
			<Section0Verdict vm={clusters.punctuality} {locale} {copy} {mode} />
		</div>

		<!-- §1 When to ride — the 7×24 heatmap hero + the time-of-day / weekday detail. -->
		<div
			class="reliability-band surface-bleed"
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
		<div
			class="reliability-band surface-bleed"
			id="rel-the-wait"
			data-toc="rel-the-wait"
			data-band="the-wait"
		>
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
			class="reliability-band surface-bleed"
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
			/>
		</div>

		<!-- §4 Where it's worst — the worst-N stops accountability lollipop. -->
		<div
			class="reliability-band surface-bleed"
			id="rel-worst-stops"
			data-toc="rel-worst-stops"
			data-band="worst-stops"
		>
			<Section4WorstStops punctuality={clusters.punctuality} {locale} {copy} />
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
		/* This surface scrolls inside a nested container that already begins BELOW the
		   app nav, so the rail's sticky offset is 0 (flush at the container top) — not the
		   5.5rem window-scroll default that floated it ~88px down with content showing
		   through. The hazard-tape separator below the rail gives the visual break. */
		--rail-sticky-top: 0px;
	}

	/* The single sections column: the sticky grain rail + the five rider-question
	   sections, carrying the same section rhythm as the page. This is the rail's
	   sticky CONTAINING BLOCK, so the rail stays pinned over the whole surface. */
	.reliability-grain-block {
		display: flex;
		flex-direction: column;
		gap: clamp(3rem, 7vw, 5rem);
		width: 100%;
	}

	/* The grain + range control is now ONE shared GrainPicker (day|week|month|range),
	   so the bespoke companion-chip styles are gone — the active-chip accent lives in
	   GrainPicker. The segmented row keeps a measure + wraps so a long localized
	   segment label never collides with its neighbour or overflows the rail. */
	.reliability-clusters :global([data-slot='grain-picker']) {
		min-width: 0;
		flex-wrap: wrap;
	}
	/* Operator: make the control rail as THIN as possible (reliability surface ONLY — the shared
	   ControlsRail keeps its comfortable padding on /stop + /network). Trim the panel padding + the
	   inter-control gaps so the sticky bar eats minimal vertical space. */
	.reliability-clusters :global(.controls-rail) {
		padding: 0.5rem 0.8rem;
		gap: 0.35rem;
	}
	.reliability-clusters :global(.controls-rail__body) {
		gap: 0.35rem;
	}

	/* The start + end date pair sits inline, wrapping on narrow viewports. */
	.reliability-range {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem 1rem;
	}
	.reliability-date {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	.reliability-date__label {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	.reliability-date__select {
		appearance: auto;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
		background-color: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-md, 0.5rem);
		padding: 0.35rem 0.6rem;
	}
	.reliability-date__select:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}

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

	/* Section TOC (wayfinding + filter-scope map): a horizontal nav of the 5 sections,
	   each a jump link + a scope glyph (↻ follows the window / ∞ full history). It now
	   shares ROW 1 with the "View" overline (operator: "Jump to on the same row as View"),
	   so it carries no divider of its own — it sits inline, right of the overline. The
	   list keeps the destinations on ONE row on desktop (see below). */
	.reliability-toc {
		display: flex;
		align-items: baseline;
		gap: 0.3rem 0.6rem;
		min-width: 0;
	}
	.reliability-toc__label {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.reliability-toc__list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.reliability-toc__link {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 28px;
		padding: 0.2rem 0.6rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
		text-decoration: none;
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		transition:
			border-color var(--duration-fast) var(--ease-default),
			color var(--duration-fast) var(--ease-default);
	}
	.reliability-toc__link:hover {
		border-color: var(--primary);
		color: var(--primary);
	}
	.reliability-toc__link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	/* The scope glyph: ∞ (full history) reads quiet; ↻ (follows the window) rides the
	   yellow wayfinding voice so the windowed sections are scannable at a glance. */
	.reliability-toc__scope {
		font-size: var(--text-body);
		line-height: 1;
		color: var(--muted-foreground);
	}
	.reliability-toc__link[data-scope='windowed'] .reliability-toc__scope {
		color: var(--accent-text);
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
	/* The grain controls (GrainPicker + range + caption). ONE block, rendered by the
	   grainControls snippet in BOTH the desktop rail and the mobile filter pill's drawer. */
	.reliability-control-body {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.45rem 0.75rem;
		min-width: 0;
	}
	@media (min-width: 768px) {
		/* Desktop: keep ALL destinations on ONE line (operator). If a long locale ever
		   overflows, the row scrolls horizontally rather than wrapping to a second line. */
		.reliability-toc__list {
			flex-wrap: nowrap;
			overflow-x: auto;
			scrollbar-width: thin;
		}
	}
	/* MOBILE (<lg): the floating pills (ReliabilityFilterPill + TocPill) replace the rail, so
	   hide the sticky rail entirely below the desktop breakpoint. The pills are lg:hidden, so
	   EXACTLY ONE controls affordance shows at every width (no overlap at the 1024 line). */
	@media (max-width: 1023.98px) {
		.reliability-clusters :global(.reliability-rail-desktop) {
			display: none;
		}
	}

	/* Each band is its own edge-to-edge block; the strip carries a quiet rule so
	   the single-glance headline reads as its own register above the clusters.
	   Bands opt into full-bleed at the wrapper (.surface-bleed, see Surface.svelte)
	   so the data marks reach the content-column edges; dense prose inside re-caps
	   itself via .surface-measure. The control spine (.reliability-controls) stays
	   within the reading column — it is chrome, not a band, so it is NOT bled.

	   The .surface-bleed escapes the Surface gutter via a negative inline margin;
	   left UNCANCELLED the band content would hug the bled edge and read LEFT-
	   SHIFTED / wider than the inset (non-bled) control spine — the off-centre
	   complaint on mobile/tablet. Re-apply the gutter as padding (matching
	   .surface-measure's intent + MetricsExplainer's .body-grid) so the band's
	   content edges land back on the page-padding line — centred at every width,
	   aligned with the control spine + the /stop DashboardGrid. */
	.reliability-band {
		/* NO width:100% here. With width:100% the band is pinned to the parent's width, so the
		   .surface-bleed negative margins only shift it LEFT (they cannot widen it on the right) —
		   that was the mobile "everything biased to the left" bug (band bled to x=0 but its right
		   edge stopped a full gutter short). As a STRETCH flex child of .reliability-grain-block,
		   leaving width auto lets the negative inline margins widen the band symmetrically to both
		   page edges, so the re-padded content sits centred. */
		padding-inline: var(--space-page-x);
		/* TOC jump-to: clear the sticky control rail so a jumped-to section header isn't
		   hidden under it. */
		scroll-margin-top: 7rem;
	}
	/* Smooth jump-to from the TOC (reduced-motion users get the instant default). */
	@media (prefers-reduced-motion: no-preference) {
		.reliability-grain-block {
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
		background: color-mix(in oklab, var(--card) 70%, transparent);
		border-radius: var(--radius-lg, 0.75rem);
		padding: clamp(0.9rem, 2.2vw, 1.35rem);
	}
	:global(.reliability-band [data-card='primary']) {
		/* The semantic decorative-rule token (= --primary, theme-safe) — --primary itself is
		   reserved for interactive affordances; a static card rule reads --border-rule. */
		border-inline-start: 3px solid var(--border-rule);
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
