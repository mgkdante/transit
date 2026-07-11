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

    2. WHAT THIS IS — TWO columns (wayfinding v2): the heading + prose in one,
       the three ground rules (Live / Honest / Accountable) in the other as an
       INFORMATIONAL species — a legend against an amber rule, no card chassis,
       no hover, nothing that could be mistaken for a clickable destination.
       Provider-agnostic copy templated on the manifest.

    3. EXPLORE — a LEFT FILTER RAIL (the site's one SurfaceRail grammar: sticky
       glass panel ≥1024, ONE pill→sheet below) beside the destination cards.
       Two facets — the rider question + the kind of answer (live now / the
       record / the method) — with the four question groups as the default
       unfiltered view. Cards share ONE chassis: big glyph + kind tag up top,
       heading-scale title, body-scale description, a hairline footer CTA.
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
	import { FreshnessStamp, SurfaceRail } from '$lib/components/surface';
	import { FilterGroup, FilterSummary } from '$lib/components/filter';
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
		| 'pillarsLabel'
		| 'measureLink'
		| 'filterLabel'
		| 'filterByQuestion'
		| 'filterByKind'
		| 'tempoNow'
		| 'tempoRecord'
		| 'tempoMethod'
		| 'filterOpen'
		| 'filterClose'
		| 'filterEmpty'
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
			pillarsLabel: '// LES RÈGLES DU JEU',
			measureLink: 'Comment on mesure',
			filterLabel: 'Filtres',
			filterByQuestion: 'Par question',
			filterByKind: 'Par genre',
			tempoNow: 'En direct',
			tempoRecord: 'Le bilan',
			tempoMethod: 'La méthode',
			filterOpen: 'Ouvrir les filtres',
			filterClose: 'Fermer les filtres',
			filterEmpty:
				'Rien ne correspond à ces filtres. Effacez-les pour retrouver toutes les destinations.',
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
			pillarsLabel: '// THE GROUND RULES',
			measureLink: 'How we measure',
			filterLabel: 'Filters',
			filterByQuestion: 'By question',
			filterByKind: 'By kind',
			tempoNow: 'Live now',
			tempoRecord: 'The record',
			tempoMethod: 'The method',
			filterOpen: 'Open the filters',
			filterClose: 'Close the filters',
			filterEmpty: 'Nothing matches these filters. Clear them to see every destination.',
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
	// a plain-words description + a TEMPO — the kind of answer the destination
	// gives (live now / the record / the method), the second filter facet and
	// the card's corner tag.
	type Tempo = 'now' | 'record' | 'method';
	interface EntryBody {
		readonly glyph: string;
		readonly tempo: Tempo;
		readonly title: Record<Locale, string>;
		readonly desc: Record<Locale, string>;
	}
	type Entry =
		| (EntryBody & { readonly kind: 'surface'; readonly target: SurfaceTarget })
		| (EntryBody & { readonly kind: 'link'; readonly href: string });

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
					tempo: 'now',
					title: { fr: 'Carte en direct', en: 'Live map' },
					desc: {
						fr: 'Chaque bus sur la carte, en mouvement en temps réel. Touchez-en un pour le suivre.',
						en: 'Every bus on the map, moving in real time. Tap one to follow it.',
					},
				},
				{
					kind: 'surface',
					target: { kind: 'stop' },
					glyph: '■',
					tempo: 'now',
					title: { fr: 'Arrêts', en: 'Stops' },
					desc: {
						fr: 'Les prochains passages à votre arrêt, et sa fiabilité habituelle.',
						en: 'The next departures at your stop, and how reliable it usually is.',
					},
				},
				{
					kind: 'surface',
					target: { kind: 'search' },
					glyph: '⌕',
					tempo: 'now',
					title: { fr: 'Rechercher', en: 'Search' },
					desc: {
						fr: 'Trouvez une ligne, un arrêt ou un véhicule par son nom ou son numéro.',
						en: 'Find a line, a stop or a vehicle by its name or number.',
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
					tempo: 'record',
					title: { fr: 'Lignes', en: 'Lines' },
					desc: {
						fr: 'Une page par ligne : l’horaire, les retards, et sa tenue jour après jour.',
						en: 'One page per line: the schedule, the delays, and how it holds up day after day.',
					},
				},
				{
					kind: 'surface',
					target: { kind: 'network-health' },
					glyph: '◎',
					tempo: 'now',
					title: { fr: 'Santé du réseau', en: 'Network health' },
					desc: {
						fr: 'Tout le réseau d’un coup d’œil : la part qui roule à l’heure en ce moment.',
						en: 'The whole network at a glance: how much of it is running on time right now.',
					},
				},
				{
					kind: 'link',
					href: '/hotspots',
					glyph: '▲',
					tempo: 'record',
					title: { fr: 'Points chauds', en: 'Hotspots' },
					desc: {
						fr: 'Les endroits où les retards s’accumulent, sur l’ensemble du réseau.',
						en: 'The places where delays pile up, mapped across the whole network.',
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
					tempo: 'record',
					title: { fr: 'Reçu quotidien', en: 'Daily receipt' },
					desc: {
						fr: 'Le bilan du jour, chiffre par chiffre : ce qui était promis, ce qui est vraiment passé.',
						en: 'The day in numbers, line by line: what was promised, what actually showed up.',
					},
				},
				{
					kind: 'link',
					href: '/repeat-offenders',
					glyph: '↻',
					tempo: 'record',
					title: { fr: 'Récidivistes', en: 'Repeat offenders' },
					desc: {
						fr: 'Les lignes qui accumulent les retards, jour après jour, classées au grand jour.',
						en: 'The lines that keep running late, day after day, ranked in the open.',
					},
				},
				{
					kind: 'link',
					href: '/alerts',
					glyph: '⚠',
					tempo: 'now',
					title: { fr: 'Avis', en: 'Alerts' },
					desc: {
						fr: 'Les perturbations en vigueur en ce moment, et l’historique des précédentes.',
						en: 'Service disruptions in effect right now, plus the record of past ones.',
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
					tempo: 'method',
					title: { fr: 'Comment on mesure', en: 'How we measure' },
					desc: {
						fr: 'Chaque chiffre défini en mots simples : ce qu’il compte, et ce qu’il rate honnêtement.',
						en: 'Every number defined in plain words: what it counts, and what it honestly misses.',
					},
				},
				{
					kind: 'link',
					href: '/status',
					glyph: '♥',
					tempo: 'method',
					title: { fr: 'Santé des données', en: 'Data health' },
					desc: {
						fr: 'Nos données sont-elles fraîches ? Le dernier signal de chaque flux, et les trous qu’on connaît.',
						en: 'Is our data fresh? When each feed last answered, and the gaps we know about.',
					},
				},
			],
		},
	];

	// ── EXPLORE filters (wayfinding v2) ─────────────────────────────────────────
	// Two single-select facets over the destination cards: the rider QUESTION
	// (one group) and the KIND of answer (tempo). null = "All". Plain page state,
	// no URL mirror — the home is a launchpad, not a shareable filtered view; the
	// four question groups are the default. Groups keep their heading while any
	// card in them matches; a group with no matching card hides whole.
	let activeQuestion = $state<Group['key'] | null>(null);
	let activeTempo = $state<Tempo | null>(null);

	const filtersActive = $derived(activeQuestion != null || activeTempo != null);
	const visibleGroups = $derived(
		GROUPS.map((group) => ({
			group,
			entries:
				activeQuestion != null && group.key !== activeQuestion
					? []
					: group.entries.filter((e) => activeTempo == null || e.tempo === activeTempo),
		})).filter(({ entries }) => entries.length > 0),
	);
	const matchCount = $derived(visibleGroups.reduce((n, g) => n + g.entries.length, 0));
	function clearFilters(): void {
		activeQuestion = null;
		activeTempo = null;
	}

	const questionItems = $derived(GROUPS.map((g) => ({ key: g.key, label: g.question() })));
	const tempoItems = $derived([
		{ key: 'now', label: t.tempoNow },
		{ key: 'record', label: t.tempoRecord },
		{ key: 'method', label: t.tempoMethod },
	]);
	const tempoTag = $derived<Record<Tempo, string>>({
		now: t.tempoNow,
		record: t.tempoRecord,
		method: t.tempoMethod,
	});

	// The FilterSummary count phrasing + the mobile pill summary share one
	// per-locale plural rule (FR: 0 and 1 are singular; EN: only 1 is).
	const FILTER_COUNT_LABEL: Record<Locale, { singular: string; plural: string }> = {
		en: { singular: '{count} destination', plural: '{count} destinations' },
		fr: { singular: '{count} destination', plural: '{count} destinations' },
	};
	const pillSummary = $derived.by(() => {
		const tpl = FILTER_COUNT_LABEL[locale];
		const isPlural = locale === 'fr' ? matchCount >= 2 : matchCount !== 1;
		return (isPlural ? tpl.plural : tpl.singular).replace('{count}', String(matchCount));
	});
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

	<!-- 2. WHAT THIS IS — TWO columns (wayfinding v2): prose | ground rules. The
	     rules are an INFORMATIONAL species — a legend seated against an amber rule,
	     no card chassis, no hover, no CTA — visibly NOT the clickable destination
	     cards below. Felt symmetry: real content mass on both sides, centered. -->
	<section class="hub-what" aria-labelledby="hub-what-title">
		<div class="what-prose">
			<SectionHeading heading={t.whatTitle} subheading={t.whatSub} level={2} id="hub-what-title" />
			<p class="what-body">{t.whatBody}</p>
			<a class="what-link" href={localizeHref('/metrics', locale)}>
				<span aria-hidden="true">∑</span>
				{t.measureLink}
			</a>
		</div>

		<div class="what-pillars">
			<SectionLabel text={t.pillarsLabel} variant="station" />
			<ul class="pillar-list">
				{#each PILLARS as pillar (pillar.title.en)}
					<li class="pillar">
						<span class="pillar-glyph" aria-hidden="true">{pillar.glyph}</span>
						<span class="pillar-text">
							<span class="pillar-title">{pillar.title[locale]}</span>
							<span class="pillar-desc">{pillar.desc[locale]}</span>
						</span>
					</li>
				{/each}
			</ul>
		</div>
	</section>

	<!-- 3. EXPLORE — the LEFT FILTER RAIL beside the destination cards. The rail is
	     the site's ONE rail grammar (SurfaceRail: sticky glass panel ≥1024, pill→sheet
	     below) carrying the two facets + the match summary; the four rider-question
	     groups stay the default view, and a group hides whole when nothing in it
	     matches. -->
	<div class="hub-launch">
		{#snippet exploreRail()}
			<div class="explore-filters" role="group" aria-label={t.filterLabel}>
				<FilterGroup
					label={t.filterByQuestion}
					items={questionItems}
					activeKey={activeQuestion}
					density="spacious"
					onSelect={(key) => (activeQuestion = key as Group['key'] | null)}
					testIdPrefix="hub-filter-question"
				/>
				<FilterGroup
					label={t.filterByKind}
					items={tempoItems}
					activeKey={activeTempo}
					density="spacious"
					onSelect={(key) => (activeTempo = key as Tempo | null)}
					testIdPrefix="hub-filter-kind"
				/>
				{#if filtersActive}
					<FilterSummary
						count={matchCount}
						countLabel={FILTER_COUNT_LABEL}
						onClear={clearFilters}
					/>
				{/if}
			</div>
		{/snippet}
		<SurfaceRail
			rail={exploreRail}
			label={t.filterLabel}
			summary={pillSummary}
			openAria={t.filterOpen}
			closeAria={t.filterClose}
		/>

		<nav class="launch-content" aria-label={t.exploreNav}>
			{#each visibleGroups as { group, entries } (group.key)}
				{@render launchGroup(group, entries)}
			{/each}
			{#if matchCount === 0}
				<p class="launch-empty" role="status">{t.filterEmpty}</p>
			{/if}
		</nav>
	</div>
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
     the SAME chassis + column template, rows equalized. `entries` arrives already
     facet-filtered (the group hides upstream when it empties). -->
{#snippet launchGroup(group: Group, entries: readonly Entry[])}
	<section class="launch-group" aria-labelledby={`group-${group.key}`}>
		<div class="launch-group-head">
			<h2 class="launch-group-question" id={`group-${group.key}`}>{group.question()}</h2>
			<p class="launch-group-scope">{group.scope()}</p>
		</div>
		<ul class="launch-grid">
			{#each entries as entry (entry.glyph + entry.title.en)}
				<li>
					{#if entry.kind === 'surface'}
						<button type="button" class="hub-tile" onclick={() => openSurface(entry.target)}>
							{@render tileBody(entry)}
						</button>
					{:else}
						<a class="hub-tile" href={localizeHref(entry.href, locale)}>
							{@render tileBody(entry)}
						</a>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/snippet}

<!-- ONE card interior (wayfinding v2): big amber glyph + the KIND tag on the top
     row (the tag echoes the rail's second facet, so a card tells you what sort of
     answer it opens), heading-scale title, body-scale description that fills the
     width, and the Open CTA seated on a hairline footer. Real content mass in
     every corner — no left-stacked dead space. -->
{#snippet tileBody(entry: Entry)}
	<span class="hub-tile-top">
		<span class="hub-tile-glyph" aria-hidden="true">{entry.glyph}</span>
		<span class="hub-tile-tag label-metric">{tempoTag[entry.tempo]}</span>
	</span>
	<span class="hub-tile-title">{entry.title[locale]}</span>
	<span class="hub-tile-desc">{entry.desc[locale]}</span>
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
		/* DOT LAW, narrow half: SectionHeading glues [last word + dot] in a nowrap
		   tail, so the longest thesis word must FIT the viewport or it clips (html
		   is overflow-x: clip). 10.5vw keeps FR's "HONNÊTEMENT." + dot inside the
		   gutter down to 320px; the token still caps the size everywhere wider. */
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

	/* ══ WHAT THIS IS — two columns: prose | informational ground rules ══════════
	   Wayfinding v2: the rules read as a LEGEND (amber left rule, aligned glyph
	   column, no chassis) so they cannot be mistaken for the clickable cards
	   below. Felt symmetry: both columns carry real mass and center on each
	   other; single column below 1024. */
	.hub-what {
		display: grid;
		grid-template-columns: 1fr;
		gap: 2.5rem;
	}
	@media (min-width: 1024px) {
		.hub-what {
			grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
			gap: clamp(2.5rem, 6vw, 5rem);
			align-items: center;
		}
	}
	/* §C5.1 hierarchy: the §2 heading steps DOWN a register so the hero thesis
	   stays the apex. Scoped; the shared primitive is untouched. */
	.hub-what :global(.section-heading-text) {
		font-size: clamp(2.25rem, 5vw, 3.25rem);
		font-weight: 800;
		letter-spacing: var(--tracking-tight);
	}
	/* The mono sub steps up with it (operator: the whole head reads bigger). */
	.hub-what :global(.section-heading-sub) {
		font-size: var(--text-small);
		margin-block-end: 0;
	}
	.what-prose {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	/* Legibility (operator 2026-07-10, round 2): bright secondary ink + generous
	   leading for readability, one step BELOW the first pass's heading scale —
	   "smaller" but never a muted caption. */
	.what-body {
		color: var(--secondary-foreground);
		font-size: var(--text-subheading);
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
	/* The ground rules — an INFORMATIONAL species: seated against a 1px amber
	   rule with an aligned mono glyph column, transparent ground, square edges,
	   no shadow, no hover, no cursor — none of the clickable-card cues (bordered
	   chassis, radius, lift, Open CTA) the destination tiles wear. */
	.what-pillars {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		border-left: 1px solid var(--line-amber);
		padding-left: clamp(1.25rem, 3vw, 2rem);
		min-width: 0;
	}
	.pillar-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
	.pillar {
		display: grid;
		grid-template-columns: 2.75rem minmax(0, 1fr);
		column-gap: 0.875rem;
		align-items: start;
	}
	.pillar-glyph {
		font-family: var(--font-mono);
		font-size: 1.75rem;
		line-height: 1.15;
		color: var(--accent-text);
	}
	.pillar-text {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}
	.pillar-title {
		font-family: var(--font-heading);
		font-weight: 700;
		font-size: var(--text-subheading);
		line-height: 1.2;
	}
	.pillar-desc {
		color: var(--muted-foreground);
		font-size: var(--text-body);
		line-height: 1.55;
	}

	/* ══ EXPLORE — [ FILTER RAIL | destination groups ] ══════════════════════════
	   The alerts-page grid grammar: one column below 1024 (the rail collapses to
	   SurfaceRail's pill→sheet), [15rem | content] at ≥1024 with the rail sticky.
	   The rail track is RESERVED — it holds its lane whether or not a filter is
	   active. */
	.hub-launch {
		display: grid;
		grid-template-columns: 1fr;
		gap: clamp(1.5rem, 4vw, 2rem);
		width: 100%;
	}
	@media (min-width: 1024px) {
		.hub-launch {
			/* Wider rail (operator: filters need FULL legibility) — the chips get
			   room to breathe and never truncate a rider question. */
			grid-template-columns: 19rem minmax(0, 1fr);
			gap: 2rem;
			align-items: start;
		}
	}
	/* The rail body: the two facet groups + the match summary in one column. */
	.explore-filters {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 0;
	}
	.launch-content {
		display: flex;
		flex-direction: column;
		gap: 2.5rem;
		min-width: 0;
	}
	/* Honest empty state when the two facets intersect to nothing. */
	.launch-empty {
		margin: 0;
		padding: 2rem 0;
		font-size: var(--text-body);
		color: var(--muted-foreground);
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
		   uniform WITHIN a group; the 2-tile method row breathes wider by design.
		   17rem floor: the v2 interiors carry heading-scale titles + body-scale
		   descriptions, which need the wider lane to read. */
		grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
		grid-auto-rows: 1fr;
	}
	.launch-grid > li {
		min-width: 0;
		display: flex;
	}
	/* ONE tile chassis (wayfinding v2): big glyph + kind tag on the top row,
	   heading-scale title, body-scale description, Open CTA on a hairline footer.
	   Content fills the card — the interior earns its area instead of stacking
	   small type in the top-left corner. */
	.hub-tile {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 1.5rem 1.625rem 1.25rem;
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
	/* Top row: the glyph anchors the left, the KIND tag seats the top-right
	   corner — the same words as the rail's second facet, so filter and card
	   speak one language. */
	.hub-tile-top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}
	/* The glyph rides the amber TEXT accent (station wayfinding) — distinct from
	   the reserved amber GROUND conversion CTA. */
	.hub-tile-glyph {
		font-family: var(--font-mono);
		font-size: clamp(2.25rem, 2.5vw, 2.75rem);
		line-height: 1;
		color: var(--accent-text);
	}
	.hub-tile-tag {
		color: var(--muted-foreground);
		white-space: nowrap;
		padding-top: 0.25rem;
	}
	.hub-tile-title {
		font-family: var(--font-heading);
		font-weight: 800;
		font-size: var(--text-heading);
		line-height: 1.15;
		letter-spacing: var(--tracking-tight);
	}
	.hub-tile-desc {
		color: var(--muted-foreground);
		font-size: var(--text-body);
		line-height: 1.6;
	}
	.hub-tile-cta {
		margin-top: auto;
		padding-top: 0.875rem;
		border-top: 1px solid var(--border-subtle);
		align-self: stretch;
		text-align: right;
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
