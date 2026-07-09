<!--
  Home — the network entry surface, rebuilt on the yesid.dev home-hero geometry
  (P5-R · R1; build sheet at docs/audits/p5-r/). Three movements:

    1. HERO — full-viewport, grid [1fr | 1px amber spine | 1fr]. LEFT: kicker
       (agency identity, amber text) → two-line THESIS at --text-hero (line 2
       --primary + dot) → THREE equal stat tiles (vehicles tracked · on-time with
       its verdict word · routes live) → statement → lede → CTA row (--primary
       "Explore the network" + THE amber-ground map conversion CTA — the view's
       one). RIGHT: the live-pulse TerminalPanel — 2×2 KPI board (coverage ·
       median delay · slowest 10% · not reporting, zero overlap with the tiles)
       + the mono fleet-status readout. FELT-SYMMETRY LAW (operator 2026-07-09):
       both columns read equally FULL at a glance — balance comes from real
       content mass and grid centering, never from stretching a short box.

    2. WHAT THIS IS — heading + one tight bilingual paragraph (60ch) stacked
       ABOVE three honesty pillars in ONE equal row (identical chassis + content
       budget). Provider-agnostic copy templated on the manifest.

    3. EXPLORE — every surface in ONE uniform tile grammar (identical chassis,
       identical size, rows equalized), grouped under station-voice overlines.
       Primary surfaces route via openSurface; reference surfaces are localized
       links.

  HONESTY unchanged: pre-tick/absent live tier stands every number down to the
  styled absence chip — never a fabricated 0. Brand primitives + tokens only.
  Edge-to-edge: hazard tapes span full width; sections inherit the page gutter.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { getLocale, localizeHref, type Locale } from '$lib/i18n';
	import { getV1Context, createLiveStore } from '$lib/v1';
	import { openSurface, type SurfaceTarget } from '$lib/nav';
	import { otpVerdict } from '$lib/v1';
	import { STATUS_LABELS } from '$lib/v1/enumLabels';
	import { StatusBadge } from '$lib/components/dataviz';
	import { formatUtc } from '$lib/utils/time';
	import {
		fmtCount as sharedFmtCount,
		fmtPct as sharedFmtPct,
		fmtDelayMin as sharedFmtDelayMin,
	} from '$lib/utils';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import StatusDot from '$lib/components/brand/StatusDot.svelte';
	import CornerMeta from '$lib/components/brand/CornerMeta.svelte';
	import { cornerMetaLabels } from '$lib/components/brand';
	import TerminalPanel from '$lib/components/brand/TerminalPanel.svelte';
	import { FreshnessStamp } from '$lib/components/surface';
	import { Surface } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import {
		metricInfoFor,
		type MetricKey,
		type SupplementalMetricKey,
	} from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';

	// The locale + booted manifest are stable for this component's lifetime (the
	// root layout boots the v1 context once, before the page tree renders), so we
	// read them as plain consts — no reactive capture, same pattern the other
	// surfaces use for getV1Context().manifest.
	const locale: Locale = getLocale();
	const manifest = getV1Context().manifest;

	// Provider-agnostic identity tokens. short_name / city are optional in the
	// manifest; fall back to display_name so the copy reads on any provider.
	const shortName = manifest.short_name?.trim() || manifest.display_name;
	const city = manifest.city?.trim() || manifest.display_name;

	// Static build time is the dataset anchor; the live tier carries the pulse.
	const generatedUtc =
		manifest.files.live?.generated_utc ?? manifest.files.static?.generated_utc ?? null;

	// Live tier — one store instance for this surface. The v1 context is booted by
	// the time the page tree renders, so getV1Context() is safe here. The store is
	// null until the first client-side tick (start() no-ops during SSR), so the
	// hero pulse stands down honestly on first paint and on a missing live tier.
	const live = createLiveStore(manifest);
	onMount(() => {
		live.start();
		return () => live.stop();
	});

	const net = $derived(live.network);

	// Routes with ≥1 live vehicle right now — the hero's third stat tile. Gated on a
	// reported live tier so a pre-tick empty index reads as honest absence, while a
	// genuine post-tick 0 stays a real zero.
	const routesLive = $derived(net != null ? fmtCount(live.index.vehiclesByRoute.size) : null);

	// The on-time tile's verdict WORD (90/75 reliabilityVerdict floors) — undefined
	// (no sublabel) while the tier is absent or the verdict has no floor.
	const onTimeVerdictWord = $derived.by(() => {
		const pct = net?.on_time_pct;
		if (pct == null) return undefined;
		const v = otpVerdict(pct);
		return v ? STATUS_LABELS[locale][v] : undefined;
	});

	// CornerMeta readouts (A4) — REAL data only, sourced from the manifest + the
	// live tier this page already loads; a datum that isn't present drops its corner
	// (never fabricated). generated_utc formats to an absolute stamp (the corners are
	// a blueprint-margin annotation, aria-hidden, so an absolute time is fine here —
	// the ticking "last updated" lives in the terminal chrome above).
	const cm = cornerMetaLabels[locale];
	const cornerGeneratedStamp = $derived(
		generatedUtc != null ? formatUtc(generatedUtc, locale) : null,
	);
	const cornerVehicleCount = $derived(fmtCount(net?.vehicles_in_service));

	// The pulse formatters return `null` for a missing value (never a fabricated 0);
	// the MetricDisplay then renders its muted `emptyLabel` no-data state, the
	// honest absence reading consistent with the null-aware MetricDisplay.
	/** Nullable percent → "82%" or null (→ MetricDisplay's no-data state). */
	function fmtPct(v: number | null | undefined): string | null {
		return sharedFmtPct(v, { suffix: T[locale].pct });
	}
	/** A required count → localized integer, or null before the first tick. */
	function fmtCount(v: number | null | undefined): string | null {
		return sharedFmtCount(v, { locale });
	}
	/** Nullable minutes → "2 min" or null (→ the honest-absence chip). */
	function fmtMin(v: number | null | undefined): string | null {
		return sharedFmtDelayMin(v, { suffix: T[locale].min });
	}

	type CopyKey =
		| 'kicker'
		| 'thesis1'
		| 'thesis2'
		| 'statement'
		| 'tagline'
		| 'ctaNetwork'
		| 'ctaMap'
		| 'terminalTitle'
		| 'pulseLabel'
		| 'glanceLabel'
		| 'pulseLive'
		| 'pulseStandby'
		| 'datasetLabel'
		| 'noData'
		| 'pct'
		| 'min'
		| 'enter'
		| 'whatTitle'
		| 'whatSub'
		| 'whatBody'
		| 'measureLink'
		| 'metricOnTime'
		| 'metricVehicles'
		| 'metricRoutesLive'
		| 'metricRoutesLiveSub'
		| 'metricVehiclesSub'
		| 'metricDelayP50'
		| 'metricDelayP90'
		| 'metricSilent'
		| 'metricCoverage'
		| 'distLabel'
		| 'groupExplore'
		| 'groupAccount'
		| 'groupTrust'
		| 'exploreNav';

	const T: Record<Locale, Record<CopyKey, string>> = {
		fr: {
			kicker: `TABLEAU DE BORD CITOYEN · ${shortName.toUpperCase()} · ${city.toUpperCase()}`,
			thesis1: 'LE RÉSEAU,',
			thesis2: 'MESURÉ HONNÊTEMENT',
			statement: 'On n’invente jamais de données.',
			tagline: `Le réseau ${shortName} de ${city}, mesuré en direct depuis le flux public. Quand une donnée manque, on l’affiche absente.`,
			ctaNetwork: 'Explorer le réseau →',
			ctaMap: 'Ouvrir la carte en direct',
			terminalTitle: 'reseau.salle-de-controle',
			pulseLabel: 'Le réseau, en ce moment',
			glanceLabel: 'Le réseau en un coup d’œil',
			pulseLive: 'EN DIRECT',
			pulseStandby: 'EN ATTENTE',
			datasetLabel: 'Jeu de données',
			noData: 'aucune donnée',
			pct: '%',
			min: ' min',
			enter: 'Ouvrir',
			whatTitle: 'Ce que c’est',
			whatSub: '// INDÉPENDANT · HONNÊTE D’ABORD',
			whatBody: `Un tableau de bord indépendant et honnête pour le réseau ${shortName} de ${city}, dérivé du flux GTFS-temps réel public via le contrat ouvert /v1. La ponctualité est un indicateur mesuré, un proxy, pas une ponctualité certifiée. Quand une donnée manque, on l’affiche comme absente. Jamais de zéro inventé.`,
			measureLink: 'Comment on mesure',
			metricOnTime: 'Ponctualité',
			metricVehicles: 'Véhicules suivis',
			metricVehiclesSub: `${shortName.toUpperCase()} · EN DIRECT`,
			metricRoutesLive: 'Lignes actives',
			metricRoutesLiveSub: 'EN CE MOMENT',
			metricDelayP50: 'Retard médian',
			metricDelayP90: 'Pires 10 %',
			metricSilent: 'Sans réponse',
			metricCoverage: 'Couverture',
			distLabel: 'État de la flotte',
			groupExplore: 'Explorer',
			groupAccount: 'Reddition de comptes',
			groupTrust: 'Confiance',
			exploreNav: 'Tout explorer',
		},
		en: {
			kicker: `CITIZEN DASHBOARD · ${shortName.toUpperCase()} · ${city.toUpperCase()}`,
			thesis1: 'THE NETWORK,',
			thesis2: 'MEASURED HONESTLY',
			statement: 'We never invent data.',
			tagline: `The ${shortName} network across ${city}, measured live from the public feed. When a number is missing, we show it missing.`,
			ctaNetwork: 'Explore the network →',
			ctaMap: 'Open the live map',
			terminalTitle: 'network.control-room',
			pulseLabel: 'The network, right now',
			glanceLabel: 'The network at a glance',
			pulseLive: 'LIVE',
			pulseStandby: 'STANDBY',
			datasetLabel: 'Dataset',
			noData: 'no data',
			pct: '%',
			min: ' min',
			enter: 'Open',
			whatTitle: 'What this is',
			whatSub: '// INDEPENDENT · HONESTY FIRST',
			whatBody: `An independent, honesty-first dashboard for the ${shortName} network across ${city}, derived from the public GTFS-realtime feed through the open /v1 contract. On-time performance is a measured proxy, not certified OTP. When a number is missing, we show it as missing. Never a fabricated zero.`,
			measureLink: 'How we measure',
			metricOnTime: 'On-time',
			metricVehicles: 'Vehicles tracked',
			metricVehiclesSub: `${shortName.toUpperCase()} · LIVE`,
			metricRoutesLive: 'Routes live',
			metricRoutesLiveSub: 'RIGHT NOW',
			metricDelayP50: 'Median delay',
			metricDelayP90: 'Slowest 10%',
			metricSilent: 'Not reporting',
			metricCoverage: 'Coverage',
			distLabel: 'Fleet status',
			groupExplore: 'Explore',
			groupAccount: 'Accountability',
			groupTrust: 'Trust',
			exploreNav: 'Explore everything',
		},
	};
	const t = $derived(T[locale]);

	// The metric-explainer (i) affordance for each pulse tile: a one-line tip + a
	// localized deep link to /metrics#<anchor>, the SAME wiring NetworkHealth uses on
	// its headline KPIs. Every pulse number carries its honest definition.
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey | SupplementalMetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});

	// Whether the live tier is currently reporting (drives the pulse verdict). The
	// store is null before the first client tick and on a missing/absent live tier.
	const isLive = $derived(net != null);

	// Three honesty pillars — concise, bilingual, glyph + one line each.
	interface Pillar {
		readonly glyph: string;
		readonly title: Record<Locale, string>;
		readonly desc: Record<Locale, string>;
	}
	const PILLARS: readonly Pillar[] = [
		{
			glyph: '◉',
			title: { fr: 'En direct', en: 'Live' },
			desc: {
				fr: 'Lu du flux temps réel, rafraîchi en continu.',
				en: 'Read from the realtime feed, refreshed continuously.',
			},
		},
		{
			glyph: '⊘',
			title: { fr: 'Honnête', en: 'Honest' },
			desc: {
				fr: 'Une donnée absente reste absente. Aucun zéro inventé.',
				en: 'Missing data stays missing. No fabricated zero.',
			},
		},
		{
			glyph: '⚖',
			title: { fr: 'Redevable', en: 'Accountable' },
			desc: {
				fr: 'Points chauds, récidivistes et reçu quotidien, à découvert.',
				en: 'Hotspots, repeat offenders and a daily receipt, in the open.',
			},
		},
	];

	// EXPLORE EVERYTHING — all surfaces grouped so the project's full scope is
	// obvious. Primary surfaces (kind) route via openSurface; reference surfaces
	// (href) are localized <a> links. Each carries a glyph + bilingual title +
	// a one-line description of what it shows.
	type Entry =
		| {
				readonly kind: 'surface';
				readonly target: SurfaceTarget;
				readonly glyph: string;
				readonly title: Record<Locale, string>;
				readonly desc: Record<Locale, string>;
		  }
		| {
				readonly kind: 'link';
				readonly href: string;
				readonly glyph: string;
				readonly title: Record<Locale, string>;
				readonly desc: Record<Locale, string>;
		  };

	interface Group {
		readonly key: 'explore' | 'account' | 'trust';
		readonly label: () => string;
		readonly entries: readonly Entry[];
	}

	const GROUPS: readonly Group[] = [
		{
			key: 'explore',
			label: () => t.groupExplore,
			entries: [
				{
					kind: 'surface',
					target: { kind: 'map' },
					glyph: '✦',
					title: { fr: 'Carte en direct', en: 'Live map' },
					desc: {
						fr: 'Chaque bus et arrêt, en mouvement, sur la carte.',
						en: 'Every bus and stop, moving, on the map.',
					},
				},
				{
					kind: 'surface',
					target: { kind: 'line' },
					glyph: '═',
					title: { fr: 'Lignes', en: 'Lines' },
					desc: {
						fr: 'Détail, horaire et fiabilité par ligne.',
						en: 'Per-line detail, schedule and reliability.',
					},
				},
				{
					kind: 'surface',
					target: { kind: 'stop' },
					glyph: '■',
					title: { fr: 'Arrêts', en: 'Stops' },
					desc: {
						fr: 'Prochains passages et fiabilité par arrêt.',
						en: 'Next departures and reliability per stop.',
					},
				},
				{
					kind: 'surface',
					target: { kind: 'network-health' },
					glyph: '◎',
					title: { fr: 'Santé du réseau', en: 'Network health' },
					desc: {
						fr: 'Vue d’ensemble de la ponctualité en direct.',
						en: 'Live network-wide on-time overview.',
					},
				},
				{
					kind: 'surface',
					target: { kind: 'search' },
					glyph: '⌕',
					title: { fr: 'Rechercher', en: 'Search' },
					desc: {
						fr: 'Trouver une ligne, un arrêt ou un véhicule.',
						en: 'Find a line, stop or vehicle.',
					},
				},
			],
		},
		{
			key: 'account',
			label: () => t.groupAccount,
			entries: [
				{
					kind: 'link',
					href: '/hotspots',
					glyph: '▲',
					title: { fr: 'Points chauds', en: 'Hotspots' },
					desc: {
						fr: 'Où les retards se concentrent sur le réseau.',
						en: 'Where delays concentrate across the network.',
					},
				},
				{
					kind: 'link',
					href: '/receipt',
					glyph: '🜨',
					title: { fr: 'Reçu quotidien', en: 'Daily receipt' },
					desc: {
						fr: 'Le bilan du jour, chiffre par chiffre.',
						en: 'The day in numbers, line by line.',
					},
				},
				{
					kind: 'link',
					href: '/repeat-offenders',
					glyph: '↻',
					title: { fr: 'Récidivistes', en: 'Repeat offenders' },
					desc: {
						fr: 'Les lignes en retard, jour après jour.',
						en: 'The lines that run late, day after day.',
					},
				},
				{
					kind: 'link',
					href: '/alerts',
					glyph: '⚠',
					title: { fr: 'Avis', en: 'Alerts' },
					desc: {
						fr: 'Perturbations de service en vigueur.',
						en: 'Service disruptions in effect.',
					},
				},
			],
		},
		{
			key: 'trust',
			label: () => t.groupTrust,
			entries: [
				{
					kind: 'link',
					href: '/metrics',
					glyph: '∑',
					title: { fr: 'Comment on mesure', en: 'How we measure' },
					desc: {
						fr: 'Définition, calcul exact et limites honnêtes.',
						en: 'Definition, exact math and honest caveats.',
					},
				},
				{
					kind: 'link',
					href: '/status',
					glyph: '♥',
					title: { fr: 'Santé des données', en: 'Data health' },
					desc: {
						fr: 'Fraîcheur, provenance et lacunes connues des flux.',
						en: 'Feed freshness, provenance and known gaps.',
					},
				},
			],
		},
	];
</script>

<Surface pad="hub" class="hub">
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
		<CornerMeta>
			{#snippet topLeft()}<span class="corner-line">{cm.provider} · {shortName}</span>{/snippet}
			{#snippet topRight()}{#if cornerGeneratedStamp}<span class="corner-line"
						>{cm.generated} · {cornerGeneratedStamp}</span
					>{/if}{/snippet}
			{#snippet bottomLeft()}<span class="corner-line"
					>{cm.dataset} · {manifest.dataset_version}</span
				>{/snippet}
			{#snippet bottomRight()}{#if cornerVehicleCount}<span class="corner-line"
						>{cm.vehicles} · {cornerVehicleCount}</span
					>{/if}{/snippet}
		</CornerMeta>

		<div class="hero-left">
			<SectionLabel text={t.kicker} variant="station" class="hero-kicker" />
			<SectionHeading
				heading={t.thesis1}
				headingAccent={t.thesis2}
				level={1}
				id="hub-hero-title"
				class="hero-thesis"
			/>

			<!-- THREE equal stat tiles (build sheet §3: grid-cols-3, gap 14px, card
			     px-5 py-4, MetricDisplay lg) — the row stretches all three to one height. -->
			<ul class="hero-stats" aria-label={t.glanceLabel}>
				<li class="hero-stat">
					<MetricDisplay
						value={fmtCount(net?.vehicles_in_service)}
						label={t.metricVehicles}
						sublabel={t.metricVehiclesSub}
						emptyLabel={t.noData}
						absentReason="not-reported"
						{locale}
						size="lg"
					/>
				</li>
				<li class="hero-stat">
					<MetricDisplay
						value={fmtPct(net?.on_time_pct)}
						label={t.metricOnTime}
						sublabel={onTimeVerdictWord}
						emptyLabel={t.noData}
						absentReason="not-reported"
						{locale}
						size="lg"
					/>
				</li>
				<li class="hero-stat">
					<MetricDisplay
						value={routesLive}
						label={t.metricRoutesLive}
						sublabel={t.metricRoutesLiveSub}
						emptyLabel={t.noData}
						absentReason="not-reported"
						{locale}
						size="lg"
					/>
				</li>
			</ul>

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
		<div class="hero-spine" aria-hidden="true"></div>

		<div class="hero-right">
			<!-- No titlebar `status`: the FreshnessStamp in the panel head is the ONE
			     freshness readout (a second ticking stamp in the chrome read as an echo). -->
			<TerminalPanel
				class="hub-pulse"
				title={t.terminalTitle}
				tag={isLive ? t.pulseLive : t.pulseStandby}
			>
				<div class="pulse-head">
					<span class="pulse-label">
						<StatusDot
							color={isLive ? 'on_time' : 'unknown'}
							pulse={isLive}
							size="md"
							label={isLive ? t.pulseLive : t.pulseStandby}
						/>
						<SectionLabel text={t.pulseLabel} variant="metric" />
					</span>
					<FreshnessStamp
						variant="live"
						generatedUtc={live.generatedUtc}
						ageSeconds={live.ageSeconds}
						isStale={live.isStale}
						{locale}
					/>
				</div>

				<!-- 2×2 EQUAL KPI grid — no overlap with the hero tiles: coverage, median
				     delay, slowest 10%, not reporting. Each tile has the same content
				     budget (value · label · (i)) so the rows stay symmetric. -->
				<ul class="pulse-grid" aria-label={t.pulseLabel} aria-live="polite">
					<li>
						{@render pulse(
							fmtPct(net?.coverage_pct),
							t.metricCoverage,
							'coverage',
							net?.coverage_pct,
						)}
					</li>
					<li>{@render pulse(fmtMin(net?.delay_p50_min), t.metricDelayP50, 'p50p90')}</li>
					<li>{@render pulse(fmtMin(net?.delay_p90_min), t.metricDelayP90, 'p50p90')}</li>
					<li>{@render pulse(fmtCount(net?.non_responding), t.metricSilent, 'silentTrip')}</li>
				</ul>

				<!-- Fleet status readout — REAL live status_dist as mono terminal rows.
				     This is the panel's visual MASS (felt balance with the tall thesis
				     column comes from real content, never from stretching). Renders only
				     when the tier reports; absence keeps the panel honest and shorter. -->
				{#if net?.status_dist}
					<div class="pulse-dist" role="group" aria-label={t.distLabel}>
						<span class="pulse-dist-head label-metric">{t.distLabel}</span>
						<ul class="pulse-dist-rows">
							{#each ['early', 'on_time', 'late', 'severe', 'unknown'] as const as code (code)}
								<li class="pulse-dist-row">
									<span class="pulse-dist-label">{STATUS_LABELS[locale][code]}</span>
									<span class="pulse-dist-value">{fmtCount(net.status_dist[code])}</span>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</TerminalPanel>
		</div>
	</section>

	<Separator variant="hazard" hazardSize="sm" maxWidth="100%" />

	<!-- 2. WHAT THIS IS — SYMMETRIC: the heading + prose stack ABOVE (52ch measure),
	     the three honesty pillars sit in ONE equal-height row below (grid-auto-rows:1fr;
	     every pillar has the same content budget: glyph · title · desc). -->
	<section class="hub-what" aria-labelledby="hub-what-title">
		<div class="what-prose">
			<SectionHeading heading={t.whatTitle} subheading={t.whatSub} level={2} id="hub-what-title" />
			<p class="what-body">{t.whatBody}</p>
			<a class="what-link" href={localizeHref('/metrics', locale)}>
				<span aria-hidden="true">∑</span>
				{t.measureLink}
			</a>
		</div>

		<ul class="pillar-grid">
			{#each PILLARS as pillar (pillar.title.en)}
				<li class="pillar">
					<span class="pillar-glyph" aria-hidden="true">{pillar.glyph}</span>
					<span class="pillar-title">{pillar.title[locale]}</span>
					<span class="pillar-desc">{pillar.desc[locale]}</span>
				</li>
			{/each}
		</ul>
	</section>

	<!-- 3. EXPLORE — ONE uniform tile grammar (the weighted feature/compact split is
	     gone): every surface renders the SAME chassis at the SAME size, rows equalized
	     by grid-auto-rows:1fr, grouped under station-voice overlines for scanning. -->
	<nav class="hub-launch" aria-label={t.exploreNav}>
		{#each GROUPS as group (group.key)}
			{@render launchGroup(group)}
		{/each}
	</nav>
</Surface>

<!-- A pulse tile = MetricDisplay + its (i) explainer, top-aligned beside the quiet
     label (same shape as NetworkHealth's `kpi`). A null value renders the STYLED
     honest-absence chip ('not-reported' — the flagship page speaks the site's own
     absence language), never a fabricated 0. When a `verdictPct` is supplied (the two
     percentage KPIs — on-time + coverage), a StatusBadge WORD + tone reads the 90/75
     reliabilityVerdict floors beneath the value, so the number carries its meaning
     (the evidence dead-end closes). The two counts have no OTP floor → no fabricated
     word. -->
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

<!-- A launchpad group = a station-voice overline + ONE uniform tile grid. Every
     group shares the SAME column template + tile chassis (the old feature/compact
     weighting is gone — symmetry law), rows equalized by grid-auto-rows:1fr. -->
{#snippet launchGroup(group: Group)}
	<section class="launch-group" aria-labelledby={`group-${group.key}`}>
		<h2 class="launch-group-label" id={`group-${group.key}`}>
			<SectionLabel text={group.label()} variant="station" />
		</h2>
		<ul class="launch-grid">
			{#each group.entries as entry (entry.glyph + entry.title.en)}
				<li>
					{#if entry.kind === 'surface'}
						<button type="button" class="hub-tile" onclick={() => openSurface(entry.target)}>
							{@render tileBody(entry.glyph, entry.title[locale], entry.desc[locale])}
						</button>
					{:else}
						<a class="hub-tile" href={localizeHref(entry.href, locale)}>
							{@render tileBody(entry.glyph, entry.title[locale], entry.desc[locale])}
						</a>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/snippet}

{#snippet tileBody(glyph: string, title: string, desc: string)}
	<span class="hub-tile-glyph" aria-hidden="true">{glyph}</span>
	<span class="hub-tile-body">
		<span class="hub-tile-title">{title}</span>
		<span class="hub-tile-desc">{desc}</span>
	</span>
	<span class="hub-tile-cta label-metric" aria-hidden="true">{t.enter} →</span>
{/snippet}

<style>
	/* ══ HERO — yesid home-hero geometry (build sheet §2–§5) ══════════════════════
	   Full-viewport band, grid [1fr | 1px amber spine | 1fr], gap 32px. FELT
	   symmetry (operator law 2026-07-09): both columns read equally FULL at a
	   glance — the left carries the tall thesis stack, the right carries a dense
	   terminal panel, and the grid centers them on each other. Balance comes from
	   real content mass, never from stretching a short box. */
	.hub-hero {
		position: relative; /* CornerMeta host (A4 blueprint margins) */
		display: grid;
		gap: 2rem;
		min-height: calc(100svh - var(--chrome-offset));
		align-content: center;
	}
	@media (min-width: 1024px) {
		.hub-hero {
			grid-template-columns: minmax(0, 1fr) 1px minmax(0, 1fr);
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
		min-width: 0;
	}
	/* Kicker — mono micro, AMBER TEXT accent (yesid hero-kicker: --accent-text ink,
	   12px, tracking 1px). Class lands on the SectionLabel root → :global. */
	.hub-hero :global(.hero-kicker) {
		color: var(--accent-text);
		margin-bottom: 0.75rem;
	}
	/* The two-line THESIS at yesid hero scale: --text-hero, leading 0.88,
	   tracking -0.04em; line 2 (the accent) breaks onto its own row in --primary
	   and carries the dot. Scoped override of SectionHeading's display size. */
	.hub-hero :global(.hero-thesis .section-heading-text) {
		font-size: var(--text-hero-mobile);
		line-height: 0.88;
		letter-spacing: -0.04em;
		text-transform: uppercase;
		overflow-wrap: anywhere;
	}
	@media (min-width: 768px) {
		.hub-hero :global(.hero-thesis .section-heading-text) {
			font-size: var(--text-hero);
		}
	}

	/* THREE equal stat tiles — one row, one chassis, one content budget each
	   (label · value · sublabel). Same-kind cells: the grid row equalizes them. */
	.hero-stats {
		list-style: none;
		margin: 1.5rem 0 0;
		padding: 0;
		display: grid;
		gap: 0.875rem;
		width: 100%;
	}
	@media (min-width: 640px) {
		.hero-stats {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.hero-stat {
		min-width: 0;
		padding: 1rem 1.25rem;
		background-color: var(--card);
		border: 2px solid var(--border-brand);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
	}

	/* Statement → lede → CTAs (yesid vertical rhythm: mt 0.625 / 1.25 / 1.5rem). */
	.hero-statement {
		margin: 1rem 0 0;
		font-family: var(--font-heading);
		font-size: clamp(1.625rem, min(3.5vw, 4svh), 2.75rem);
		font-weight: 700;
		line-height: 1.1;
		color: var(--foreground);
	}
	.hero-lede {
		margin: 1.25rem 0 0;
		font-size: var(--text-heading);
		line-height: 1.7;
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
	/* THE one amber-ground conversion CTA on this view (signage pair). */
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

	/* The 1px vertical spine (yesid §4): amber gradient fading at both ends. */
	.hero-spine {
		display: none;
	}
	@media (min-width: 1024px) {
		.hero-spine {
			display: block;
			width: 1px;
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
	/* 2×2 equal KPI board — same-kind cells (value · label · (i)), grid-equalized. */
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
	/* Fleet-status readout — mono terminal rows under a hairline; the panel's mass. */
	.pulse-dist {
		margin-top: 1.25rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border-subtle);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.pulse-dist-rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.pulse-dist-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
	}
	.pulse-dist-label {
		color: var(--muted-foreground);
		text-transform: uppercase;
		letter-spacing: 1.5px;
	}
	.pulse-dist-value {
		color: var(--accent-text);
		font-variant-numeric: tabular-nums;
	}

	/* ══ WHAT THIS IS — stacked prose + one equal pillar row ═════════════════════ */
	.hub-what {
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}
	/* §C5.1 hierarchy: the §2 heading steps DOWN a register so the hero thesis
	   stays the apex. Scoped; the shared primitive is untouched. */
	.hub-what :global(.section-heading-text) {
		font-size: clamp(1.75rem, 4vw, 2.5rem);
		font-weight: 800;
		letter-spacing: var(--tracking-tight);
	}
	.what-prose {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.what-body {
		color: var(--muted-foreground);
		font-size: var(--text-body);
		line-height: 1.65;
		max-width: 60ch;
	}
	.what-link {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		align-self: flex-start;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--primary);
		text-decoration: none;
		border-bottom: 1px solid transparent;
		transition: border-color var(--duration-fast) var(--ease-default);
	}
	.what-link:hover,
	.what-link:focus-visible {
		border-bottom-color: var(--primary);
	}
	.what-link:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 3px;
	}
	/* Three pillars, ONE row ≥768, identical chassis + content budget → the row
	   reads level without any stretching tricks. */
	.pillar-grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 1.25rem;
		grid-auto-rows: 1fr;
	}
	@media (min-width: 768px) {
		.pillar-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
	}
	.pillar {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 1.25rem 1.5rem;
		background-color: var(--card);
		border: 2px solid var(--border-brand);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
		min-width: 0;
	}
	.pillar-glyph {
		font-family: var(--font-mono);
		font-size: var(--text-heading);
		line-height: 1;
		color: var(--accent-text);
	}
	.pillar-title {
		font-family: var(--font-heading);
		font-weight: 700;
		font-size: var(--text-subheading);
	}
	.pillar-desc {
		color: var(--muted-foreground);
		font-size: var(--text-small);
		line-height: 1.5;
	}

	/* ══ EXPLORE — ONE uniform tile grammar, equal rows ══════════════════════════ */
	.hub-launch {
		display: flex;
		flex-direction: column;
		gap: 2.5rem;
	}
	.launch-group {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.launch-group-label {
		margin: 0;
	}
	/* Every group shares the SAME column template + auto-rows:1fr — tiles are the
	   same width and every row is level, across all three groups. */
	.launch-grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 1.25rem;
		grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
		grid-auto-rows: 1fr;
	}
	.launch-grid > li {
		min-width: 0;
		display: flex;
	}
	/* ONE tile chassis (the feature/compact split is gone): glyph · title · desc ·
	   enter — an identical content budget on every surface. */
	.hub-tile {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1.25rem 1.5rem;
		text-align: left;
		text-decoration: none;
		background-color: var(--card);
		color: var(--foreground);
		border: 2px solid var(--border-brand);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
		cursor: pointer;
		transition:
			border-color var(--duration-fast) var(--ease-default),
			transform var(--duration-fast) var(--ease-out),
			box-shadow var(--duration-fast) var(--ease-out);
	}
	.hub-tile:hover {
		border-color: var(--border-brand-active);
		transform: translateY(-2px);
		box-shadow: var(--shadow-section);
	}
	.hub-tile:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}
	/* The glyph rides the amber TEXT accent (station wayfinding) — distinct from
	   the reserved amber GROUND conversion CTA. */
	.hub-tile-glyph {
		font-family: var(--font-mono);
		font-size: var(--text-title);
		line-height: 1;
		color: var(--accent-text);
	}
	.hub-tile-body {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		flex: 1 1 auto;
		min-width: 0;
	}
	.hub-tile-title {
		font-family: var(--font-heading);
		font-weight: 700;
		font-size: var(--text-subheading);
		line-height: 1.2;
	}
	.hub-tile-desc {
		color: var(--muted-foreground);
		font-size: var(--text-small);
		line-height: 1.5;
	}
	.hub-tile-cta {
		margin-top: auto;
		color: var(--primary);
		white-space: nowrap;
	}

	@media (prefers-reduced-motion: reduce) {
		.hub-tile,
		.hero-cta,
		.what-link {
			transition: none;
		}
		.hub-tile:hover,
		.hero-cta:hover {
			transform: none;
		}
	}
</style>
