<!--
  StopDetail — tabbed detail for one stop (slice-9.3).

  Composes the surface spine's EntityDetail scaffold over four canonical tabs:

    next         LIVE  — the live store's per-stop departures board
                         (live.index.byStopId.get(id)), with a freshness chip.
    schedule    STATIC — the static stop's scheduled[] (route + headsign + times).
    info        STATIC — position, code, accessibility + routes served.
    reliability HISTORIC— per-period OTP/delay (→ ReliabilityPane) + by-route
                         avg-delay breakdown.

  Static + historic reads use createResource (browser-side, reactive to `id`);
  the live tier uses createLiveStore (start on mount, stop on destroy). Each pane
  fail-soft via ResourceBoundary / EdgeState — never invent data, never crash.

  Reads locale via getLocale(); copy is co-located in stops.copy.ts. Domain
  vocabulary inside the spine (OTP / delay / LIVE) lives in the primitives.
  Tokens only; --primary interactive-only.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { SvelteSet } from 'svelte/reactivity';
	import { getLocale, localizeHref, type Locale } from '$lib/i18n';
	import { mirrorSearchParam } from '$lib/site/urlMirror';
	import {
		getStop,
		getStopReliability,
		createLiveStore,
		getV1Context,
		alertsForStop,
		type StopFile,
		type StopReliability,
		type StopDeparture,
	} from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import { sharedClock } from '$lib/stores';
	import { minutesSinceMidnight } from '$lib/utils/time';
	import { inferAbsenceReason, stopServiceWindow } from '$lib/site/serviceWindow';
	import { depTone, toneColorVar, TONE_GLYPH, type ChipTone } from '$lib/site/delayPresentation';
	import { ScheduleTable, type ScheduleRow } from '$lib/components/schedule';
	import { STATUS_LABELS } from '$lib/v1';
	import type { StatusCode } from '$lib/v1/schemas';
	import {
		EntityDetail,
		ResourceBoundary,
		FreshnessStamp,
		MapDrilldownLink,
		AffectedAlerts,
	} from '$lib/components/surface';
	import { EdgeState } from '$lib/components/edge';
	import { ControlsRail } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';
	import { layout, mapHrefFor } from '$lib/nav';
	import StopLabel from '$lib/components/brand/StopLabel.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import TerminalPanel from '$lib/components/brand/TerminalPanel.svelte';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import CornerMeta from '$lib/components/brand/CornerMeta.svelte';
	import { cornerMetaLabels } from '$lib/components/brand';
	import { Badge } from '$lib/components/ui/badge';
	import { formatUtc } from '$lib/utils/time';
	import { StopReliabilitySurface } from './reliability';
	import { detailCopy } from './stops.copy';

	interface StopDetailProps {
		/** The stop id from the route param. */
		id: string;
	}

	let { id }: StopDetailProps = $props();

	const locale: Locale = getLocale();
	const t = $derived(detailCopy[locale]);
	const edgeLayout = $derived(layout.isDesktop ? 'desktop' : 'mobile');

	// Per-route scheduled-times cap (the 5-col grid is dense, so a slightly higher cap
	// than the old flat-list 24 keeps the pane bounded without dumping hundreds of times;
	// the honest "+N more" note carries the remainder).
	const SCHEDULE_CAP = 30;

	type TabKey = 'next' | 'schedule' | 'info' | 'reliability';
	const tabs = $derived([
		{ key: 'next', label: t.tabs.next },
		{ key: 'schedule', label: t.tabs.schedule },
		{ key: 'info', label: t.tabs.info },
		{ key: 'reliability', label: t.tabs.reliability },
	] as const satisfies readonly { key: TabKey; label: string }[]);

	// A1: deep-linkable tab (RouteDetail parity). Seed from ?tab on load (an unknown
	// value falls to the 'next' default — the URL is a HINT, never a data source), then
	// mirror the active tab to ?tab so a view is shareable. replaceState (not pushState)
	// keeps tab switches out of the history stack; the 'next' default is OMITTED for a
	// clean canonical URL. ?tab is a DIFFERENT key than the surface's ?grain, so the two
	// mirrors merge without clobbering (mirrorSearchParam is single-key).
	const TAB_KEYS: readonly TabKey[] = ['next', 'schedule', 'info', 'reliability'];
	const readTab = (): TabKey => {
		const p = page.url.searchParams.get('tab');
		return TAB_KEYS.includes(p as TabKey) ? (p as TabKey) : 'next';
	};
	let active = $state<TabKey>(readTab());
	$effect(() => mirrorSearchParam('tab', active === 'next' ? null : active));

	// --- live tier: per-stop departures board --------------------------------
	const manifest = getV1Context().manifest;
	const live = createLiveStore(manifest);
	onMount(() => {
		live.start();
		return () => live.stop();
	});

	// CornerMeta readouts (A4) — REAL data only: provider (always, from the manifest)
	// + the live-tier generated stamp (the departures board's freshness); a missing
	// datum drops its corner (never fabricated).
	const cm = cornerMetaLabels[locale];
	const shortName = manifest.short_name?.trim() || manifest.display_name;
	const cornerGeneratedStamp = $derived(
		live.generatedUtc != null ? formatUtc(live.generatedUtc, locale) : null,
	);
	// Departures for THIS stop from the authoritative per-stop board. null before
	// the first tick (skeleton); [] is a real "no upcoming departures" verdict.
	const departures = $derived<readonly StopDeparture[] | null>(
		live.departures ? (live.index.byStopId.get(id) ?? []) : null,
	);

	// --- static tier: stop detail (info + schedule) --------------------------
	const stop = createResource(() => getStop(id));

	// --- live tier: service alerts affecting THIS stop ------------------------
	// An alert affects this stop if it lists the stop id OR its public code in
	// stops[] (the live feed targets stops by CODE, which differs from the static
	// index id for metro stations), OR lists a route (in routes[]) that SERVES
	// this stop (routes_served from the static file). Reuses the live store's
	// already-loaded alerts — no second fetch. Empty -> the AffectedAlerts section
	// stands down. Honest: never fabricated.
	const stopAlerts = $derived(
		alertsForStop(live.alerts?.alerts, id, stop.data?.code, stop.data?.routes_served),
	);

	// --- historic tier: stop reliability -------------------------------------
	// NOTE: unlike RouteDetail, this fetch is NOT gated on an availability flag.
	// stops_index (StopIndexEntry) carries no per-stop `reliability` boolean — the
	// route side has RouteIndexEntry.reliability, the stop side has no equivalent.
	// Adding one would need a pipeline/contract change (out of scope here), so the
	// stop reliability probe stays unconditional + fail-soft (404 → null → empty
	// state). A missing-snapshot 404 here is suppressed at the edge (one-time cache
	// purge / future stops_index flag), not in this client code.
	const reliability = createResource(() => getStopReliability(id));

	// --- HONEST ABSENCE: infer WHY the live board is empty --------------------
	// The stop's own service window is derived from its static schedule times
	// (earliest → latest, GTFS >=24:00 folded so an overnight window wraps). When
	// the board is empty we STATE the inferred reason (service closed — opens at
	// FIRST / overnight / scheduled-but-silent) rather than a generic no-data.
	// Honest by construction: a closed verdict needs a real window; silent needs
	// the non-responding signal; else null → the plain honest no-data copy. NOTE:
	// no metro gap inference at the stop level — a stop can serve mixed modes, so
	// we never over-claim "metro has no realtime" for a stop (that is route-scoped).

	// The stop's service window from its static schedule (all routes' times). null
	// when the static file has no scheduled times to claim a window against.
	const stopWindow = $derived(
		stopServiceWindow((stop.data?.scheduled ?? []).flatMap((s) => s.times ?? [])),
	);

	// Is ANY route serving this stop reported scheduled-but-silent by the live
	// network? (Per-route silent-trip tally ∩ this stop's routes_served.) A hit
	// means "within the window yet nothing is reporting here".
	const stopNonResponding = $derived.by(() => {
		const silent = new Set((live.network?.non_responding_by_route ?? []).map((r) => r.route_id));
		if (silent.size === 0) return false;
		return (stop.data?.routes_served ?? []).some((r) => silent.has(r));
	});

	// The inferred reason the board is empty, recomputed each shared tick. No
	// route_type/gaps metro inference at the stop level (a stop can serve mixed
	// modes — we never over-claim "metro has no realtime" for a stop), so this
	// rests on the service window + the silent signal. Null → plain no-data.
	const departuresAbsenceReason = $derived(
		inferAbsenceReason({
			firstDeparture: stopWindow?.first ?? null,
			lastDeparture: stopWindow?.last ?? null,
			// serverNow: the open/closed verdict must use the true (server-anchored)
			// wall clock, not a skewed client clock (same skew class as freshness).
			nowMinutes: minutesSinceMidnight(new Date(sharedClock.serverNow)),
			nonResponding: stopNonResponding,
		}),
	);

	/* ── Live departures: status + route filters ──────────────────────────────
	   The live board carries a delay_min per departure; the reader narrows it with
	   combinable status chips + an optional by-route chip. The status is now the
	   SITE-WIDE shared delayTone (five-tone: early / on-time / late / severe), so a
	   badly-late passage reads 'severe' (its own --dataviz-status-severe fill) instead
	   of being absorbed into 'late'. An ABSENT delay is an absent realtime delta, NOT
	   an on-time claim: it rides delayTone's 'none' no-data track (muted, no fill, no
	   glyph) and matches no status chip — visible only under "all". The four
	   FILTERABLE tones stay chips on the shared vocabulary. Both filters default
	   "off" (everything shown); an empty result shows a localized empty state. */
	const DEPARTURE_TONES: readonly ChipTone[] = ['on-time', 'late', 'severe', 'early'];

	// Map a departure tone → the closed StatusCode so the chips + row status read the
	// ONE shared bilingual vocabulary (STATUS_LABELS) — no invented per-surface labels.
	// The tone → glyph/fill mapping (TONE_GLYPH / toneColorVar / depTone) is the shared
	// delayPresentation kernel, reused verbatim by the ScheduleTable board rows.
	const TONE_STATUS: Record<ChipTone, StatusCode> = {
		early: 'early',
		'on-time': 'on_time',
		late: 'late',
		severe: 'severe',
	};
	const toneLabel = (tone: ChipTone): string => STATUS_LABELS[locale][TONE_STATUS[tone]];

	const statusFilter = new SvelteSet<ChipTone>();
	let routeFilter = $state<string | null>(null);

	// ONE StopDetail instance is reused across /stop/A → /stop/B param changes, so
	// per-stop live-board filter state would otherwise carry over stale. Reading `id`
	// registers the dependency: on each stop change we reset the departure filters for
	// the new stop. Grain now lives in <StopReliabilitySurface> (codec-seeded, re-mounts
	// with the keyed pane); `active` is owned by the ?tab mirror + seed, so neither is
	// reset here (a deep-linked tab must survive).
	$effect(() => {
		void id;
		statusFilter.clear();
		routeFilter = null;
	});

	function toggleStatus(s: ChipTone): void {
		if (statusFilter.has(s)) statusFilter.delete(s);
		else statusFilter.add(s);
	}

	// Distinct routes on the current board (stable, board order), for the chips.
	const departureRoutes = $derived.by<string[]>(() => {
		const seen = new SvelteSet<string>();
		const out: string[] = [];
		for (const d of departures ?? []) {
			if (d.route != null && !seen.has(d.route)) {
				seen.add(d.route);
				out.push(d.route);
			}
		}
		return out;
	});

	// A route that leaves the board (filter narrowed away) is cleared so the view
	// never pins to a route with no departures.
	$effect(() => {
		if (routeFilter != null && !departureRoutes.includes(routeFilter)) routeFilter = null;
	});

	const filteredDepartures = $derived.by<readonly StopDeparture[] | null>(() => {
		if (departures == null) return null;
		return departures.filter((d) => {
			if (statusFilter.size > 0) {
				const tone = depTone(d.delay_min);
				if (tone === 'none' || !statusFilter.has(tone)) return false;
			}
			if (routeFilter != null && d.route !== routeFilter) return false;
			return true;
		});
	});

	// A departure's delay caption via the site-wide shared delayLabel. `t.next` omits
	// a `noDelay` string, so an absent delay falls back to "on time" — the scheduled
	// departure board reads no-realtime-delta as on time (NOT "no data"), preserving
	// this surface's prior null/0 → on-time semantics.
</script>

<EntityDetail
	kicker={t.kicker}
	back={{ href: localizeHref('/stops', locale), label: t.back }}
	lede={t.detailLede}
	{tabs}
	bind:active
>
	{#snippet cornerMeta()}
		<!-- A4: blueprint-margin corners — stop id · generated · provider (real data
		     from the manifest + the live tier). aria-hidden, hidden < 768px. -->
		<CornerMeta>
			{#snippet topLeft()}<span class="stop-corner">{cm.stop} · {id}</span>{/snippet}
			{#snippet topRight()}{#if cornerGeneratedStamp}<span class="stop-corner"
						>{cm.generated} · {cornerGeneratedStamp}</span
					>{/if}{/snippet}
			{#snippet bottomLeft()}<span class="stop-corner">{cm.provider} · {shortName}</span>{/snippet}
		</CornerMeta>
	{/snippet}

	{#snippet header()}
		<!-- The framing head the stop index already earns (kicker + display title +
		     lede, §C5.6): the stop NAME is the display-scale h1 (+ brand dot); the
		     mono ARRÊT plate demotes to a meta chip below. -->
		<SectionHeading heading={stop.data?.name ?? `#${id}`} level={1} dot />
	{/snippet}

	{#snippet meta()}
		<StopLabel stop={id} label="" class="stop-detail-plate" />
		<MapDrilldownLink
			href={mapHrefFor({ stop: id }, locale)}
			label={t.viewOnMap}
			ariaLabel={t.viewStopOnMap(id)}
		/>
	{/snippet}

	{#snippet pane(key)}
		{#if key === 'next'}
			<!-- LIVE: per-stop departures board. Skeleton until the first tick. -->
			{#if departures == null}
				<EdgeState variant="skeleton" lang={locale} layout={edgeLayout} />
			{:else}
				<!-- D3: the live departures board framed in the ONE TerminalPanel idiom.
				     Existing board content wrapped untouched; the live freshness stamp
				     moves to the panel's meta slot (the terminal's right readout). -->
				<TerminalPanel
					title={t.next.terminal.title}
					tag={t.next.terminal.tag}
					class="stop-next-terminal"
				>
					{#snippet meta()}
						<FreshnessStamp
							variant="live"
							generatedUtc={live.generatedUtc}
							ageSeconds={live.ageSeconds}
							isStale={live.isStale}
							{locale}
						/>
					{/snippet}
					<div class="stop-next">
						<div class="stop-next-head">
							<SectionHeading level={2} overline={t.next.heading} />
						</div>
						{#if departures.length === 0}
							<!-- HONEST ABSENCE: an empty live board STATES the inferred reason
						     (service closed — opens at FIRST / no service at this hour /
						     scheduled-but-silent) from the stop's own window + the live silent
						     signal. emptyReason is null when no reason is derivable → the plain
						     honest no-data copy, never a fabricated reason. -->
							<EdgeState
								variant="empty"
								lang={locale}
								layout={edgeLayout}
								emptyReason={departuresAbsenceReason}
							/>
						{:else}
							<!-- Combinable status chips + an optional by-route chip narrow the
						     board, collected into ONE ControlsRail (quiet infra chrome,
						     discerned from the data canvas). Both default off (everything
						     shown); the data marks are unchanged — these are INTERACTION
						     controls, so --primary lives only on the active chip. -->
							<ControlsRail label={t.next.controlsLabel}>
								<div class="stop-chip-group" role="group" aria-label={t.next.filter.statusLabel}>
									{#each DEPARTURE_TONES as tone (tone)}
										<button
											type="button"
											class="stop-chip"
											class:stop-chip--active={statusFilter.has(tone)}
											aria-pressed={statusFilter.has(tone)}
											onclick={() => toggleStatus(tone)}
										>
											<!-- colour + glyph redundancy: the tone's status fill tints the dot,
										     and the glyph carries the meaning without colour (a11y). -->
											<span
												class="stop-chip-glyph"
												style:color={toneColorVar(tone)}
												aria-hidden="true">{TONE_GLYPH[tone]}</span
											>
											{toneLabel(tone)}
										</button>
									{/each}
								</div>
								{#if departureRoutes.length > 1}
									<div class="stop-chip-group" role="group" aria-label={t.next.filter.routeLabel}>
										<button
											type="button"
											class="stop-chip"
											class:stop-chip--active={routeFilter == null}
											aria-pressed={routeFilter == null}
											onclick={() => (routeFilter = null)}
										>
											{t.next.filter.allRoutes}
										</button>
										{#each departureRoutes as route (route)}
											<button
												type="button"
												class="stop-chip"
												class:stop-chip--active={routeFilter === route}
												aria-pressed={routeFilter === route}
												onclick={() => (routeFilter = routeFilter === route ? null : route)}
											>
												{route}
											</button>
										{/each}
									</div>
								{/if}
								<p class="stop-departures-count" aria-live="polite">
									{t.next.filter.showing(filteredDepartures?.length ?? 0, departures.length)}
								</p>
							</ControlsRail>

							<!-- Hazard tape discerns the controls zone from the data canvas. -->
							<Separator variant="hazard" hazardSize="sm" />

							{#if (filteredDepartures?.length ?? 0) === 0}
								<p class="stop-departures-empty" data-testid="departures-filter-empty">
									{t.next.filter.noMatches}
								</p>
							{:else}
								<!-- The departure ROW LIST is the reusable ScheduleTable (board mode) —
								     route · eta · colour+glyph delay caption, verbatim from the shared
								     kernel. The filter/count/skeleton/empty state stay in StopDetail. -->
								<ScheduleTable
									mode="board"
									rows={(filteredDepartures ?? []).map(
										(d): ScheduleRow => ({
											kind: 'board',
											route: d.route,
											eta_utc: d.eta_utc,
											delay_min: d.delay_min,
											trip: d.trip,
										}),
									)}
									{locale}
									delayCopy={t.next}
									routeFallback={t.next.route}
								/>
							{/if}
						{/if}
					</div>
				</TerminalPanel>
			{/if}
		{:else if key === 'schedule'}
			<!-- STATIC: scheduled service grouped by route. -->
			<ResourceBoundary
				resource={stop}
				lang={locale}
				isEmpty={(s: StopFile | null) => (s?.scheduled?.length ?? 0) === 0}
			>
				{#snippet children(s: StopFile | null)}
					<div class="stop-schedule">
						<SectionHeading level={2} overline={t.schedule.heading} />
						<!-- The per-route schedule grid is the reusable ScheduleTable (grid mode) —
						     route code + headsign + the column-major times grid + honest per-route
						     absence, verbatim. The pane-level empty/skeleton stays on ResourceBoundary. -->
						<ScheduleTable
							mode="grid"
							rows={(s?.scheduled ?? []).map(
								(entry): ScheduleRow => ({
									kind: 'grid',
									route: entry.route,
									headsign: entry.headsign,
									times: entry.times ?? [],
								}),
							)}
							{locale}
							cap={SCHEDULE_CAP}
							moreLabel={t.schedule.moreTimes}
						/>
					</div>
				{/snippet}
			</ResourceBoundary>
		{:else if key === 'info'}
			<!-- STATIC: position, code, accessibility + routes served. -->
			<ResourceBoundary resource={stop} lang={locale}>
				{#snippet children(s: StopFile | null)}
					{#if s == null}
						<EdgeState variant="empty" lang={locale} layout={edgeLayout} />
					{:else}
						<!-- A3: an explicit 2-column layout — LEFT = the stop's own facts
						     (position / code / accessibility / routes served), RIGHT = live service
						     alerts. Collapses to one column on mobile; if there are no alerts the
						     AffectedAlerts stands down and the left column spans the grid. -->
						<div class="stop-info">
							<div class="stop-info-facts">
								<div class="stop-info-metrics">
									<MetricDisplay
										value={`${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}`}
										label={t.info.position}
										size="sm"
									/>
									{#if s.code}
										<MetricDisplay value={s.code} label={t.info.code} size="sm" />
									{/if}
									<!-- TRI-STATE accessibility: wheelchair is a plain optional boolean
									     (NOT the GTFS 0/1/2 enum), so true→accessible, false→not
									     accessible, ABSENT→an honest "unknown" (the styled absence chip)
									     rather than silently omitting the field. -->
									{#if s.wheelchair === true}
										<MetricDisplay
											value={t.info.wheelchairYes}
											label={t.info.wheelchair}
											size="sm"
										/>
									{:else if s.wheelchair === false}
										<MetricDisplay
											value={t.info.wheelchairNo}
											label={t.info.wheelchair}
											size="sm"
										/>
									{:else}
										<MetricDisplay
											value={null}
											absentReason="no-observations"
											{locale}
											label={t.info.wheelchair}
											size="sm"
										/>
									{/if}
								</div>
								{#if (s.routes_served?.length ?? 0) > 0}
									<div class="stop-info-routes">
										<SectionLabel text={t.info.routesServed} variant="metric" />
										<ul class="stop-info-route-chips">
											{#each s.routes_served ?? [] as route (route)}
												<li><Badge variant="tag" size="sm">{route}</Badge></li>
											{/each}
										</ul>
									</div>
								{/if}
							</div>
							<!-- LIVE: service alerts affecting this stop (stands down when none). -->
							<AffectedAlerts alerts={stopAlerts} {locale} copy={t.alerts} testId="stop-alerts" />
						</div>
					{/if}
				{/snippet}
			</ResourceBoundary>
		{:else if key === 'reliability'}
			<!-- HISTORIC: the decomposed reliability surface. It owns the codec-seeded grain
			     rail + the operator 2-col board + the NEW daily-trend / range-verdict section
			     (the only stop surface with a real date window, the S8B DateRangePicker seam).
			     Mirrors how RouteDetail mounts <RouteReliabilityClusters>. -->
			<ResourceBoundary
				resource={reliability}
				lang={locale}
				isEmpty={(r: StopReliability | null) =>
					r == null ||
					((r.periods?.length ?? 0) === 0 &&
						r.occupancy_mix == null &&
						(r.day_of_week?.length ?? 0) === 0 &&
						(r.by_route?.length ?? 0) === 0 &&
						(r.daily?.length ?? 0) === 0)}
			>
				{#snippet children(r: StopReliability | null)}
					{#if r != null}
						<StopReliabilitySurface data={r} {locale} />
					{/if}
				{/snippet}
			</ResourceBoundary>
		{/if}
	{/snippet}
</EntityDetail>

<style>
	.stop-corner {
		white-space: nowrap;
	}
	/* The ARRÊT plate as a meta chip: no left LED-lamp inset needed here (the head
	   already carries the brand dot on the display title) — keep the mono voice. */
	:global(.stop-detail-plate) {
		padding-left: 0;
	}
	:global(.stop-detail-plate)::before {
		display: none;
	}

	.stop-next {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.stop-next-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	/* The live-departures ROW LIST styles (.stop-departures / .stop-departure*) now
	   live with <ScheduleTable> (P5.3e board mode); StopDetail keeps only the board
	   CHROME — the filter chips, the count, and the empty state. */
	.stop-chip-glyph {
		margin-inline-end: 0.375rem;
		font-size: var(--text-micro);
		line-height: 1;
	}

	.stop-schedule {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	/* A3: the Info pane is an explicit 2-column grid — the stop's facts on the left, the
	   live alerts on the right. Reflows to one column on mobile (below). */
	.stop-info > :only-child {
		/* the pair-mate (alerts) rendered nothing — the survivor takes the row */
		grid-column: 1 / -1;
	}
	.stop-info {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 1.5rem 2rem;
		align-items: start;
	}
	.stop-info-facts {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		min-width: 0;
	}

	/* The reliability tile chrome + the per-tile / per-section reliability layout now
	   live with <StopReliabilitySurface> and its section components (S8A re-seat); the
	   per-route schedule grid (.stop-schedule-route* / .stop-schedule-times*) now lives
	   with <ScheduleTable> (P5.3e grid mode), so StopDetail carries only the schedule
	   pane WRAPPER (.stop-schedule) + the next / info pane chrome. */
	.stop-info-metrics {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem;
	}
	.stop-info-routes {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.stop-info-route-chips {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	/* Live-departures filter chips + count (laid out inside the ControlsRail body). */
	.stop-chip-group {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}
	.stop-chip {
		appearance: none;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.2;
		color: var(--muted-foreground);
		background-color: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		padding: 0.375rem 0.75rem;
		cursor: pointer;
		transition:
			background-color 0.15s ease,
			color 0.15s ease,
			border-color 0.15s ease;
	}
	.stop-chip:hover {
		color: var(--foreground);
	}
	/* Active chip is an INTERACTION accent — --primary belongs here, never a data mark. */
	.stop-chip--active {
		color: var(--primary-foreground);
		background-color: var(--primary);
		border-color: var(--primary);
	}
	.stop-chip:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.stop-departures-count {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	.stop-departures-empty {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	@media (prefers-reduced-motion: reduce) {
		.stop-chip {
			transition: none;
		}
	}

	@media (max-width: 48rem) {
		/* A3: the 2-col Info pane collapses to a single column on a phone. */
		.stop-info {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
