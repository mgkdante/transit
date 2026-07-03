<!--
  LinesIndex — the Lines index screen (slice-9.3 · data-depth batch 4).

  Composes the surface spine: a SurfaceHeader over a filterable EntityList of
  every route from the static routes_index. Each row now carries an at-a-glance
  RELIABILITY BADGE (status verdict + OTP%) lazily loaded per-route, plus two
  combinable controls: a SORT toggle (alphabetical | worst reliability first) and
  a reliability STATUS filter (all | late/severe only). The search-to-filter box
  is unchanged.

  Data:
    · static routes_index via createResource(getRoutesIndex) — gated by a
      ResourceBoundary so skeleton / error / empty render without bespoke plumbing.
    · per-route headline reliability via the SHARED lazy loader
      (createReliabilityLoader): a per-id cache + a concurrency cap + viewport-gated
      fetches (the `reliability` action), so the catalogue never fans out hundreds
      of /v1 requests. Rows still loading / with no data show the name + glyph as
      before (no badge, no spinner) — fail-soft + honest.

  Locale comes from getLocale(); non-intrinsic copy is co-located. Tokens, no hex
  (the route GTFS colour is not surfaced here — that is the search swatch's job);
  --primary stays interactive-only (the active sort/filter segment).

  DEFER (tracked follow-ups, out of scope this batch): no near-me / distance sort;
  no per-row reliability grain selection (always the latest day); no accessible-only
  filter (needs a DB field).
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { getLocale } from '$lib/i18n';
	import { mapHrefFor } from '$lib/nav';
	import {
		getRoutesIndex,
		createReliabilityLoader,
		isProblemVerdict,
		createLiveStore,
		getV1Context,
		selectVerdict,
		type VerdictHeadline,
	} from '$lib/v1';
	import type { RouteIndexEntry } from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import { VerdictBanner } from '$lib/components/brand';
	import { reliabilityCopy } from './reliability/reliability.copy';
	import {
		ResourceBoundary,
		SurfaceHeader,
		EntityList,
		EntityRow,
		SearchInput,
		MapDrilldownLink,
		ReliabilityBadge,
		GrainPicker,
	} from '$lib/components/surface';
	import { Surface, ControlsRail } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';
	import { foldSearchText, tokenMatchScore } from '$lib/search/normalize';
	import { routeModeHint } from '$lib/search/stopMode';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import { indexCopy } from './lines.copy';

	const locale = getLocale();
	const t = $derived(indexCopy[locale]);

	// The OTP explainer (i) on the surface header (§C5.3 / §C6): one-line tip + deep
	// link to /metrics#otp, the same `info()` shape every surface uses.
	const explainerCopy = $derived(metricsCopy[locale]);
	const otpInfo = $derived.by(() => {
		const i = metricInfoFor('otp', locale);
		return { ...i, label: explainerCopy.info.trigger('OTP'), linkLabel: explainerCopy.info.link };
	});

	const routes = createResource(() => getRoutesIndex());

	// The SHARED lazy reliability loader, scoped to this surface (one cache +
	// concurrency budget, torn down with the page). Rows request their id through
	// the `observeReliability` action so only on-screen rows fetch.
	const reliability = createReliabilityLoader('route');
	const observeReliability = reliability.reliability;

	// NETWORK VERDICT BAND (§C5.3): a one-line at-a-glance answer between the head and
	// the grid, reusing the SHARED VerdictBanner + selectVerdict from the SAME live
	// on_time_pct the /network headline reads. Honest degradation: the live tier carries
	// no OTP trip-day denominator here (status_dist is an instant vehicle count, a
	// DIFFERENT universe), so we pass n=null → the band renders the sentence WITHOUT a
	// fabricated Wilson hedge (the pre-republish path), never a made-up confidence.
	const live = createLiveStore(getV1Context().manifest);
	onMount(() => {
		live.start();
		return () => live.stop();
	});
	const verdictCopy = $derived(reliabilityCopy[locale].verdict);
	const networkHeadline = $derived<VerdictHeadline>({
		otpPct: live.network?.on_time_pct ?? null,
		observationCount: null,
		onTime: null,
	});
	// 'day' names the window as "today" — the live tier is a right-now reading.
	const networkVerdict = $derived(selectVerdict(networkHeadline, 'day', locale, verdictCopy));

	// GTFS route_type → the shared identity glyph (extends the stop mode vocabulary
	// to routes; bus '═' is the network default for anything unmapped).
	const glyphFor = (type: number): string => routeModeHint(type).glyph;

	// Filter query (mono input); empty ⇒ the full catalogue.
	let query = $state('');

	// Sort + reliability-status controls (both WAI-ARIA radiogroups via GrainPicker).
	type SortKey = 'alpha' | 'worst';
	let sort = $state<SortKey>('alpha');
	const sortSegments = $derived([
		{ key: 'alpha', label: t.sortAlpha },
		{ key: 'worst', label: t.sortWorst },
	]);

	type StatusKey = 'all' | 'problem';
	let status = $state<StatusKey>('all');
	const statusSegments = $derived([
		{ key: 'all', label: t.statusAll },
		{ key: 'problem', label: t.statusProblem },
	]);

	const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });

	// The text-filtered, alphabetical base set (numeric-aware on short name).
	const filtered = $derived.by<RouteIndexEntry[]>(() => {
		const all = routes.data?.routes ?? [];
		const sorted = [...all].sort((a, b) => collator.compare(a.short, b.short));
		const q = foldSearchText(query);
		if (!q) return sorted;
		// Accent-blind, word-order-free match over id/short/long; numeric short-name
		// order is preserved within the filtered set.
		return sorted.filter((r) => tokenMatchScore([r.id, r.short, r.long], q) != null);
	});

	// Worst-first ordering keys off each row's LOADED verdict (severe > late >
	// on_time); rows with no loaded verdict yet sink to the bottom in alphabetical
	// order, so the list never reshuffles violently as badges stream in. Honest:
	// an unloaded / no-data row is NOT treated as "good" — it just lacks a rank.
	const VERDICT_RANK: Record<string, number> = { severe: 0, late: 1, on_time: 2 };
	function worstRank(id: string): number {
		const v = reliability.get(id).verdict;
		return v == null ? 99 : (VERDICT_RANK[v] ?? 99);
	}

	// FREEZE-ON-SETTLE (§C5.3): the worst-first sort must not RESHUFFLE the list as
	// badges stream in one by one (a row jumping mid-scroll is the reshuffle complaint).
	// So in worst mode we hold a FROZEN id order that only recomputes once the visible
	// badges have SETTLED (no visible row still `loading`) — until then the list shows in
	// its stable alphabetical order with a polite "ranking…" caption. The frozen order is
	// keyed by id so re-filtering (search) reorders WITHIN the frozen ranks, never a churn.
	let worstOrder = $state<readonly string[] | null>(null);
	// Any filtered row still fetching its verdict → the ranking is not yet settled.
	const worstPending = $derived(
		sort === 'worst' && filtered.some((r) => reliability.get(r.id).phase === 'loading'),
	);
	$effect(() => {
		if (sort !== 'worst') {
			worstOrder = null;
			return;
		}
		// Recompute the frozen order ONLY when the visible badges have settled (nothing
		// loading). Rank asc, alpha tiebreak — the SAME stable key as before, snapshotted.
		if (!worstPending) {
			worstOrder = filtered
				.map((r, i) => ({ id: r.id, rank: worstRank(r.id), i }))
				.sort((a, b) => a.rank - b.rank || a.i - b.i)
				.map((x) => x.id);
		}
	});

	const sorted = $derived.by<RouteIndexEntry[]>(() => {
		if (sort === 'alpha') return filtered;
		// Until the frozen worst order settles, hold the stable alpha order (no reshuffle).
		if (worstOrder == null) return filtered;
		// Apply the FROZEN rank as a stable key over the current filtered set (search may
		// have narrowed it) — rows keep their settled rank, so nothing reshuffles violently.
		const frozenRank = new Map(worstOrder.map((id, i) => [id, i]));
		return filtered
			.map((r, i) => ({ r, i }))
			.sort(
				(a, b) => (frozenRank.get(a.r.id) ?? 1e9) - (frozenRank.get(b.r.id) ?? 1e9) || a.i - b.i,
			)
			.map((x) => x.r);
	});

	// The reliability-status filter narrows to problem lines (late/severe). It can
	// only hide a row whose verdict has LOADED — a row still loading is kept (it may
	// turn out to be a problem), so the filter never blanks the list on first paint.
	const visible = $derived.by<RouteIndexEntry[]>(() => {
		if (status === 'all') return sorted;
		return sorted.filter((r) => {
			const v = reliability.get(r.id).verdict;
			return v == null || isProblemVerdict(v);
		});
	});

	// With the problem filter on, the visible list can be all still-loading rows
	// (kept because their verdict hasn't landed) — a sighted reader sees skeleton
	// badges streaming in, but a screen-reader user would meet a seemingly-empty
	// list in silence. Announce a polite "loading the visible verdicts" caption
	// until at least one visible row has a real verdict, so AT isn't left guessing.
	const statusPending = $derived(
		status === 'problem' &&
			visible.length > 0 &&
			visible.every((r) => reliability.get(r.id).verdict == null),
	);
</script>

{#snippet otpHeaderInfo()}
	<MetricInfo
		tip={otpInfo.tip}
		href={otpInfo.href}
		label={otpInfo.label}
		linkLabel={otpInfo.linkLabel}
		side="bottom"
	/>
{/snippet}

<Surface pad="hub" class="lines-index">
	<SurfaceHeader kicker={t.kicker} heading={t.heading} lede={t.lede} explainer={otpHeaderInfo}>
		<!-- The search box + the sort/status pickers are collected into ONE
		     ControlsRail (quiet infra control panel, mono group overline), so this
		     surface's controls read as the same discerned-from-data zone the rest of
		     the analytics surfaces use. --primary lives only on the active picker
		     segment inside; the rail chrome stays quiet. -->
		<ControlsRail label={t.controlsLabel} class="lines-controls-rail" sticky>
			<SearchInput
				id="lines-filter-input"
				label={t.filterLabel}
				placeholder={t.filterPlaceholder}
				bind:value={query}
			/>
			<div class="lines-controls">
				<div class="lines-control">
					<!-- Visible caption only; GrainPicker self-labels its radiogroup via `label`,
					     so the span is decorative (aria-hidden) — no dangling labelledby id. -->
					<span class="lines-control-label" aria-hidden="true">{t.sortLabel}</span>
					<GrainPicker segments={sortSegments} bind:value={sort} label={t.sortLabel} />
				</div>
				<div class="lines-control">
					<span class="lines-control-label" aria-hidden="true">{t.statusFilterLabel}</span>
					<GrainPicker segments={statusSegments} bind:value={status} label={t.statusFilterLabel} />
				</div>
			</div>
		</ControlsRail>
	</SurfaceHeader>

	<Separator variant="hazard" />

	<!-- NETWORK VERDICT BAND (§C5.3): the one-line at-a-glance answer between the head and
	     the grid — reuses the SHARED VerdictBanner at network scope, from the same live
	     on_time_pct the /network headline reads. Stands down honestly ("still measuring")
	     before the first live tick / on an absent live tier. -->
	<section class="lines-verdict" aria-label={t.networkVerdictLabel}>
		<VerdictBanner result={networkVerdict} />
	</section>

	<ResourceBoundary resource={routes} lang={locale} isEmpty={(d) => d.routes.length === 0}>
		<!-- Polite SR caption: while the problem filter waits on verdicts to stream
		     in, a screen-reader user hears that the visible list is still loading
		     rather than meeting an apparently-empty result set in silence. -->
		<p class="sr-only" role="status" aria-live="polite">
			{statusPending ? t.statusPending : worstPending ? t.rankingPending : ''}
		</p>
		<!-- The catalogue lays out as a 2-up auto-fit board on desktop (each line
		     result fills its grid cell), reflowing to a single column on a phone —
		     EntityList's `grid` mode renders its rows through the SHARED DashboardGrid
		     auto-fit recipe, so the list>listitem semantics (and the lazy reliability
		     action per row) stay intact and the grid track lives ONLY in DashboardGrid. -->
		<EntityList items={visible} key={(r) => r.id} grid minTile="360px">
			{#snippet row(r)}
				<!-- Bare id (no `known` flag): availability is decided by the always-current
			     route_reliability discovery index in the loader, NOT the lag-prone
			     routes_index `reliability` flag — so a stale flag never drops a badge. -->
				<div class="line-result" use:observeReliability={r.id}>
					<EntityRow
						target={{ kind: 'line', id: r.id }}
						{locale}
						glyph={glyphFor(r.type)}
						title={r.short}
						subtitle={r.long ?? undefined}
						class="line-result-main"
					/>
					<ReliabilityBadge snapshot={reliability.get(r.id)} {locale} class="line-result-badge" />
					<MapDrilldownLink
						href={mapHrefFor({ route: r.id }, locale)}
						label={t.mapAction}
						ariaLabel={t.viewRouteOnMap(r.short)}
					/>
				</div>
			{/snippet}
		</EntityList>
	</ResourceBoundary>
</Surface>

<style>
	.sr-only {
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
	/* The one-line network verdict band between the head and the grid — quiet spacing
	   so the VerdictBanner reads as its own register above the catalogue. */
	.lines-verdict {
		margin-block: 0.25rem 0.5rem;
	}
	/* The control panel fills the header measure; its body lays the search box
	   across the top with the sort/status pickers beneath. */
	:global(.lines-controls-rail) {
		width: 100%;
	}
	:global(.lines-controls-rail [data-slot='controls-rail-body']) {
		flex-direction: column;
		align-items: stretch;
		gap: 0.875rem;
	}
	.lines-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 1.25rem;
	}
	.lines-control {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.lines-control-label {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 600;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	/* The catalogue rides EntityList's grid mode (the SHARED DashboardGrid auto-fit
	   recipe + the bordered-tile row treatment live there); this surface only styles
	   the row body below. */
	.line-result {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 0.875rem;
	}
	.line-result :global(.line-result-main) {
		min-width: 0;
	}
	.line-result :global(.line-result-badge) {
		flex: none;
	}
	@media (max-width: 32rem) {
		/* On a narrow phone the badge tucks under the row body so the name + map
		   action keep their room; the badge stays a quiet at-a-glance mark. */
		.line-result {
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-areas:
				'main map'
				'badge map';
			row-gap: 0.25rem;
		}
		.line-result :global(.line-result-main) {
			grid-area: main;
		}
		.line-result :global(.line-result-badge) {
			grid-area: badge;
			padding-left: 0.875rem;
		}
		.line-result :global(.map-drilldown-link) {
			grid-area: map;
		}
	}
</style>
