<!--
  HotspotsBoard — the /hotspots accountability surface ORCHESTRATOR (S12 re-seat).

  Re-seats the former flat /worst-normalized RankedRow board onto the S12
  re-granulated by_grain ladders. This thin orchestrator owns EVERYTHING the sections
  must not: the getHotspots resource, the codec-seeded grain + worst-N state (seeded
  from ?grain/?n via $lib/filters, clamped to the populated grains, mirrored back to
  the URL), the ONE mapping pass through the pure hotspotLadder selector, the
  SurfaceHeader + FreshnessStamp + the sticky SurfaceControls rail, and the honest
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
	import { getHotspots } from '$lib/v1';
	import type { HotspotEntry } from '$lib/v1/schemas';
	import { createResource } from '$lib/v1/resource.svelte';
	import {
		ResourceBoundary,
		SurfaceHeader,
		FreshnessStamp,
		SurfaceControls,
	} from '$lib/components/surface';
	import { Surface } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';
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

	const grainAvailability = $derived<Partial<Record<HotspotGrainKey, { available: boolean }>>>(
		Object.fromEntries(HOTSPOT_GRAINS.map((g) => [g, { available: present.has(g) }])),
	);
	const grainLabels = $derived<Partial<Record<HotspotGrainKey, string>>>({
		day: t.grain.day,
		week: t.grain.week,
		month: t.grain.month,
		shift: t.grain.shift,
	});
	// The grain picker is a dead control when only one grain carries data — render it
	// ONLY when more than one grain is populated.
	const showGrainPicker = $derived(present.size > 1);

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

	// Whole-file empty: the payload populates NO grain at all (no ladder anywhere).
	const isEmpty = $derived(present.size === 0);
</script>

<Surface class="hotspots">
	<SurfaceHeader kicker={t.kicker} heading={t.heading} subheading={t.subheading} lede={t.lede}>
		<FreshnessStamp variant="updated" {generatedUtc} {locale} />
	</SurfaceHeader>

	<Separator variant="hazard" />

	<!-- The boundary gates skeleton / error / (no-file) empty. A PUBLISHED file that
	     populates no grain is a legitimate "nothing is a hotspot right now" reading, so
	     we render that honest, surface-specific empty note inside the children. -->
	<ResourceBoundary resource={hotspots} lang={locale}>
		{#if isEmpty}
			<div class="hotspots-note" data-slot="hotspots-empty">
				<AbsentValue variant="block" reason="no-observations" {locale} />
			</div>
		{:else}
			<section class="hotspots-region" aria-label={t.heading}>
				{#if showGrainPicker}
					<SurfaceControls
						offered={HOTSPOT_GRAINS}
						availability={grainAvailability}
						bind:value={grainKey}
						minPoints={1}
						labels={grainLabels}
						grainLabel={t.grain.label}
						railLabel={t.viewControlsLabel}
						sticky
						{locale}
					/>
					<Separator variant="hazard" hazardSize="sm" />
				{/if}

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
			</section>
		{/if}
	</ResourceBoundary>
</Surface>

<style>
	.hotspots-region {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-width: 76rem;
	}
	.hotspots-caveat {
		margin: 0;
		max-width: 52ch;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	/* The honest empty state wraps the styled AbsentValue block; the container centers it. */
	.hotspots-note {
		display: flex;
		justify-content: center;
		padding: 0.5rem 0;
	}
</style>
