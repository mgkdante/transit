<!--
  RepeatOffenders — the /repeat-offenders ("récidivistes") accountability surface
  ORCHESTRATOR (S14 re-seat).

  Re-seats the former flat /worst-normalized RankedRow ledger onto the S14
  re-granulated by_grain recurrence ladders. This thin orchestrator owns EVERYTHING
  the sections must not: the getRepeatOffenders resource, the codec-seeded grain +
  worst-N state (seeded from ?grain/?n via $lib/filters, clamped to the populated
  grains, mirrored back to the URL), the ONE mapping pass through the pure
  offenderLadder selector, the Masthead + FreshnessStamp + the sticky
  SurfaceControls rail, the ExplainedMetricCard headline, and the honest absence.
  RepeatOffendersSection is a pure presenter fed one built ladder + tray per kind.

  RANKING (DECISIONS D3): the bar encodes each entity's SEVERE-DELAY RATE on the
  ABSOLUTE SEVERE_DOMAIN [0,100] — the rank variable, always >= 0, DB-ranked
  worst-first by the not-severe Wilson lower bound. recurrence_days ("N of M observed
  days") is EVIDENCE on the per-row note, never the rank. NO /worst, NO in-view
  normalization — the old banned idiom is gone, so the file is OFF the chartDoctrine
  allowlist (which is now EMPTY: the S14 punch-list completion, 2026-07-02).

  GRAINS (DECISIONS D3): week|month ONLY — "repeat" is undefined on a single day, so
  there is deliberately no day grain (an honest reason, not an omission). A grain is
  offered iff the payload serves a populated ladder for it.

  FALLBACK (DECISIONS D5): when by_grain is absent/empty (an OLD payload) the surface
  renders the legacy scalar offenders[] as a RankedRow ledger on the ABSOLUTE
  DELAY_DIST_DOMAIN [0,15] via RankedRow's `domain` prop — still doctrine-clean.

  HONESTY: a grain with no ranked entry shows the styled AbsentValue chip (says WHY),
  never a fake 0; a null severe_pct row draws the no-data swatch. The whole-file empty
  keeps the published-empty honest note. Severity is READ from the contract, never
  re-derived client-side (DECISIONS D4). All prose comes from ./repeatOffenders.copy.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { getLocale, localizeHref, type Locale } from '$lib/i18n';
	import { routeFor, type SurfaceKind, type SurfaceTarget } from '$lib/nav';
	import { fromSearchParams, toSearchParams, emptyFilterState, type WorstN } from '$lib/filters';
	import { mirrorSearchParams } from '$lib/site/urlMirror';
	import { fmtDelayMin as sharedFmtDelayMin } from '$lib/utils';
	import { getRepeatOffenders, type RepeatOffenderEntry, type Offender } from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import { ResourceBoundary, FreshnessStamp, SurfaceControls } from '$lib/components/surface';
	import { Surface, DashboardGrid } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';
	import { AbsentValue } from '$lib/components/edge';
	import { RankedRow } from '$lib/components/dataviz';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import Masthead from '$lib/components/brand/Masthead.svelte';
	import { DELAY_DIST_DOMAIN } from '$lib/features/reliability/domains';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';

	import {
		presentGrains,
		defaultOffenderGrain,
		ladderByGrain,
		OFFENDER_GRAINS,
		type OffenderGrainKey,
	} from './data/presentGrains';
	import { worstNCap, DEFAULT_WORST_N } from './data/ladderCap';
	import { selectOffenderLadder } from './selectors/offenderLadder';
	import { buildOffenderLedger } from './selectors/offenderLedger';
	import RepeatOffendersSection from './sections/RepeatOffendersSection.svelte';
	import { copy as COPY } from './repeatOffenders.copy';

	const locale: Locale = getLocale();
	const t = $derived(COPY[locale]);

	// The metric-explainer (i) affordance: a one-line tip + a localized deep link to
	// /metrics#<anchor>. The ladder ranks by the SEVERE-delay rate, so the (i) explains
	// severe_pct (same wiring as the hotspots / lines surfaces).
	const explainerCopy = $derived(metricsCopy[locale]);
	function buildInfo(key: MetricKey, name: string) {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	}
	const severeInfo = $derived(buildInfo('severe', t.ladder.severeRateLabel));

	// `freshness: true` feeds generated_utc into the shared newest-data timestamp.
	const offenders = createResource(() => getRepeatOffenders(), { freshness: true });
	const generatedUtc = $derived(offenders.data?.generated_utc ?? null);

	/* ── grain vocabulary + availability ──────────────────────────────────────────── */
	const ladders = $derived(ladderByGrain(offenders.data?.by_grain));
	const present = $derived(presentGrains(offenders.data?.by_grain));

	// CONTRACT: the codec ($lib/filters) owns the ?grain seam — fromSearchParams
	// enum-parses the seed; invalid values drop. The SELECTION + the populated-grain
	// clamp stay SURFACE-LOCAL. week is the finest offered grain (no day here), so an
	// absent/unknown ?grain seeds to 'week'.
	let grainKey = $state<OffenderGrainKey>(
		(() => {
			const seeded = fromSearchParams(page.url.searchParams).grain;
			return seeded === 'month' ? 'month' : 'week';
		})(),
	);

	const grainAvailability = $derived<Partial<Record<OffenderGrainKey, { available: boolean }>>>(
		Object.fromEntries(OFFENDER_GRAINS.map((g) => [g, { available: present.has(g) }])),
	);
	const grainLabels = $derived<Partial<Record<OffenderGrainKey, string>>>({
		week: t.grain.week,
		month: t.grain.month,
	});
	// The grain picker is a dead control when only one grain carries data — render it
	// ONLY when more than one grain is populated.
	const showGrainPicker = $derived(present.size > 1);

	// Keep the selection on a POPULATED grain (the clamp): a chosen grain whose ladder
	// is absent falls back to the richest present grain. Never a dead/empty grain.
	$effect(() => {
		if (present.size > 0 && !present.has(grainKey)) grainKey = defaultOffenderGrain(present);
	});

	/* ── worst-N cap (codec ?n) ───────────────────────────────────────────────────── */
	let worstN = $state<WorstN>(fromSearchParams(page.url.searchParams).worstN ?? DEFAULT_WORST_N);
	const cap = $derived(worstNCap(worstN));

	// Mirror grain + worst-N together in ONE replaceState (week default + default N →
	// omitted for a clean canonical URL).
	const wire = $derived.by<{ grain: string | null; n: string | null }>(() => {
		const state = emptyFilterState();
		if (worstN !== DEFAULT_WORST_N) state.worstN = worstN;
		const grainParam =
			grainKey === 'week'
				? null
				: ((): string | null => {
						state.grain = grainKey;
						return toSearchParams(state).get('grain');
					})();
		return { grain: grainParam, n: toSearchParams(state).get('n') };
	});
	$effect(() => mirrorSearchParams(wire));

	/* ── the ONE mapping pass ─────────────────────────────────────────────────────── */
	// A row's nav target: an entity (trip/vehicle) is accountable on its offending
	// ROUTE, so the drill link goes to that line. Unknown route → no link.
	function hrefFor(e: RepeatOffenderEntry): string | null {
		const route = e.route?.trim();
		if (!route) return null;
		const kind: SurfaceKind = 'line';
		return localizeHref(routeFor({ kind, id: route }), locale);
	}
	function unnamed(e: RepeatOffenderEntry): string {
		const route = e.route?.trim();
		return route ? `${t.type.other} ${route}` : t.unnamed(e.id);
	}
	// Per-row evidence note: the natural-frequency recurrence line + severe% + n, each
	// fragment null-guarded. recurrence_days / observed_days drive the recurrence line.
	function ladderNote(e: RepeatOffenderEntry): string {
		const parts: string[] = [];
		if (e.recurrence_days != null && e.observed_days != null)
			parts.push(t.recurrence.naturalFrequency(e.recurrence_days, e.observed_days));
		else parts.push(t.recurrence.unknown);
		if (e.severe_pct != null)
			parts.push(`${t.note.severe} ${Math.round(e.severe_pct)}${t.units.pct}`);
		if (e.observation_count != null) parts.push(`${t.note.samples}=${e.observation_count}`);
		return parts.join(' · ');
	}

	const activeLadder = $derived(ladders.get(grainKey));

	// entries[] is a MIXED trip+vehicle array ranked PER KIND. Build a ladder for EACH
	// kind by filtering entries[] by type losslessly. shown/total per kind uses the DB's
	// per-kind ranked totals — a display-N truncation never rescales.
	function ladderFor(kind: 'trip' | 'vehicle', total: number | null | undefined) {
		const kindEntries = (activeLadder?.entries ?? []).filter((e) => e.type === kind);
		const res = selectOffenderLadder(kindEntries, cap, locale, {
			title: t.ladder.heading,
			xLabel: t.ladder.severeRateLabel,
			unit: t.units.pct,
			ciLabel: t.ladder.ci,
			note: ladderNote,
			unnamed,
			href: hrefFor,
		});
		return { ...res, total: total ?? res.total };
	}
	const tripLadder = $derived(ladderFor('trip', activeLadder?.total_ranked_trips));
	const vehicleLadder = $derived(ladderFor('vehicle', activeLadder?.total_ranked_vehicles));

	// §C5.12 #1-OFFENDER HERO: entries[] is DB-ranked worst-first by the Wilson lower
	// bound, so entries[0] IS the #1 offender. The hero names it + shows its streak
	// (recurrence natural frequency) + its Wilson-bounded severe rate. Honest: a null rate
	// / absent bounds degrade the clause (never a fabricated confidence); no entries →
	// the stand-down line. The bar's Wilson bracket the COMPLEMENTARY not-severe rate, so
	// flip onto the severe scale ([100−hi, 100−lo]) exactly as the ladder selector does.
	const topOffender = $derived<RepeatOffenderEntry | null>(activeLadder?.entries?.[0] ?? null);
	const round1 = (x: number): number => Math.round(x * 10) / 10;
	const heroName = $derived(topOffender ? (topOffender.route_name ?? unnamed(topOffender)) : null);
	const heroStreak = $derived.by<string | null>(() => {
		if (!topOffender) return null;
		return topOffender.recurrence_days != null && topOffender.observed_days != null
			? t.recurrence.naturalFrequency(topOffender.recurrence_days, topOffender.observed_days)
			: t.recurrence.unknown;
	});
	const heroRate = $derived.by<string | null>(() => {
		if (!topOffender) return null;
		const sev = topOffender.severe_pct;
		if (sev == null) return null;
		const ratePct = `${Math.round(sev)}${t.units.pct}`;
		// Flip the Wilson bounds onto the severe scale (100 − complementary bound).
		if (topOffender.wilson_lo != null && topOffender.wilson_hi != null) {
			const lo = round1(100 - topOffender.wilson_hi);
			const hi = round1(100 - topOffender.wilson_lo);
			return t.hero.rateWithCi(ratePct, `${lo}`, `${hi}`);
		}
		return t.hero.rateNoCi(ratePct);
	});
	const heroHref = $derived(topOffender ? hrefFor(topOffender) : null);

	// The VISIBLE natural-frequency recurrence line per shown ranked row ("late-prone on
	// N of M observed days"), split by kind, honoring the SAME worst-N cap as the ladder
	// so the recurrence list and the chart stay in lock-step. This is the on-screen
	// evidence the spec mandates (the chart's tooltip note is the AT/hover twin).
	interface RecurrenceLine {
		readonly key: string;
		readonly label: string;
		readonly text: string;
	}
	function recurrenceLinesFor(kind: 'trip' | 'vehicle'): RecurrenceLine[] {
		return (activeLadder?.entries ?? [])
			.filter((e) => e.type === kind)
			.slice(0, Math.max(0, cap))
			.map((e) => ({
				key: `${e.type}-${e.id}-${e.route ?? ''}`,
				label: e.route_name ?? unnamed(e),
				text:
					e.recurrence_days != null && e.observed_days != null
						? t.recurrence.naturalFrequency(e.recurrence_days, e.observed_days)
						: t.recurrence.unknown,
			}));
	}
	const tripRecurrence = $derived(recurrenceLinesFor('trip'));
	const vehicleRecurrence = $derived(recurrenceLinesFor('vehicle'));

	// The un-ranked tray rows (sub-MIN_N entities) mapped to the section's display shape,
	// split by kind so each tab shows only its own kind's tray.
	function trayFor(kind: 'trip' | 'vehicle') {
		return (activeLadder?.tray ?? [])
			.filter((e) => e.type === kind)
			.map((e) => {
				const href = hrefFor(e);
				const title = e.route_name ?? unnamed(e);
				const tag = kind === 'trip' ? t.type.trip : t.type.vehicle;
				return {
					key: `${e.type}-${e.id}-${e.route ?? ''}`,
					title,
					subtitle: t.tray.rowSubtitle(tag, e.id),
					href,
					ariaLabel: t.viewDetail(title),
				};
			});
	}
	const tripTray = $derived(trayFor('trip'));
	const vehicleTray = $derived(trayFor('vehicle'));

	// The trailing-window caption for the active grain.
	const windowCaption = $derived(t.window[grainKey]);

	/* ── the legacy fallback ledger (by_grain absent) ─────────────────────────────── */
	// When the payload publishes NO populated grain, fall back to the scalar offenders[]
	// as a RankedRow ledger on the ABSOLUTE DELAY_DIST_DOMAIN [0,15] (doctrine-clean).
	function typeLabel(type: string): string {
		return type === 'route'
			? t.type.route
			: type === 'stop'
				? t.type.stop
				: type === 'trip'
					? t.type.trip
					: type === 'vehicle'
						? t.type.vehicle
						: t.type.other;
	}
	function fmtMin(v: number | null): string | null {
		return sharedFmtDelayMin(v, { rounding: 'fixed1', suffix: t.units.min });
	}
	// Resolve a legacy offender to its detail route (the orchestrator owns $lib/nav). A
	// 'stop' → /stop/{id}; a route id → /lines/{route}; a 'route' type → /lines/{id};
	// failing all, a non-navigating self target so the link is never broken.
	function legacyHref(o: Offender): string {
		const target: SurfaceTarget =
			o.type === 'stop'
				? { kind: 'stop', id: o.id }
				: o.route?.trim()
					? { kind: 'line', id: o.route.trim() }
					: o.type === 'route'
						? { kind: 'line', id: o.id }
						: { kind: 'stop', id: o.id };
		return localizeHref(routeFor(target), locale);
	}
	const legacyRows = $derived(
		buildOffenderLedger(offenders.data?.offenders ?? [], {
			typeLabel,
			recurrenceLabel: t.recurrenceLabel,
			recurrenceUnknown: t.recurrenceUnknown,
			fmtMin,
			viewDetail: t.viewDetail,
			href: legacyHref,
		}),
	);

	// Which path renders: the primary by_grain ladders when ANY grain is populated, else
	// the legacy scalar ledger. The whole surface stands down (boundary empty) only when
	// BOTH are empty.
	const hasGrains = $derived(present.size > 0);
	const hasLegacy = $derived((offenders.data?.offenders?.length ?? 0) > 0);
</script>

<Surface class="repeat-offenders">
	<Masthead kicker={t.kicker} heading={t.heading} subheading={t.subheading} lede={t.lede}>
		{#snippet meta()}
			<FreshnessStamp variant="updated" {generatedUtc} {locale} />
		{/snippet}
	</Masthead>

	<!-- The boundary gates skeleton / error / (no-file) empty. A PUBLISHED file that
	     populates neither a grain ladder NOR a scalar offender is a legitimate "nothing
	     is a repeat offender right now" reading, so we render that honest note. -->
	<ResourceBoundary
		resource={offenders}
		lang={locale}
		isEmpty={(d) => (d.by_grain?.length ?? 0) === 0 && (d.offenders?.length ?? 0) === 0}
	>
		{#if hasGrains}
			<section class="repeat-offenders-region" aria-label={t.heading}>
				<!-- §C5.12 #1-OFFENDER HERO: the actual worst entity is the hero (name + streak
				     + Wilson-bounded severe rate), so the page opens on the accountability payoff,
				     not a definition. The definition demotes to a lede + (i) beneath it. -->
				<div class="offenders-hero" data-slot="offenders-hero" aria-label={t.hero.label}>
					{#if topOffender && heroName != null}
						<span class="offenders-hero-overline">{t.hero.overline}</span>
						{#if heroHref}
							<a class="offenders-hero-name" href={heroHref}>{heroName}</a>
						{:else}
							<span class="offenders-hero-name">{heroName}</span>
						{/if}
						{#if heroRate}
							<p class="offenders-hero-rate">{heroRate}</p>
						{/if}
						{#if heroStreak}
							<p class="offenders-hero-streak">
								<span class="offenders-hero-streak-label">{t.hero.streakLabel}</span>
								{heroStreak}
							</p>
						{/if}
					{:else}
						<p class="offenders-hero-none">{t.hero.none}</p>
					{/if}
				</div>

				<!-- The definition, DEMOTED to a lede + (i) (was the value=null hero). -->
				<p class="offenders-def" data-slot="offenders-def">
					{t.headline.explanation}
					<MetricInfo
						tip={severeInfo.tip}
						href={severeInfo.href}
						label={severeInfo.label}
						linkLabel={severeInfo.linkLabel}
						side="bottom"
					/>
				</p>

				{#if showGrainPicker}
					<SurfaceControls
						offered={OFFENDER_GRAINS}
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

				<RepeatOffendersSection
					heading={t.ladder.heading}
					{tripLadder}
					{vehicleLadder}
					{tripTray}
					{vehicleTray}
					{tripRecurrence}
					{vehicleRecurrence}
					{windowCaption}
					info={severeInfo}
					bind:worstN
					{locale}
					copy={t}
				/>

				<!-- Honest caveat: an observed-days recurrence proxy, not a certified scorecard. -->
				<p class="repeat-offenders-caveat" data-slot="offenders-caveat">{t.caveat}</p>
			</section>
		{:else if hasLegacy}
			<!-- FALLBACK: the legacy scalar ledger on the ABSOLUTE delay domain. -->
			<div class="repeat-offenders-block">
				<SectionHeading level={2} overline={t.listSection}>
					{#snippet explainer()}
						<MetricInfo
							tip={severeInfo.tip}
							href={severeInfo.href}
							label={severeInfo.label}
							linkLabel={severeInfo.linkLabel}
							side="bottom"
						/>
					{/snippet}
				</SectionHeading>
				<p class="repeat-offenders-caption">{t.rowCaption}</p>
				<DashboardGrid
					as="ul"
					minTile="360px"
					gutter={false}
					class="repeat-offenders-ranked"
					aria-label={t.listSummary}
				>
					{#each legacyRows as row (row.key)}
						<li class="repeat-offenders-item">
							<a
								class="repeat-offenders-link"
								href={row.href}
								data-sveltekit-preload-data="hover"
								data-slot="offender-link"
								aria-label={row.ariaLabel}
							>
								<RankedRow
									bare
									rank={row.rank}
									title={row.title}
									subtitle={row.subtitle}
									severity={row.severity}
									value={row.value}
									domain={DELAY_DIST_DOMAIN}
									unit={t.units.min}
									display={row.display}
									absentReason="no-observations"
									{locale}
								/>
							</a>
						</li>
					{/each}
				</DashboardGrid>
				<p class="repeat-offenders-caveat" data-slot="offenders-caveat">{t.caveat}</p>
			</div>
		{:else}
			<!-- Published but empty: no grain ladder, no scalar offender. Honest note. -->
			<div class="repeat-offenders-note" data-slot="offenders-empty">
				<AbsentValue variant="block" reason="no-observations" {locale} />
			</div>
		{/if}
	</ResourceBoundary>
</Surface>

<style>
	.repeat-offenders-region {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-width: var(--container-wide);
		margin-inline: auto;
	}
	/* §C5.12 #1-offender hero — a solid card (occlusion law) leading with the worst
	   entity's name, its Wilson-bounded severe rate + its streak. */
	.offenders-hero {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 1.1rem 1.25rem;
		border: 2px solid var(--border-rule);
		border-radius: var(--radius-lg);
		background: var(--surface-2);
	}
	.offenders-hero-overline {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 600;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--accent-text);
	}
	.offenders-hero-name {
		font-family: var(--font-heading);
		font-size: var(--text-title);
		font-weight: 700;
		line-height: 1.1;
		letter-spacing: var(--tracking-tight);
		color: var(--foreground);
		text-decoration: none;
	}
	a.offenders-hero-name {
		border-bottom: 1px solid transparent;
		transition: border-color var(--duration-fast) var(--ease-default);
		width: fit-content;
	}
	a.offenders-hero-name:hover,
	a.offenders-hero-name:focus-visible {
		border-bottom-color: var(--primary);
	}
	a.offenders-hero-name:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}
	.offenders-hero-rate {
		margin: 0;
		font-size: var(--text-subheading);
		line-height: 1.4;
		color: var(--foreground);
	}
	.offenders-hero-streak,
	.offenders-hero-none {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.offenders-hero-streak-label {
		text-transform: uppercase;
		letter-spacing: var(--tracking-eyebrow);
		color: var(--accent-text);
		margin-inline-end: 0.375rem;
	}
	/* The demoted definition — a quiet lede beneath the hero, with its (i) inline. */
	.offenders-def {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		max-width: 72ch;
		font-size: var(--text-small);
		line-height: 1.55;
		color: var(--muted-foreground);
	}
	.repeat-offenders-block {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	:global(.dashboard-grid.repeat-offenders-ranked) {
		max-width: var(--container-wide);
		margin-inline: auto;
	}
	.repeat-offenders-item {
		display: block;
	}
	.repeat-offenders-link {
		display: block;
		text-decoration: none;
		color: inherit;
		border-radius: var(--radius-lg);
	}
	.repeat-offenders-link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.repeat-offenders-caption,
	.repeat-offenders-caveat {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.repeat-offenders-caveat {
		max-width: 52ch;
	}
	/* The honest empty state wraps the styled AbsentValue block; the container centers it. */
	.repeat-offenders-note {
		display: flex;
		justify-content: center;
		padding: 0.5rem 0;
	}
</style>
