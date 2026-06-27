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
	import { mirrorSearchParam } from '$lib/site/urlMirror';
	import type { Locale } from '$lib/i18n';
	import type { RouteReliability } from '$lib/v1';
	import { SvelteSet } from 'svelte/reactivity';
	import { ControlsRail } from '$lib/components/layout';
	import { GrainPicker, type GrainSegment } from '$lib/components/surface';
	import { Separator } from '$lib/components/ui/separator';
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

	   The reliability surface OWNS ?grain (the rail lives here): seed the selection from ?grain on
	   load + mirror it back, so a windowed view is shareable/deep-linkable. The URL is a HINT, never
	   a data source — an unknown or unavailable grain is clamped to 'day' (the availability clamp
	   below), and replaceState (not pushState) keeps grain switches out of the history stack. */
	type GrainMode = 'day' | 'week' | 'month' | 'range';
	const GRAIN_MODES: readonly GrainMode[] = ['day', 'week', 'month', 'range'];
	const readGrain = (): GrainMode => {
		const p = page.url.searchParams.get('grain');
		return GRAIN_MODES.includes(p as GrainMode) ? (p as GrainMode) : 'day';
	};
	// The single radiogroup selection — exactly one of day|week|month|range is active.
	let viewKey = $state<GrainMode>(readGrain());
	// The effective window mode IS the single selection (range when 'range' is picked,
	// otherwise the calendar grain). Kept as a named derived so the mapper/caption
	// logic below reads unchanged from the prior single-select model.
	const mode = $derived<GrainMode>(viewKey);
	let rangeStart = $state<string>('');
	let rangeEnd = $state<string>('');

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
	let grainClamped = false;
	$effect(() => {
		if (grainClamped) return;
		grainClamped = true;
		if ((viewKey === 'week' || viewKey === 'month') && !availableGrains.has(viewKey))
			viewKey = 'day';
		else if (viewKey === 'range' && !hasDatedPeriods) viewKey = 'day';
	});

	// Mirror the effective grain to ?grain (shareable/deep-linkable), omitting the 'day' default for a
	// clean canonical URL. Disjoint from RouteDetail's ?tab writer (a different param), so they compose
	// without racing.
	$effect(() => mirrorSearchParam('grain', mode === 'day' ? null : mode));

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

	// What the mapper resolves for. In range mode we thread the picked window to
	// the mapper via `dateRange` (grain stays 'day') so the strip aggregates the
	// in-range days + the trend zooms. Outside range mode the segment IS the grain.
	const mapperOpts = $derived<{ grain: string; dateRange?: { start: string; end: string } }>(
		mode === 'range' ? { grain: 'day', dateRange: normalizedRange } : { grain: mode },
	);

	// One mapping pass — every band reads its slice of this.
	const clusters = $derived(toReliabilityClusters(data, mapperOpts));

	// Segments carry an `available` flag; an unavailable grain renders disabled
	// (never selectable) so the control can't resolve to an empty grain. ONE control:
	// the three calendar grains PLUS the lines-only "range" option (offered only when
	// the contract carries dated day-periods to range over). Folding range in as a 4th
	// mutually-exclusive segment makes the active highlight single-select by
	// construction — picking range deselects the grain and vice-versa.
	const segments = $derived<GrainSegment<GrainMode>[]>([
		{ key: 'day', label: copy.controls.today, available: availableGrains.has('day') },
		{ key: 'week', label: copy.controls.thisWeek, available: availableGrains.has('week') },
		{ key: 'month', label: copy.controls.thisMonth, available: availableGrains.has('month') },
		{ key: 'range', label: copy.controls.dateRange, available: hasDatedPeriods },
	]);

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

	/* ── mobile control collapse ────────────────────────────────────────────────
	   On a phone the dense reliability surface can't spare the vertical space the
	   full control rail eats, so the controls collapse behind a one-line summary
	   toggle (the active window). Desktop is UNCHANGED — the body is display:contents
	   so its children hoist into the ControlsRail flex exactly as before, and the
	   toggle is hidden. Instant-apply everywhere: a grain switch only re-derives the
	   client-side mapper (no reload), so mobile needs no batch-apply. */
	let controlsOpen = $state(false);
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
		<ControlsRail label={copy.controls.viewLabel} sticky>
			<!-- Mobile-only summary toggle: collapses the controls to spare phone vertical
		     space. Hidden on desktop (the rail stays fully visible). -->
			<button
				type="button"
				class="reliability-control-toggle"
				aria-expanded={controlsOpen}
				aria-controls="reliability-control-body"
				onclick={() => (controlsOpen = !controlsOpen)}
				data-slot="controls-toggle"
			>
				<span>{copy.controls.viewLabel}: {controlsSummary}</span>
				<svg
					class="reliability-control-chevron"
					viewBox="0 0 16 16"
					width="14"
					height="14"
					aria-hidden="true"
				>
					<path
						d="M4 6l4 4 4-4"
						fill="none"
						stroke="currentColor"
						stroke-width="1.6"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</button>
			<!-- Desktop: the grain controls (left) sit BESIDE the section TOC (right) in a
			     2-column grid so the sticky rail stays compact (operator: "not too thick").
			     Mobile: stacks to one column (the controls collapse behind the toggle above). -->
			<div class="reliability-rail-grid">
				<div
					id="reliability-control-body"
					class={cn('reliability-control-body', controlsOpen && 'reliability-control-body--open')}
					data-slot="controls-body"
				>
					<GrainPicker {segments} bind:value={viewKey} label={copy.controls.grainLabel} />

					{#if mode === 'range'}
						<!-- Start + end pair over the dated day-periods. start == end = one day
			     (exact); a wider span aggregates the in-range days (mean) + zooms the
			     trend. Bounds are real dates only, so no out-of-window pick is possible. -->
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

					<!-- Active-window caption: names the window the selection resolves to so the
		     reader is never unsure what "Today / This week / {date}" actually covers. -->
					<p class="reliability-window" data-slot="active-window" aria-live="polite">
						{activeWindowCaption}
					</p>
					<!-- Scope note (filter clarity): which sections the window above actually drives. -->
					<p class="reliability-scope-note" data-slot="scope-note">{copy.controls.scopeNote}</p>
				</div>

				<!-- Section TOC (wayfinding) — always visible (outside the mobile collapse). Each
			     entry jumps to its section AND shows its filter scope: ↻ follows the window
			     above, ∞ full history. The sticky bar answers "where am I / what does the
			     window change" in one place. -->
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
			</div>
		</ControlsRail>

		<!-- Hazard tape discerns the controls zone from the data canvas. -->
		<Separator variant="hazard" hazardSize="sm" />

		<!-- §0 Verdict — "Can you count on this line?" The grain rail re-shapes only the trend. -->
		<div class="reliability-band surface-bleed" id="rel-verdict" data-band="verdict">
			<Section0Verdict vm={clusters.punctuality} {locale} {copy} {mode} />
		</div>

		<!-- §1 When to ride — the 7×24 heatmap hero + the time-of-day / weekday detail. -->
		<div class="reliability-band surface-bleed" id="rel-when-to-ride" data-band="when-to-ride">
			<Section1WhenToRide
				punctuality={clusters.punctuality}
				habits={clusters.habits}
				{locale}
				{copy}
			/>
		</div>

		<!-- §2 The wait — scheduled-vs-observed headway + (detail) regularity + service span. -->
		<div class="reliability-band surface-bleed" id="rel-the-wait" data-band="the-wait">
			<Section2TheWait
				wait={clusters.waitRegularity}
				serviceSpans={clusters.serviceDelivered.serviceSpans}
				{locale}
				{copy}
				{directionHeadsigns}
			/>
		</div>

		<!-- §3 Will it run & will you fit — cancellations/skips + crowding (grain-windowed). -->
		<div class="reliability-band surface-bleed" id="rel-run-and-fit" data-band="run-and-fit">
			<Section3RunAndFit
				service={clusters.serviceDelivered}
				crowding={clusters.crowding}
				{locale}
				{copy}
				windowLabel={controlsSummary}
			/>
		</div>

		<!-- §4 Where it's worst — the worst-N stops accountability lollipop. -->
		<div class="reliability-band surface-bleed" id="rel-worst-stops" data-band="worst-stops">
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

	/* Active-window caption — quiet mono, AA against the page surface; chrome, so it
	   stays inside the ControlsRail body alongside the grain control. Full-width so it
	   drops onto its own row beneath the chips. */
	.reliability-window {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.reliability-scope-note {
		margin: 0.15rem 0 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1.4;
		color: var(--muted-foreground);
	}

	/* Section TOC (wayfinding + filter-scope map): a horizontal nav of the 5 sections,
	   each a jump link + a scope glyph (↻ follows the window / ∞ full history). Always
	   visible (a sibling of the collapsible control body); wraps on narrow widths. */
	.reliability-toc {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.4rem 0.75rem;
		width: 100%;
		margin-top: 0.5rem;
		padding-top: 0.6rem;
		border-top: 1px solid var(--border-subtle, var(--border));
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
		gap: 0.4rem;
		min-height: 34px;
		padding: 0.3rem 0.7rem;
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

	/* Mobile control-collapse (S7): on a phone the controls collapse behind a one-line
	   summary toggle to spare the dense surface's vertical space. Desktop is UNCHANGED —
	   the body is display:contents (its children hoist into the ControlsRail flex) and
	   the toggle is hidden. Only the ≤767px query collapses it. Quiet chrome: the toggle
	   is neutral-bordered (no --primary; that lives on the active grain chip inside). */
	.reliability-control-toggle {
		display: none;
	}
	/* 2-column rail (operator: "not too thick"): the grain controls sit BESIDE the section
	   TOC so the sticky bar is half as tall. Mobile collapses to one column below. */
	.reliability-rail-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.75rem;
		width: 100%;
	}
	.reliability-control-body {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}
	@media (min-width: 768px) {
		.reliability-rail-grid {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
			gap: 0.75rem 2rem;
			align-items: start;
		}
		/* In 2-col the TOC's divider becomes a left rule (not a top rule). */
		.reliability-toc {
			margin-top: 0;
			padding-top: 0;
			padding-left: 1.5rem;
			border-top: none;
			border-left: 1px solid var(--border-subtle, var(--border));
			align-content: start;
		}
	}
	@media (max-width: 767px) {
		.reliability-control-toggle {
			display: inline-flex;
			align-items: center;
			justify-content: space-between;
			gap: 0.5rem;
			width: 100%;
			padding: 0.5rem 0.75rem;
			font-family: var(--font-mono);
			font-size: var(--text-small);
			color: var(--foreground);
			background: var(--card);
			border: 1px solid var(--border);
			border-radius: var(--radius-md, 0.5rem);
			cursor: pointer;
		}
		.reliability-control-toggle:focus-visible {
			outline: 2px solid var(--ring);
			outline-offset: 2px;
		}
		.reliability-control-chevron {
			flex: none;
			transition: transform 0.15s ease;
		}
		.reliability-control-toggle[aria-expanded='true'] .reliability-control-chevron {
			transform: rotate(180deg);
		}
		.reliability-control-body {
			display: none;
			flex-basis: 100%;
		}
		.reliability-control-body--open {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 0.625rem;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.reliability-control-chevron {
			transition: none;
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
		width: 100%;
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
