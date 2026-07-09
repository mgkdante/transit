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
	import { STATUS_LABELS, OCCUPANCY_LABELS } from '$lib/v1/enumLabels';
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
			value: `${Math.round(mix[code] * 100)}${T[locale].pct}`,
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
		| 'metricDelayP50'
		| 'metricSilent'
		| 'metricCoverage'
		| 'distLabel'
		| 'distColStatus'
		| 'distColVehicles'
		| 'crowdLabel'
		| 'distColCrowding'
		| 'distColShare'
		| 'busyLabel'
		| 'distColRoute'
		| 'qWhere'
		| 'qWhereScope'
		| 'qTrust'
		| 'qTrustScope'
		| 'qPromise'
		| 'qPromiseScope'
		| 'qMethod'
		| 'qMethodScope'
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
			pulseLive: 'EN DIRECT',
			pulseStandby: 'EN ATTENTE',
			datasetLabel: 'Jeu de données',
			noData: 'aucune donnée',
			pct: '%',
			min: ' min',
			enter: 'Ouvrir',
			whatTitle: 'Ce que c’est',
			whatSub: '// INDÉPENDANT · HONNÊTE D’ABORD',
			whatBody: `Un tableau de bord indépendant pour le réseau ${shortName} de ${city}, construit à partir du même flux public que les bus diffusent en direct. Ici, « à l’heure » veut dire ce qu’on a mesuré nous-mêmes, pas une statistique officielle. Quand une donnée manque, on l’affiche comme absente. Jamais de zéro inventé.`,
			measureLink: 'Comment on mesure',
			metricOnTime: 'Ponctualité',
			metricDelayP50: 'Retard médian',
			metricSilent: 'Sans réponse',
			metricCoverage: 'Couverture',
			distLabel: 'État de la flotte',
			distColStatus: 'statut',
			distColVehicles: 'véhicules',
			crowdLabel: 'Achalandage',
			distColCrowding: 'achalandage',
			distColShare: 'part',
			busyLabel: 'Lignes les plus actives',
			distColRoute: 'ligne',
			qWhere: 'Où est mon bus ?',
			qWhereScope: 'Le voir bouger, savoir quand il passe, trouver le vôtre.',
			qTrust: 'À quelle ligne se fier ?',
			qTrustScope: 'Comparer la performance réelle des lignes et du réseau.',
			qPromise: 'Ont-ils tenu parole ?',
			qPromiseScope: 'Le bilan du jour, les récidivistes et les perturbations.',
			qMethod: 'Derrière les chiffres',
			qMethodScope: 'Comment on mesure, et à quel point les données sont fraîches.',
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
			pulseLive: 'LIVE',
			pulseStandby: 'STANDBY',
			datasetLabel: 'Dataset',
			noData: 'no data',
			pct: '%',
			min: ' min',
			enter: 'Open',
			whatTitle: 'What this is',
			whatSub: '// INDEPENDENT · HONESTY FIRST',
			whatBody: `An independent dashboard for the ${shortName} network across ${city}, built from the same public feed the buses broadcast live. Here, “on time” means what we measured ourselves, not an official statistic. When a number is missing, we show it as missing. Never a fabricated zero.`,
			measureLink: 'How we measure',
			metricOnTime: 'On-time',
			metricDelayP50: 'Median delay',
			metricSilent: 'Not reporting',
			metricCoverage: 'Coverage',
			distLabel: 'Fleet status',
			distColStatus: 'status',
			distColVehicles: 'vehicles',
			crowdLabel: 'Crowding',
			distColCrowding: 'crowding',
			distColShare: 'share',
			busyLabel: 'Busiest lines',
			distColRoute: 'route',
			qWhere: 'Where’s my bus?',
			qWhereScope: 'See it moving, know when it comes, find yours.',
			qTrust: 'Which line can I trust?',
			qTrustScope: 'Compare how lines and the whole network actually perform.',
			qPromise: 'Did they keep their promise?',
			qPromiseScope: 'The daily verdict, the repeat offenders, the disruptions.',
			qMethod: 'Behind the numbers',
			qMethodScope: 'How we measure, and how fresh the data is.',
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
		readonly key: 'where-bus' | 'trust-line' | 'promise' | 'method';
		/** The rider QUESTION this group answers (the visible heading). */
		readonly question: () => string;
		/** One plain sentence of scope under the question (what you'll find). */
		readonly scope: () => string;
		readonly entries: readonly Entry[];
	}

	const GROUPS: readonly Group[] = [
		{
			key: 'where-bus',
			question: () => t.qWhere,
			scope: () => t.qWhereScope,
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
			key: 'trust-line',
			question: () => t.qTrust,
			scope: () => t.qTrustScope,
			entries: [
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
					target: { kind: 'network-health' },
					glyph: '◎',
					title: { fr: 'Santé du réseau', en: 'Network health' },
					desc: {
						fr: 'Vue d’ensemble de la ponctualité en direct.',
						en: 'Live network-wide on-time overview.',
					},
				},
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
			],
		},
		{
			key: 'promise',
			question: () => t.qPromise,
			scope: () => t.qPromiseScope,
			entries: [
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
			key: 'method',
			question: () => t.qMethod,
			scope: () => t.qMethodScope,
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
		<!-- No provider corner: the kicker already carries CITIZEN DASHBOARD · {SHORT} ·
		     {CITY} — a PROVIDER corner would say it twice (operator variation, 2026-07-09:
		     lift the yesid pattern, then trim what this dashboard doesn't need). -->
		<CornerMeta>
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
		<div class="hero-spine" aria-hidden="true"></div>

		<div class="hero-right">
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

<!-- A wayfinding group = a RIDER QUESTION as the heading + one plain sentence of
     scope (research 2026-07-09: task/question-led IA beats taxonomy labels like
     "Explore"/"Accountability"; a scope line under every section label tells the
     reader what's behind the click). ONE uniform tile grid; every group shares
     the SAME chassis + column template, rows equalized. -->
{#snippet launchGroup(group: Group)}
	<section class="launch-group" aria-labelledby={`group-${group.key}`}>
		<div class="launch-group-head">
			<h2 class="launch-group-question" id={`group-${group.key}`}>{group.question()}</h2>
			<p class="launch-group-scope">{group.scope()}</p>
		</div>
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
		/* 100dvh WITH the navbar inside (operator, 2026-07-09): the band starts at
		   the viewport top — cancelling BOTH the layout's nav-clearance pad
		   (--chrome-offset on the page wrapper) AND the hub Surface's top pad (its
		   exposed var) — and spans exactly one viewport. The floating pill lives
		   INSIDE the band; --chrome-offset as top padding keeps content clear of it. */
		margin-top: calc(-1 * (var(--chrome-offset) + var(--surface-pad-y)));
		min-height: 100dvh;
		padding-top: var(--chrome-offset);
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
		/* NO overflow-wrap:anywhere here — an anywhere-break lets the terminating
		   dot wrap onto its own line (operator law: the dot sits beside the last
		   word, always). The thesis copy is short controlled text; default
		   word-boundary wrapping is safe at every viewport. */
	}
	@media (min-width: 768px) {
		.hub-hero :global(.hero-thesis .section-heading-text) {
			font-size: var(--text-hero);
		}
	}

	/* Statement → lede → CTAs (yesid vertical rhythm: mt 0.625 / 1.25 / 1.5rem). */
	.hero-statement {
		margin: 1.5rem 0 0;
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
	/* Three result grids in one row — similar row counts keep the trio level
	   (felt symmetry via matching content, never stretching); wraps below. */
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
	/* The result GRID — a real SQL client result set (operator, 2026-07-09):
	   visible gridlines on every cell, header row set off on a faint ground,
	   labels LEFT, counts RIGHT-ALIGNED in-column, natural width (max-content
	   beats the global full-width table rule). */
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
	/* Status-colored chip — the SAME dataviz status scale every chart rides (DATA
	   voice, not --primary). */
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
	/* Crowding dots — the dataviz OCCUPANCY scale (purple family). */
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
	/* The rider QUESTION as a readable heading (plain language, not mono-caps
	   taxonomy) + one muted sentence of scope: the reader knows what a group
	   holds before scanning a single card. */
	.launch-group-head {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.launch-group-question {
		margin: 0;
		font-family: var(--font-heading);
		font-size: var(--text-heading);
		font-weight: 800;
		letter-spacing: var(--tracking-tight);
		color: var(--foreground);
	}
	.launch-group-scope {
		margin: 0;
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	/* Every group shares the SAME column template + auto-rows:1fr — tiles are the
	   same width and every row is level, across all three groups. */
	.launch-grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 1.25rem;
		/* auto-FIT (not fill): empty tracks collapse so each question's tiles span
		   the full row edge-to-edge — no dead right half (felt symmetry). Rows stay
		   uniform WITHIN a group; the 2-tile method row breathes wider by design. */
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
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
