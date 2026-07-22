<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { localizeHref, type Locale } from '$lib/i18n';
	import { createLiveStore, otpVerdict, type Manifest } from '$lib/v1';
	import { STATUS_LABELS, OCCUPANCY_LABELS } from '$lib/v1/enumLabels';
	import { StatusBadge } from '$lib/components/dataviz';
	import { formatUtc } from '$lib/utils/time';
	import {
		fmtCount as sharedFmtCount,
		fmtPct as sharedFmtPct,
		fmtDelayMin as sharedFmtDelayMin,
	} from '$lib/utils';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import { SectionLabel } from '@yesid/ui/brand';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import CornerMeta from '$lib/components/brand/CornerMeta.svelte';
	import { cornerMetaLabels } from '$lib/components/brand';
	import TerminalPanel from '$lib/components/brand/TerminalPanel.svelte';
	import { FreshnessStamp } from '$lib/components/surface';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import {
		metricInfoFor,
		type MetricKey,
		type SupplementalMetricKey,
	} from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import type { HomeCopy } from './home.copy';

	interface Props {
		readonly locale: Locale;
		readonly manifest: Manifest;
		readonly copy: HomeCopy;
	}

	let { locale, manifest, copy: t }: Props = $props();

	// Static build time is the dataset anchor; the live tier carries the pulse.
	const generatedUtc = $derived(
		manifest.files.live?.generated_utc ?? manifest.files.static?.generated_utc ?? null,
	);

	// Live tier — one store instance for this surface. The v1 context is booted by
	// the time the page tree renders, so the manifest is safe here. The store is
	// null until the first client-side tick (start() no-ops during SSR), so the
	// hero pulse stands down honestly on first paint and on a missing live tier.
	const live = createLiveStore(
		untrack(() => manifest),
		{ families: ['vehicles', 'network'] },
	);
	onMount(() => {
		live.start();
		return () => live.stop();
	});

	const net = $derived(live.network);

	// ── The three RESULT GRIDS (operator, 2026-07-09: "SQL result grids") ──────
	// One row shape for all three; each derives from REAL live data and HIDES
	// honestly when its slice is absent (null mix / empty index) — never a
	// fabricated row. Dots ride the dataviz scales (DATA voice).
	interface GridRow {
		readonly key: string;
		readonly dotClass?: string;
		readonly label: string;
		readonly value: string;
	}
	const STATUS_ORDER = ['early', 'on_time', 'late', 'severe', 'unknown'] as const;
	const OCCUPANCY_ORDER = ['empty', 'many_seats', 'few_seats', 'standing', 'full'] as const;

	const fleetRows = $derived.by<GridRow[] | null>(() => {
		const dist = net?.status_dist;
		if (!dist) return null;
		return STATUS_ORDER.map((code) => ({
			key: code,
			dotClass: `pulse-dist-dot--${code}`,
			label: STATUS_LABELS[locale][code],
			value: fmtCount(dist[code]) ?? '',
		}));
	});

	// Crowding shares (fractions of the reporting fleet) → whole percent.
	const crowdingRows = $derived.by<GridRow[] | null>(() => {
		const mix = net?.occupancy_mix;
		if (!mix) return null;
		return OCCUPANCY_ORDER.map((code) => ({
			key: code,
			dotClass: `pulse-dist-dot--occ-${code}`,
			label: OCCUPANCY_LABELS[locale][code],
			value: `${Math.round(mix[code] * 100)}${t.pct}`,
		}));
	});

	// The busiest lines RIGHT NOW — routes ranked by live vehicles on the road
	// (numeric-aware tiebreak). Gated on a reported tier; empty index hides.
	const busiestRows = $derived.by<GridRow[] | null>(() => {
		if (net == null) return null;
		const ranked = [...live.index.vehiclesByRoute.entries()]
			.map(([route, ids]) => [route, ids.size] as const)
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { numeric: true }))
			.slice(0, 5);
		if (ranked.length === 0) return null;
		return ranked.map(([route, count]) => ({
			key: route,
			label: route,
			value: fmtCount(count) ?? '',
		}));
	});

	// CornerMeta readouts (A4) — REAL data only, sourced from the manifest + the
	// live tier this page already loads; a datum that isn't present drops its corner
	// (never fabricated). generated_utc formats to an absolute stamp (the corners are
	// a blueprint-margin annotation, aria-hidden, so an absolute time is fine here —
	// the ticking "last updated" lives in the terminal chrome above).
	const cm = $derived(cornerMetaLabels[locale]);
	const cornerGeneratedStamp = $derived(
		generatedUtc != null ? formatUtc(generatedUtc, locale) : null,
	);
	const cornerVehicleCount = $derived(fmtCount(net?.vehicles_in_service));

	// The pulse formatters return `null` for a missing value (never a fabricated 0);
	// the MetricDisplay then renders its muted `emptyLabel` no-data state, the
	// honest absence reading consistent with the null-aware MetricDisplay.
	function fmtPct(value: number | null | undefined): string | null {
		return sharedFmtPct(value, { suffix: t.pct });
	}
	function fmtCount(value: number | null | undefined): string | null {
		return sharedFmtCount(value, { locale });
	}
	function fmtMin(value: number | null | undefined): string | null {
		return sharedFmtDelayMin(value, { suffix: t.min });
	}

	// The metric-explainer (i) affordance for each pulse tile: a one-line tip + a
	// localized deep link to /metrics#<anchor>, the SAME wiring NetworkHealth uses on
	// its headline KPIs. Every pulse number carries its honest definition.
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey | SupplementalMetricKey, name: string) => {
		const metric = metricInfoFor(key, locale);
		return {
			...metric,
			label: explainerCopy.info.trigger(name),
			linkLabel: explainerCopy.info.link,
		};
	});

	// Whether the live tier is currently reporting (drives the pulse verdict). The
	// store is null before the first client tick and on a missing/absent live tier.
	const isLive = $derived(net != null);
</script>

<!-- 1. COMMAND-BOARD HERO ------------------------------------------------- -->
<!-- The yesid home-hero DNA, transit voice: a two-column command board —
     [identity Masthead] │ orange divider │ [live-pulse TerminalPanel]. The left is
     the ONE Masthead family (kicker → display title + orange dot → lede) with the
     blueprint-margin CornerMeta pinned to it; the right is the network "right now"
     board (the dispatcher status-at-a-glance, co-hero). They sit side by side ≥1024
     and stack below; a single edge-to-edge hazard tape closes the whole hero. -->
<!-- yesid home-hero GEOMETRY verbatim (build sheet §2–§4): full-bleed, viewport-
     filling, grid [1fr | 1px amber spine | 1fr] gap 32px top-aligned. LEFT: kicker →
     two-line THESIS (line 2 --primary + dot) → THREE EQUAL stat tiles → statement →
     lede → CTA row (orange /network + THE amber map conversion — the view's one).
     RIGHT: the live-pulse TerminalPanel (2×2 equal KPIs). The agency name demotes
     to the kicker + CornerMeta (A4). Honesty unchanged: every number stands down to
     the styled absence chip pre-tick, never a fabricated 0. -->
<section class="hub-hero" aria-labelledby="hub-hero-title">
	<!-- No provider corner: the kicker already carries CITIZEN DASHBOARD · {SHORT} ·
	     {CITY} — a PROVIDER corner would say it twice (operator variation, 2026-07-09:
	     lift the yesid pattern, then trim what this dashboard doesn't need). -->
	<CornerMeta>
		{#snippet topRight()}{#if cornerGeneratedStamp}<span class="corner-line"
					>{cm.generated} · {cornerGeneratedStamp}</span
				>{/if}{/snippet}
		{#snippet bottomLeft()}<span class="corner-line">{cm.dataset} · {manifest.dataset_version}</span
			>{/snippet}
		{#snippet bottomRight()}{#if cornerVehicleCount}<span class="corner-line"
					>{cm.vehicles} · {cornerVehicleCount}</span
				>{/if}{/snippet}
	</CornerMeta>

	<div class="hero-left" data-slot="home-hero-intro">
		<SectionLabel text={t.kicker} variant="station" class="hero-kicker" />
		<SectionHeading
			heading={t.thesis1}
			headingAccent={t.thesis2}
			level={1}
			id="hub-hero-title"
			class="hero-thesis"
		/>

		<!-- No stat-tile row (operator variation): yesid's hero tiles sell a
		     portfolio; here the live numbers belong to ONE voice — the terminal
		     panel beside the thesis. -->
		<p class="hero-statement">{t.statement}</p>
		<p class="hero-lede">{t.tagline}</p>

		<div class="hero-ctas">
			<a class="tap-press hero-cta hero-cta--primary" href={localizeHref('/network', locale)}
				>{t.ctaNetwork}</a
			>
			<a class="tap-press hero-cta hero-cta--conversion" href={localizeHref('/map', locale)}
				>{t.ctaMap}</a
			>
		</div>
	</div>

	<!-- The 1px vertical spine between the columns (build sheet §4: amber gradient,
	     transparent → --line-amber 15–85% → transparent). Decorative. -->
	<div class="hero-spine" data-slot="home-mobile-hero-divider" aria-hidden="true"></div>

	<div class="hero-right" data-slot="home-control-room">
		<!-- No titlebar `status`: the FreshnessStamp in the panel head is the ONE
		     freshness readout (a second ticking stamp in the chrome read as an echo). -->
		<TerminalPanel
			class="hub-pulse"
			title={t.terminalTitle}
			tag={isLive ? t.pulseLive : t.pulseStandby}
		>
			<!-- ONE live voice (operator UX pass): the titlebar tag carries LIVE, the
			     head row carries the label + the ONE ticking freshness stamp — no
			     StatusDot echo, no second stamp. -->
			<div class="pulse-head">
				<SectionLabel text={t.pulseLabel} variant="metric" />
				<FreshnessStamp
					variant="live"
					generatedUtc={live.generatedUtc}
					ageSeconds={live.ageSeconds}
					isStale={live.isStale}
					{locale}
				/>
			</div>

			<!-- 2×2 KPI board — the headline number (on-time, with its verdict word)
			     leads; coverage · median delay · not reporting complete the glance.
			     Same content budget per cell (value · label · (i)). -->
			<ul class="pulse-grid" aria-label={t.pulseLabel} aria-live="polite">
				<li>
					{@render pulse(fmtPct(net?.on_time_pct), t.metricOnTime, 'otp', net?.on_time_pct)}
				</li>
				<li>{@render pulse(fmtPct(net?.coverage_pct), t.metricCoverage, 'coverage')}</li>
				<li>{@render pulse(fmtMin(net?.delay_p50_min), t.metricDelayP50, 'p50p90')}</li>
				<li>{@render pulse(fmtCount(net?.non_responding), t.metricSilent, 'silentTrip')}</li>
			</ul>

			<!-- Fleet status readout — REAL live status_dist as a terminal ledger:
			     status-colored dot · label · dotted leader · tabular count. The
			     panel's visual MASS (felt balance from real content, never stretch).
			     Renders only when the tier reports. -->
			{#if fleetRows || crowdingRows || busiestRows}
				<div class="pulse-tables">
					{#if fleetRows}{@render resultGrid(
							t.distLabel,
							t.distColStatus,
							t.distColVehicles,
							fleetRows,
						)}{/if}
					{#if crowdingRows}{@render resultGrid(
							t.crowdLabel,
							t.distColCrowding,
							t.distColShare,
							crowdingRows,
						)}{/if}
					{#if busiestRows}{@render resultGrid(
							t.busyLabel,
							t.distColRoute,
							t.distColVehicles,
							busiestRows,
						)}{/if}
				</div>
			{/if}
		</TerminalPanel>
	</div>
</section>

<!-- A pulse tile = MetricDisplay + its (i) explainer, top-aligned beside the quiet
     label (same shape as NetworkHealth's `kpi`). A null value renders the STYLED
     honest-absence chip ('not-reported' — the flagship page speaks the site's own
     absence language), never a fabricated 0. When a `verdictPct` is supplied (the two
     percentage KPIs — on-time + coverage), a StatusBadge WORD + tone reads the 90/75
     reliabilityVerdict floors beneath the value, so the number carries its meaning
     (the evidence dead-end closes). The two counts have no OTP floor → no fabricated
     word. -->
<!-- ONE result-grid grammar for the terminal panel's three readouts (fleet /
     crowding / busiest lines): sr-caption, header band, gridlines, labels left
     (+ optional dataviz dot), values right-aligned in-column, natural width. -->
{#snippet resultGrid(label: string, colA: string, colB: string, rows: GridRow[])}
	<div class="pulse-dist" role="group" aria-label={label}>
		<span class="pulse-dist-head label-metric">{label}</span>
		<table class="pulse-dist-table">
			<caption class="sr-only">{label}</caption>
			<thead>
				<tr>
					<th scope="col">{colA}</th>
					<th scope="col" class="pulse-dist-num">{colB}</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.key)}
					<tr>
						<td class="pulse-dist-status">
							{#if row.dotClass}<span class="pulse-dist-dot {row.dotClass}" aria-hidden="true"
								></span>{/if}{row.label}
						</td>
						<td class="pulse-dist-num pulse-dist-value">{row.value}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/snippet}

{#snippet pulse(
	value: string | null,
	label: string,
	key: MetricKey | SupplementalMetricKey,
	verdictPct?: number | null,
)}
	{@const i = info(key, label)}
	{@const verdict = verdictPct == null ? null : otpVerdict(verdictPct)}
	<div class="pulse-kpi">
		<div class="pulse-kpi-body">
			<MetricDisplay
				{value}
				{label}
				emptyLabel={t.noData}
				absentReason="not-reported"
				{locale}
				size="lg"
			/>
			{#if verdict}
				<StatusBadge
					status={verdict}
					label={STATUS_LABELS[locale][verdict]}
					size="sm"
					class="pulse-verdict"
				/>
			{/if}
		</div>
		<MetricInfo tip={i.tip} href={i.href} label={i.label} linkLabel={i.linkLabel} side="bottom" />
	</div>
{/snippet}

<style>
	/* ══ HERO — yesid home-hero geometry (build sheet §2–§5) ══════════════════════
	   Full-viewport band, grid [1fr | 1px amber spine | 1fr], gap 32px. FELT
	   symmetry (operator law 2026-07-09): both columns read equally FULL at a
	   glance — the left carries the tall thesis stack, the right carries a dense
	   terminal panel, and the grid centers them on each other. Balance comes from
	   real content mass, never from stretching a short box. */
	.hub-hero {
		position: relative;
		display: grid;
		gap: 0;
		margin-top: calc(-1 * (var(--chrome-offset) + var(--surface-pad-y)));
		padding-top: var(--chrome-offset);
	}
	@media (min-width: 1024px) {
		.hub-hero {
			grid-template-columns: minmax(0, 1fr) 1px minmax(0, 1fr);
			gap: 2rem;
			min-height: 100dvh;
			align-content: center;
			align-items: center;
		}
	}
	.corner-line {
		white-space: nowrap;
	}

	.hero-left {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		min-height: calc(100svh - var(--chrome-offset));
		min-width: 0;
	}
	@media (min-width: 1024px) {
		.hero-left {
			justify-content: flex-start;
			min-height: 0;
		}
	}
	.hub-hero :global(.hero-kicker) {
		color: var(--accent-text);
		margin-bottom: 0.75rem;
	}
	.hub-hero :global(.hero-thesis .section-heading-text) {
		font-size: min(var(--text-hero-mobile), 10.5vw);
		line-height: 0.88;
		letter-spacing: -0.04em;
		text-transform: uppercase;
	}
	@media (min-width: 768px) {
		.hub-hero :global(.hero-thesis .section-heading-text) {
			font-size: var(--text-hero);
		}
	}

	.hero-statement {
		margin: 1.5rem 0 0;
		font-family: var(--font-heading);
		font-size: clamp(1.375rem, min(3vw, 3.5svh), 2.25rem);
		font-weight: 700;
		line-height: 1.1;
		color: var(--foreground);
	}
	.hero-lede {
		margin: 1.25rem 0 0;
		font-size: var(--text-body);
		line-height: 1.65;
		color: var(--secondary-foreground);
		max-width: 52ch;
	}
	.hero-ctas {
		margin-top: 1.5rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.875rem;
	}
	.hero-cta {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 44px;
		padding: 1rem 2rem;
		font-family: var(--font-heading);
		font-size: var(--text-subheading);
		font-weight: 600;
		border-radius: var(--radius-lg);
		text-decoration: none;
		transition:
			transform var(--duration-fast) var(--ease-default),
			box-shadow var(--duration-fast) var(--ease-default);
	}
	.hero-cta--primary {
		background-color: var(--primary);
		color: var(--primary-foreground);
	}
	.hero-cta--primary:hover {
		transform: translateY(-1px);
		box-shadow: var(--shadow-glow-sm);
	}
	.hero-cta--conversion {
		background-color: var(--accent);
		color: var(--signage-bg);
	}
	.hero-cta--conversion:hover {
		transform: translateY(-1px);
		box-shadow: 0 0 6px color-mix(in srgb, var(--accent) 35%, transparent);
	}
	.hero-cta:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}

	.hero-spine {
		display: block;
		height: 1px;
		width: calc(100% + var(--space-page-x) + var(--space-page-x));
		margin-inline: calc(-1 * var(--space-page-x));
		background: linear-gradient(
			90deg,
			transparent 0%,
			var(--line-amber) 15%,
			var(--line-amber) 85%,
			transparent 100%
		);
	}
	@media (min-width: 1024px) {
		.hero-spine {
			width: 1px;
			height: auto;
			margin-inline: 0;
			align-self: stretch;
			background: linear-gradient(
				180deg,
				transparent 0%,
				var(--line-amber) 15%,
				var(--line-amber) 85%,
				transparent 100%
			);
		}
	}

	.hero-right {
		min-width: 0;
		padding-top: clamp(1.5rem, 6vw, 2.5rem);
	}
	@media (min-width: 1024px) {
		.hero-right {
			padding-top: 0;
		}
	}
	@media (max-width: 1023px) and (max-height: 660px) {
		.hero-statement {
			margin-top: 0.875rem;
		}
		.hero-lede {
			margin-top: 0.75rem;
			line-height: 1.5;
		}
		.hero-ctas {
			margin-top: 1rem;
			gap: 0.5rem;
		}
		.hero-cta {
			padding-block: 0.75rem;
		}
	}
	:global(.hub-pulse) {
		width: 100%;
	}
	.pulse-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem 1rem;
		margin-bottom: 1.25rem;
	}
	.pulse-label {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	.pulse-grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 1.25rem 1.5rem;
	}
	@media (min-width: 640px) {
		.pulse-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	.pulse-grid > li {
		min-width: 0;
	}
	.pulse-kpi {
		display: flex;
		align-items: flex-start;
		gap: 0.375rem;
		min-width: 0;
		height: 100%;
	}
	.pulse-kpi-body {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.375rem;
		min-width: 0;
	}
	.pulse-kpi :global([data-slot='metric-display']) {
		min-width: 0;
	}
	.pulse-tables {
		margin-top: 1.25rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border-subtle);
		display: flex;
		flex-wrap: wrap;
		gap: 1.25rem 2.25rem;
	}
	.pulse-dist {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.pulse-dist-table {
		width: max-content;
		max-width: 100%;
		border-collapse: collapse;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		border: 1px solid var(--border-subtle);
	}
	.pulse-dist-table th,
	.pulse-dist-table td {
		border: 1px solid var(--border-subtle);
		padding: 0.375rem 0.875rem;
	}
	.pulse-dist-table th {
		text-align: left;
		font-weight: 400;
		text-transform: uppercase;
		letter-spacing: 1.5px;
		color: var(--muted-foreground);
		background-color: color-mix(in srgb, var(--foreground) 4%, transparent);
	}
	.pulse-dist-num {
		text-align: right;
	}
	.pulse-dist-status {
		color: var(--muted-foreground);
		text-transform: uppercase;
		letter-spacing: 1.5px;
	}
	.pulse-dist-dot {
		display: inline-block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		margin-right: 0.375rem;
		vertical-align: 1px;
	}
	.pulse-dist-dot--early {
		background-color: var(--dataviz-status-early);
	}
	.pulse-dist-dot--on_time {
		background-color: var(--dataviz-status-on-time);
	}
	.pulse-dist-dot--late {
		background-color: var(--dataviz-status-late);
	}
	.pulse-dist-dot--severe {
		background-color: var(--dataviz-status-severe);
	}
	.pulse-dist-dot--unknown {
		background-color: var(--dataviz-status-unknown);
	}
	.pulse-dist-dot--occ-empty {
		background-color: var(--dataviz-occupancy-empty);
	}
	.pulse-dist-dot--occ-many_seats {
		background-color: var(--dataviz-occupancy-many-seats);
	}
	.pulse-dist-dot--occ-few_seats {
		background-color: var(--dataviz-occupancy-few-seats);
	}
	.pulse-dist-dot--occ-standing {
		background-color: var(--dataviz-occupancy-standing);
	}
	.pulse-dist-dot--occ-full {
		background-color: var(--dataviz-occupancy-full);
	}
	.pulse-dist-value {
		color: var(--accent-text);
		font-variant-numeric: tabular-nums;
	}

	@media (prefers-reduced-motion: reduce) {
		.hero-cta {
			transition: none;
		}
		.hero-cta:hover {
			transform: none;
		}
	}
</style>
