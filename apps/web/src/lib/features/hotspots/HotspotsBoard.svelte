<!--
  HotspotsBoard — the /hotspots accountability surface ORCHESTRATOR (S12 re-seat).

  Re-seats the former flat /worst-normalized RankedRow board onto the S12
  re-granulated by_grain ladders. This thin orchestrator owns EVERYTHING the sections
  must not: the getHotspots resource, the codec-seeded grain + worst-N state (seeded
  from ?grain/?n via $lib/filters, clamped to the populated grains, mirrored back to
  the URL), the ONE mapping pass through the pure hotspotLadder selector, the
  Masthead + FreshnessStamp + the sticky SurfaceControls rail, and the honest
  absence. HotspotSection is a pure presenter fed one built ladder + tray.

  RANKING (DECISIONS WEB1): the bar encodes each cell's SEVERE-DELAY RATE on the
  ABSOLUTE SEVERE_DOMAIN [0,100] — the rank variable, always >= 0, DB-ranked
  worst-first by the not-severe Wilson lower bound (cross-kind: the SAME metric for
  route and stop). otp_delta_pts is a DISPLAY/evidence field, never the rank. NO
  /worst, NO in-view normalization — the old banned idiom is gone, so the file is OFF
  the chartDoctrine allowlist.

  PER-CITY FORK (DECISIONS WEB2 · spec (d)): the S12-DB contract carries NO per-cell
  city/provider discriminator (HotspotEntry has no city field — confirmed against
  hotspots.ts). A single app instance serves ONE provider (STM today), so the
  "per-city section loop keyed by provider" degenerates to ONE section here — inventing
  a provider loop over data with no provider dimension would fabricate structure. When
  the DB later adds a per-cell city, group here by that SERVED label; until then the
  ladder is the whole (single-provider) network. Recorded fork.

  GRAINS (DECISIONS DB1/WEB4): day/week/month + a 4th 'shift' time-of-day segment on
  the SAME rail (never a per-row sub-breakdown). A grain is offered iff the payload
  serves a populated ladder for it.

  HONESTY: a grain with no ranked entry shows the styled AbsentValue chip (says WHY),
  never a fake 0; a null severe_pct row draws the no-data swatch (value:null). The
  whole-file empty (no populated grain) keeps the published-empty honest note. The
  un-ranked tray shows sub-MIN_N cells for transparency, explicitly NOT ranked. All
  prose comes from ./hotspots.copy (en + fr).
-->
<script lang="ts">
	import { page } from '$app/state';
	import { getLocale, localizeHref, type Locale } from '$lib/i18n';
	import { routeFor, type SurfaceKind } from '$lib/nav';
	import { fromSearchParams, toSearchParams, emptyFilterState, type WorstN } from '$lib/filters';
	import { mirrorSearchParams } from '$lib/site/urlMirror';
	import { describeAbsence } from '$lib/site/absence';
	import { getHotspots } from '$lib/v1';
	import type { HotspotEntry } from '$lib/v1/schemas';
	import { createResource } from '$lib/v1/resource.svelte';
	import {
		ResourceBoundary,
		FreshnessStamp,
		SurfaceRail,
		GrainPicker,
		type GrainSegment,
	} from '$lib/components/surface';
	import { Masthead } from '$lib/components/brand';
	import { Surface } from '$lib/components/layout';
	import { AbsentValue } from '$lib/components/edge';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';

	import {
		presentGrains,
		defaultHotspotGrain,
		ladderByGrain,
		HOTSPOT_GRAINS,
		type HotspotGrainKey,
	} from './data/presentGrains';
	import { worstNCap, DEFAULT_WORST_N } from './data/ladderCap';
	import { selectHotspotLadder } from './selectors/hotspotLadder';
	import HotspotSection from './sections/HotspotSection.svelte';
	import { copy as COPY } from './hotspots.copy';

	const locale: Locale = getLocale();
	const t = $derived(COPY[locale]);

	// The metric-explainer (i) affordance: a one-line tip + a localized deep link to
	// /metrics#<anchor>. The ladder ranks by the SEVERE-delay rate, so the (i) explains
	// severe_pct (same wiring as the lines/network surfaces).
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});
	const severeInfo = $derived(info('severe', t.ladder.severeRateLabel));

	// `freshness: true` feeds generated_utc into the shared newest-data timestamp.
	const hotspots = createResource(() => getHotspots(), { freshness: true });
	const generatedUtc = $derived(hotspots.data?.generated_utc ?? null);

	/* ── grain vocabulary + availability ──────────────────────────────────────────── */
	// The served ladders, indexed by their (known) grain. Unknown grains are dropped.
	const ladders = $derived(ladderByGrain(hotspots.data?.by_grain));
	const present = $derived(presentGrains(hotspots.data?.by_grain));

	// CONTRACT: the codec ($lib/filters) owns the ?grain seam — fromSearchParams
	// enum-parses the seed; invalid values drop. The SELECTION + the populated-grain
	// clamp stay SURFACE-LOCAL (only this surface knows which grains its ladders fill).
	let grainKey = $state<HotspotGrainKey>(
		(() => {
			// The codec owns day/week/month (?grain). The 'shift' cut is NOT a codec Grain, so
			// it is read from the raw ?grain param here so a deep link to the time-of-day cut
			// still seeds. An unknown/absent value falls to the day default.
			const raw = page.url.searchParams.get('grain');
			if (raw === 'shift') return 'shift';
			const seeded = fromSearchParams(page.url.searchParams).grain;
			return seeded === 'week' || seeded === 'month' ? seeded : 'day';
		})(),
	);

	const grainLabels = $derived<Partial<Record<HotspotGrainKey, string>>>({
		day: t.grain.day,
		week: t.grain.week,
		month: t.grain.month,
		shift: t.grain.shift,
	});
	// The grain picker is a dead control when only one grain carries data — render it
	// ONLY when more than one grain is populated. When it is off, the rail has nothing
	// to show, so the board renders single-column (no empty glass rail).
	const showGrainPicker = $derived(present.size > 1);

	// Instance-unique id prefix so a disabled segment's aria-describedby id never collides
	// with another surface's controls on the same page.
	const uid = $props.id();
	const disabledReason = $derived(describeAbsence('no-observations', locale).why);
	// The GrainPicker segments seated in the rail — one per HOTSPOT_GRAINS key, in
	// finest→coarsest order. An unavailable grain renders disabled (never selectable), each
	// disabled segment carrying the honest-absence reason (aria-describedby + pointer title).
	// This is the same availability wiring SurfaceControls built internally; the rail composes
	// GrainPicker directly (like the lines reliability rail) so the control seats in the glass
	// panel + the mobile sheet.
	const grainSegments = $derived<GrainSegment<HotspotGrainKey>[]>(
		HOTSPOT_GRAINS.map((key) => {
			const available = present.has(key);
			return {
				key,
				label: grainLabels[key] ?? key,
				available,
				...(available ? {} : { describedById: `${uid}-reason-${key}`, title: disabledReason }),
			};
		}),
	);

	// Keep the selection on a POPULATED grain (the clamp): a chosen grain whose ladder
	// is absent falls back to the richest present grain. Never a dead/empty grain.
	$effect(() => {
		if (present.size > 0 && !present.has(grainKey)) grainKey = defaultHotspotGrain(present);
	});

	/* ── worst-N cap (codec ?n) ───────────────────────────────────────────────────── */
	let worstN = $state<WorstN>(fromSearchParams(page.url.searchParams).worstN ?? DEFAULT_WORST_N);
	const cap = $derived(worstNCap(worstN));

	// Mirror grain + worst-N together in ONE replaceState (day + default N → omitted for a
	// clean canonical URL). The shift grain is NOT a codec Grain, so it's mirrored raw.
	const wire = $derived.by<{ grain: string | null; n: string | null }>(() => {
		const state = emptyFilterState();
		if (worstN !== DEFAULT_WORST_N) state.worstN = worstN;
		const grainParam =
			grainKey === 'day'
				? null
				: grainKey === 'shift'
					? 'shift'
					: ((): string | null => {
							state.grain = grainKey;
							return toSearchParams(state).get('grain');
						})();
		return { grain: grainParam, n: toSearchParams(state).get('n') };
	});
	$effect(() => mirrorSearchParams(wire));

	/* ── the ONE mapping pass ─────────────────────────────────────────────────────── */
	// A row's nav target: the pipeline owns `type` as a free string; map the two known
	// kinds to their SurfaceKind for the drill link. Unknown → no link.
	function navKindFor(type: string): SurfaceKind | null {
		const k = type.toLowerCase();
		if (k === 'route' || k === 'line') return 'line';
		if (k === 'stop') return 'stop';
		return null;
	}
	function hrefFor(e: HotspotEntry): string | null {
		const kind = navKindFor(e.type);
		return kind ? localizeHref(routeFor({ kind, id: e.id }), locale) : null;
	}
	function typeTag(type: string): string | null {
		const kind = navKindFor(type);
		if (kind === 'line') return t.type.route;
		if (kind === 'stop') return t.type.stop;
		return null;
	}

	// Per-row evidence note: "severe X% · avg Y min · n=Z", each fragment null-guarded.
	function ladderNote(e: HotspotEntry): string {
		const parts: string[] = [];
		if (e.severe_pct != null)
			parts.push(`${t.note.severe} ${Math.round(e.severe_pct)}${t.units.pct}`);
		if (e.avg_delay_min != null)
			parts.push(`${t.note.avg} ${Math.round(e.avg_delay_min * 10) / 10}${t.units.min}`);
		if (e.observation_count != null) parts.push(`${t.note.samples}=${e.observation_count}`);
		return parts.join(' · ');
	}

	const activeLadder = $derived(ladders.get(grainKey));

	// §C5.10 #1-HOTSPOT CALLOUT: the already-computed otp_delta_pts of the WORST-ranked
	// cell, finally SHOWN as the headline reading above the ladder. entries[] is DB-ranked
	// worst-first (cross-kind), so entries[0] is the #1 hotspot. A null delta reads the
	// name-only sentence (honest absence — never a fabricated loss); an empty ladder reads
	// the stand-down line.
	const topHotspot = $derived<HotspotEntry | null>(activeLadder?.entries?.[0] ?? null);
	const topHotspotName = $derived(
		topHotspot ? (topHotspot.name ?? t.unnamed(topHotspot.id)) : null,
	);
	const verdictLine = $derived.by<string>(() => {
		if (!topHotspot || topHotspotName == null) return t.verdict.none;
		const d = topHotspot.otp_delta_pts;
		if (d == null) return t.verdict.topNoDelta(topHotspotName);
		// otp_delta_pts is signed loss in points; show its magnitude with the deltaLost voice.
		const pts = `${Math.abs(Math.round(d))}${t.units.pts}`;
		return t.verdict.topWithDelta(topHotspotName, pts);
	});
	const topHotspotHref = $derived(topHotspot ? hrefFor(topHotspot) : null);

	// WEB2: entries[] is a MIXED route+stop array ranked PER KIND. The section renders one
	// TAB per kind, so build a ladder for EACH kind by filtering entries[] by type
	// losslessly. shown/total per kind uses the DB's per-kind ranked totals
	// (total_ranked_routes / total_ranked_stops) — a display-N truncation never rescales.
	function ladderFor(kind: 'route' | 'stop', total: number | null | undefined) {
		const kindEntries = (activeLadder?.entries ?? []).filter((e) => e.type === kind);
		const res = selectHotspotLadder(kindEntries, cap, locale, {
			title: t.ladder.heading,
			xLabel: t.ladder.severeRateLabel,
			unit: t.units.pct,
			ciLabel: t.ladder.ci,
			note: ladderNote,
			unnamed: t.unnamed,
			href: hrefFor,
		});
		// The DB's pre-truncation per-kind ranked count is the honest `total`; the served
		// entries[] is already capped to the per-kind stored cap, so prefer the DB count
		// when present (it is >= res.total), else fall back to the served length.
		return { ...res, total: total ?? res.total };
	}
	const routeLadder = $derived(ladderFor('route', activeLadder?.total_ranked_routes));
	const stopLadder = $derived(ladderFor('stop', activeLadder?.total_ranked_stops));

	// The un-ranked tray rows (sub-MIN_N cells) mapped to the section's display shape,
	// split by kind so each tab shows only its own kind's tray.
	function trayFor(kind: 'route' | 'stop') {
		return (activeLadder?.tray ?? [])
			.filter((e) => e.type === kind)
			.map((e) => {
				const href = hrefFor(e);
				const title = e.name ?? t.unnamed(e.id);
				const tag = typeTag(e.type);
				return {
					key: `${e.type}-${e.id}`,
					title,
					subtitle: t.tray.rowSubtitle(tag ?? e.type, e.id),
					href,
					ariaLabel: t.viewDetail(title),
				};
			});
	}
	const routeTray = $derived(trayFor('route'));
	const stopTray = $derived(trayFor('stop'));

	// The trailing-window caption for the active grain (a shift cut has no window).
	const windowCaption = $derived(t.window[grainKey]);

	// The mobile rail pill's summary — the active grain's label (so the collapsed pill
	// names the current view).
	const controlsSummary = $derived(grainLabels[grainKey] ?? '');

	// Whole-file empty: the payload populates NO grain at all (no ladder anywhere).
	const isEmpty = $derived(present.size === 0);
</script>

<Surface class="hotspots">
	<Masthead kicker={t.kicker} heading={t.heading} subheading={t.subheading} lede={t.lede}>
		{#snippet meta()}
			<FreshnessStamp variant="updated" {generatedUtc} {locale} />
		{/snippet}
	</Masthead>

	<!-- The boundary gates skeleton / error / (no-file) empty. A PUBLISHED file that
	     populates no grain is a legitimate "nothing is a hotspot right now" reading, so
	     we render that honest, surface-specific empty note inside the children. -->
	<ResourceBoundary resource={hotspots} lang={locale}>
		{#if isEmpty}
			<div class="hotspots-note" data-slot="hotspots-empty">
				<AbsentValue variant="block" reason="no-observations" {locale} />
			</div>
		{:else}
			<!-- P5.4: the grain control lives in a map-style GLASS LEFT RAIL (SurfaceRail) — a
			     sticky floating panel beside the ladder on desktop, ONE pill→sheet on mobile.
			     This surface has NO numbered sections to jump to (one region, route|stop tabs),
			     so the rail holds ONLY the grain picker (no ToC); the per-tab worst-N cap stays
			     INLINE in HotspotSection. When ≤1 grain is populated the rail has nothing to
			     show, so the board renders single-column with no rail. --primary lives only on
			     the active grain chip. -->
			{#snippet railContent()}
				<div class="hotspots-control-body" data-slot="controls-body">
					<span class="hotspots-rail-view" data-slot="controls-rail-label"
						>{t.viewControlsLabel}</span
					>
					<GrainPicker segments={grainSegments} bind:value={grainKey} label={t.grain.label} />
					<!-- Disabled-reason descriptions (honest-absence): one visually-hidden span per
					     disabled segment, referenced by its radio via aria-describedby. -->
					{#each grainSegments as seg (seg.key)}
						{#if seg.describedById}
							<span id={seg.describedById} class="hotspots-reason" data-slot="controls-reason"
								>{disabledReason}</span
							>
						{/if}
					{/each}
					<!-- Active-window caption: names the trailing window the grain resolves to. -->
					<p class="hotspots-window" data-slot="active-window" aria-live="polite">
						{windowCaption}
					</p>
				</div>
			{/snippet}

			<section
				class="hotspots-region"
				class:hotspots-region--railed={showGrainPicker}
				aria-label={t.heading}
			>
				{#if showGrainPicker}
					<!-- The map-style GLASS LEFT RAIL: a sticky floating grain panel beside the
					     ladder on desktop; ONE pill→sheet on mobile. -->
					<SurfaceRail
						rail={railContent}
						label={t.viewControlsLabel}
						summary={controlsSummary}
						openAria={t.filterPillOpen}
						closeAria={t.filterPillClose}
					/>
				{/if}

				<!-- The content column beside the rail (or the whole width when there is no rail). -->
				<div class="hotspots-content">
					<!-- §C5.10 verdict line + #1-hotspot callout ABOVE the ladder: the
					     already-computed otp_delta_pts, finally shown as the headline reading. The
					     #1 name links to its detail page when it maps to a route/stop. -->
					<div class="hotspots-verdict" data-slot="hotspots-verdict" aria-label={t.verdict.label}>
						{#if topHotspotHref}
							<a class="hotspots-verdict-line" href={topHotspotHref}>{verdictLine}</a>
						{:else}
							<p class="hotspots-verdict-line">{verdictLine}</p>
						{/if}
					</div>

					<!-- ONE ladder section (the single-provider network — see the per-city fork
					     note above), split into route|stop TABS (WEB2). When the DB adds a
					     per-cell city, this becomes a loop over the served city labels. -->
					<HotspotSection
						heading={t.ladder.heading}
						{routeLadder}
						{stopLadder}
						{routeTray}
						{stopTray}
						{windowCaption}
						info={severeInfo}
						bind:worstN
						{locale}
						copy={t}
					/>

					<!-- Honest caveat: a trailing-window ranking, not a certified league table. -->
					<p class="hotspots-caveat" data-slot="hotspots-caveat">{t.caveat}</p>
				</div>
			</section>
		{/if}
	</ResourceBoundary>
</Surface>

<style>
	/* The region: a single content column when there is no rail (≤1 populated grain), or a
	   2-col [rail | content] grid when the grain rail is shown (P5.4). The content column is
	   the rail's sticky containing block, so the glass rail stays pinned beside the ladder. */
	.hotspots-region {
		display: grid;
		grid-template-columns: 1fr;
		gap: clamp(1.5rem, 4vw, 2rem);
		width: 100%;
		max-width: 76rem;
	}
	@media (min-width: 1024px) {
		.hotspots-region--railed {
			grid-template-columns: minmax(13rem, 15rem) minmax(0, 1fr);
			gap: 2rem;
			align-items: start;
		}
	}
	/* The content column — verdict callout + ladder + caveat. */
	.hotspots-content {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 0;
	}
	/* The grain controls seated in the rail (View overline + GrainPicker + window caption),
	   rendered by SurfaceRail in BOTH the desktop glass rail and the mobile sheet. */
	.hotspots-control-body {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.5rem;
		min-width: 0;
	}
	/* The grain radiogroup wraps so a long localized segment never overflows the narrow rail;
	   the active-chip accent lives in GrainPicker. */
	.hotspots-control-body :global([data-slot='grain-picker']) {
		min-width: 0;
		flex-wrap: wrap;
	}
	/* The "View" overline — the quiet mono rail label. */
	.hotspots-rail-view {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--tracking-eyebrow);
		color: var(--muted-foreground);
	}
	/* Visually-hidden disabled-reason description (mobile drawer + desktop) — carried for
	   screen readers via aria-describedby on the disabled radio; never a layout box. */
	.hotspots-reason {
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
	/* Active-window caption — quiet mono note beneath the picker. */
	.hotspots-window {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1.3;
		color: var(--muted-foreground);
	}
	.hotspots-caveat {
		margin: 0;
		max-width: 52ch;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	/* §C5.10 #1-hotspot callout: the headline reading above the ladder. Reads at
	   foreground weight so the worst spot is impossible to miss; a linked #1 hovers to
	   the interactive accent. */
	.hotspots-verdict-line {
		display: inline-block;
		margin: 0;
		max-width: 60ch;
		font-family: var(--font-body);
		font-size: var(--text-subheading);
		line-height: 1.45;
		color: var(--foreground);
		text-decoration: none;
	}
	a.hotspots-verdict-line {
		border-bottom: 1px solid transparent;
		transition: border-color var(--duration-fast) var(--ease-default);
	}
	a.hotspots-verdict-line:hover,
	a.hotspots-verdict-line:focus-visible {
		border-bottom-color: var(--primary);
	}
	a.hotspots-verdict-line:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}
	/* The honest empty state wraps the styled AbsentValue block; the container centers it. */
	.hotspots-note {
		display: flex;
		justify-content: center;
		padding: 0.5rem 0;
	}
</style>
