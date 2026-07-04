<!--
  Hub landing, the network entry surface — a dispatcher's launchpad (P5.4b).

  Renders inside the AppShell `main` zone (the root layout pipes the page tree
  here). Reads the active locale (context) + the booted v1 snapshot context, and
  presents the project at a glance in three movements:

    1. COMMAND-BOARD HERO — the yesid home-hero DNA in transit voice: a two-column
       board [identity Masthead] │ orange divider │ [live-pulse TerminalPanel] at
       ≥1024, stacked below. LEFT is the ONE Masthead family (kicker → display
       title + orange dot → lede) with the blueprint-margin CornerMeta; RIGHT is
       the network "right now" board (the dispatcher status-at-a-glance, co-hero)
       reading the same live network.json /network does, via createLiveStore
       (on-time %, vehicles in service, not-reporting count, coverage %). HONESTY:
       before the first client tick (and during SSR) the store is null, so every
       KPI stands down to the STYLED honest-absence chip (absentReason
       'not-reported') — never a fabricated 0; the two percentage KPIs carry a
       verdict WORD from the reliabilityVerdict floors. A single edge-to-edge
       hazard tape closes the hero.

    2. WHAT THIS IS — one tight bilingual paragraph + three honesty pillars
       (Live / Honest / Accountable) so a first-time visitor instantly grasps the
       whole project: an independent, honesty-first citizen-analytics dashboard
       derived from the live GTFS-realtime feed, a measured PROXY (not certified
       OTP), where null always means "no data". Provider-agnostic: the copy
       templates on short_name / city / display_name from the manifest, never a
       hardcoded agency or place.

    3. LAUNCHPAD — ALL ~10 surfaces as entry points, WEIGHTED like a dispatcher's
       board: the five PRIMARY destinations (Explore group) render as glyph-forward
       FEATURE tiles; the accountability + trust surfaces sit beside each other
       (≥1024) as a denser COMPACT field. Each entry is a focusable tile with a
       glyph, a bilingual title and a one-line description. Primary surfaces route
       through $lib/nav `openSurface` (route-push on mobile, panel-swap on
       desktop); reference surfaces are localized <a> links.

  Brand primitives + tokens only (no hex). The live/healthy dots ride the dataviz
  status scale (DATA), never --primary; --primary is the brand flourish (dot,
  hero divider, tile hover/focus) — amber stays reserved for the one conversion
  CTA. Responsive: the hero + launchpad collapse to a single column < 1024 and
  every board is a DashboardGrid (auto-fit) so nothing overflows at 360px.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { getLocale, localizeHref, type Locale } from '$lib/i18n';
	import { getV1Context, createLiveStore } from '$lib/v1';
	import { openSurface, type SurfaceTarget } from '$lib/nav';
	import { otpVerdict } from '$lib/v1';
	import { STATUS_LABELS } from '$lib/v1/enumLabels';
	import { StatusBadge } from '$lib/components/dataviz';
	import { ageSeconds, formatRelativeSeconds, formatUtc } from '$lib/utils/time';
	import { fmtCount as sharedFmtCount, fmtPct as sharedFmtPct } from '$lib/utils';
	import { sharedClock } from '$lib/stores';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import Masthead from '$lib/components/brand/Masthead.svelte';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import StatusDot from '$lib/components/brand/StatusDot.svelte';
	import CornerMeta from '$lib/components/brand/CornerMeta.svelte';
	import { cornerMetaLabels } from '$lib/components/brand';
	import TerminalPanel from '$lib/components/brand/TerminalPanel.svelte';
	import { FreshnessStamp } from '$lib/components/surface';
	import { Surface, DashboardGrid } from '$lib/components/layout';
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

	// Keep the ONE shared clock alive while this page is on screen so the boot
	// fallback below ticks (the live store also subscribes once started; this is
	// idempotent and covers the pre-tick fallback window).
	$effect(() => sharedClock.subscribe());

	const net = $derived(live.network);

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

	// "Last updated X ago" in the terminal chrome — TICKS off the live store so it
	// advances each second in lockstep with the FreshnessStamp chip below it (a frozen
	// one-shot here read as a contradiction beside the ticking chip). Once the live
	// tier reports we read its ticking `ageSeconds` (advanced off the shared clock);
	// before the first tick we fall back to the one-shot static/boot build time so
	// the chrome still shows an anchor instead of "unknown".
	const lastBuilt = $derived(
		live.generatedUtc != null
			? formatRelativeSeconds(live.ageSeconds ?? 0, locale)
			: generatedUtc != null
				? // The pre-tick fallback is a SERVER build timestamp → anchor its age to
					// the shared SERVER clock (same skew-correction the primary live path
					// already uses), so the two paths stay consistent on a skewed client.
					formatRelativeSeconds(
						Math.max(0, ageSeconds(generatedUtc, sharedClock.serverNow)),
						locale,
					)
				: null,
	);

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

	type CopyKey =
		| 'kicker'
		| 'tagline'
		| 'terminalTitle'
		| 'pulseLabel'
		| 'pulseLive'
		| 'pulseStandby'
		| 'datasetLabel'
		| 'builtLabel'
		| 'builtUnknown'
		| 'noData'
		| 'pct'
		| 'enter'
		| 'whatTitle'
		| 'whatSub'
		| 'whatBody'
		| 'measureLink'
		| 'metricOnTime'
		| 'metricVehicles'
		| 'metricSilent'
		| 'metricCoverage'
		| 'groupExplore'
		| 'groupAccount'
		| 'groupTrust'
		| 'exploreNav';

	const T: Record<Locale, Record<CopyKey, string>> = {
		fr: {
			kicker: 'TABLEAU DE BORD CITOYEN',
			tagline: `Le réseau ${shortName} de ${city}, mesuré en direct. On n'invente jamais de données.`,
			terminalTitle: 'reseau.salle-de-controle',
			pulseLabel: 'Le réseau, en ce moment',
			pulseLive: 'EN DIRECT',
			pulseStandby: 'EN ATTENTE',
			datasetLabel: 'Jeu de données',
			builtLabel: 'Dernière mise à jour',
			builtUnknown: 'inconnue',
			noData: 'aucune donnée',
			pct: '%',
			enter: 'Ouvrir',
			whatTitle: 'Ce que c’est',
			whatSub: '// INDÉPENDANT · HONNÊTE D’ABORD',
			whatBody: `Un tableau de bord indépendant et honnête pour le réseau ${shortName} de ${city}, dérivé du flux GTFS-temps réel public via le contrat ouvert /v1. La ponctualité est un indicateur mesuré, un proxy, pas une ponctualité certifiée. Quand une donnée manque, on l’affiche comme absente. Jamais de zéro inventé.`,
			measureLink: 'Comment on mesure',
			metricOnTime: 'Ponctualité',
			metricVehicles: 'Véhicules en service',
			metricSilent: 'Sans réponse',
			metricCoverage: 'Couverture',
			groupExplore: 'Explorer',
			groupAccount: 'Reddition de comptes',
			groupTrust: 'Confiance',
			exploreNav: 'Tout explorer',
		},
		en: {
			kicker: 'CITIZEN DASHBOARD',
			tagline: `The ${shortName} network across ${city}, measured live. We never invent data.`,
			terminalTitle: 'network.control-room',
			pulseLabel: 'The network, right now',
			pulseLive: 'LIVE',
			pulseStandby: 'STANDBY',
			datasetLabel: 'Dataset',
			builtLabel: 'Last updated',
			builtUnknown: 'unknown',
			noData: 'no data',
			pct: '%',
			enter: 'Open',
			whatTitle: 'What this is',
			whatSub: '// INDEPENDENT · HONESTY FIRST',
			whatBody: `An independent, honesty-first dashboard for the ${shortName} network across ${city}, derived from the public GTFS-realtime feed through the open /v1 contract. On-time performance is a measured proxy, not certified OTP. When a number is missing, we show it as missing. Never a fabricated zero.`,
			measureLink: 'How we measure',
			metricOnTime: 'On-time',
			metricVehicles: 'Vehicles in service',
			metricSilent: 'Not reporting',
			metricCoverage: 'Coverage',
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
		/** Spatial weight on the launchpad — the primary destinations render as
		    glyph-forward feature tiles; the rest as a denser compact field. */
		readonly weight: 'feature' | 'compact';
		readonly label: () => string;
		readonly entries: readonly Entry[];
	}

	const GROUPS: readonly Group[] = [
		{
			key: 'explore',
			weight: 'feature',
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
			weight: 'compact',
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
			weight: 'compact',
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
	<div class="hub-hero">
		<Masthead
			class="hub-head"
			kicker={t.kicker}
			heading={manifest.display_name}
			lede={t.tagline}
			tape={false}
		>
			{#snippet cornerMeta()}
				<!-- A4: blueprint-margin corner annotations — provider · generated · dataset ·
				     live vehicle count, all REAL data from the manifest + live tier. aria-hidden,
				     hidden < 768px; a missing datum drops its corner. -->
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
			{/snippet}
		</Masthead>

		<!-- Faded orange rule (yesid hero-divider idiom; --primary, NEVER amber — amber is
		     the one reserved conversion CTA). Decorative; hidden when the columns stack. -->
		<div class="hub-hero-divider" aria-hidden="true"></div>

		<TerminalPanel
			class="hub-pulse"
			title={t.terminalTitle}
			tag={isLive ? t.pulseLive : t.pulseStandby}
			status={lastBuilt ? `${t.builtLabel} ${lastBuilt}` : t.builtUnknown}
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

			<DashboardGrid
				as="ul"
				minTile="150px"
				maxWidth="none"
				gutter={false}
				class="pulse-grid"
				aria-label={t.pulseLabel}
				aria-live="polite"
			>
				<li>{@render pulse(fmtPct(net?.on_time_pct), t.metricOnTime, 'otp', net?.on_time_pct)}</li>
				<li>
					{@render pulse(fmtCount(net?.vehicles_in_service), t.metricVehicles, 'vehicleCount')}
				</li>
				<li>{@render pulse(fmtCount(net?.non_responding), t.metricSilent, 'silentTrip')}</li>
				<li>
					{@render pulse(
						fmtPct(net?.coverage_pct),
						t.metricCoverage,
						'coverage',
						net?.coverage_pct,
					)}
				</li>
			</DashboardGrid>
		</TerminalPanel>
	</div>

	<Separator variant="hazard" hazardSize="sm" maxWidth="100%" />

	<!-- 2. WHAT THIS IS ------------------------------------------------------- -->
	<section class="hub-what" aria-labelledby="hub-what-title">
		<div class="what-prose">
			<SectionHeading heading={t.whatTitle} subheading={t.whatSub} level={2} id="hub-what-title" />
			<p class="what-body">{t.whatBody}</p>
			<a class="what-link" href={localizeHref('/metrics', locale)}>
				<span aria-hidden="true">∑</span>
				{t.measureLink}
			</a>
		</div>

		<DashboardGrid as="ul" minTile="180px" maxWidth="none" gutter={false} class="pillar-grid">
			{#each PILLARS as pillar (pillar.title.en)}
				<li class="pillar">
					<span class="pillar-glyph" aria-hidden="true">{pillar.glyph}</span>
					<span class="pillar-title">{pillar.title[locale]}</span>
					<span class="pillar-desc">{pillar.desc[locale]}</span>
				</li>
			{/each}
		</DashboardGrid>
	</section>

	<!-- 3. LAUNCHPAD ---------------------------------------------------------- -->
	<!-- Every surface as an entry point, weighted like a dispatcher's board: the five
	     PRIMARY destinations render as glyph-forward FEATURE tiles; the accountability +
	     trust surfaces sit beside each other (≥1024) as a denser COMPACT field. -->
	<nav class="hub-launch" aria-label={t.exploreNav}>
		{#each GROUPS as group (group.key)}
			{#if group.weight === 'feature'}
				{@render launchGroup(group)}
			{/if}
		{/each}
		<div class="launch-secondary">
			{#each GROUPS as group (group.key)}
				{#if group.weight === 'compact'}
					{@render launchGroup(group)}
				{/if}
			{/each}
		</div>
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

<!-- A launchpad group = a station-voice overline + a tile grid. The `weight` drives
     both the tile treatment (glyph-forward feature vs inline compact) and the tile
     min-width, so one snippet renders the primary board and the secondary field. -->
{#snippet launchGroup(group: Group)}
	<section class="launch-group launch-group--{group.weight}" aria-labelledby={`group-${group.key}`}>
		<h2 class="launch-group-label" id={`group-${group.key}`}>
			<SectionLabel text={group.label()} variant="station" />
		</h2>
		<DashboardGrid
			as="ul"
			minTile={group.weight === 'feature' ? '224px' : '210px'}
			maxWidth="none"
			gutter={false}
			class="launch-grid"
		>
			{#each group.entries as entry (entry.glyph + entry.title.en)}
				<li>
					{#if entry.kind === 'surface'}
						<button
							type="button"
							class="hub-tile hub-tile--{group.weight}"
							onclick={() => openSurface(entry.target)}
						>
							{@render tileBody(entry.glyph, entry.title[locale], entry.desc[locale], group.weight)}
						</button>
					{:else}
						<a class="hub-tile hub-tile--{group.weight}" href={localizeHref(entry.href, locale)}>
							{@render tileBody(entry.glyph, entry.title[locale], entry.desc[locale], group.weight)}
						</a>
					{/if}
				</li>
			{/each}
		</DashboardGrid>
	</section>
{/snippet}

{#snippet tileBody(glyph: string, title: string, desc: string, weight: 'feature' | 'compact')}
	<span class="hub-tile-glyph" aria-hidden="true">{glyph}</span>
	<span class="hub-tile-body">
		<span class="hub-tile-title">{title}</span>
		<span class="hub-tile-desc">{desc}</span>
	</span>
	<span class="hub-tile-cta label-metric" aria-hidden="true">
		{t.enter}{#if weight === 'feature'}<span class="hub-tile-arrow"> →</span>{/if}
	</span>
{/snippet}

<style>
	/* ── Command-board hero ───────────────────────────────────────────────── */
	/* Two-column board — [identity] │ divider │ [live pulse] — ≥1024; stacked below.
	   align-items:start keeps each column its natural height; the divider spans the row. */
	.hub-hero {
		display: grid;
		gap: clamp(1.5rem, 5vw, 2.75rem);
	}
	@media (min-width: 1024px) {
		.hub-hero {
			grid-template-columns: minmax(0, 1.05fr) 1px minmax(0, 1fr);
			gap: clamp(2rem, 4vw, 3.5rem);
			align-items: start;
		}
	}
	/* The hero head is a Masthead (class="hub-head" on its root — `:global` because the
	   class lands on the child component's root, not on an element in this file); it owns
	   the position:relative cornered host + the ≥768px padding-block band internally. Cap
	   its measure only when it fills the viewport (< 1024); ≥1024 the grid column bounds it. */
	:global(.hub-head) {
		max-width: 62ch;
	}
	@media (min-width: 1024px) {
		:global(.hub-head) {
			max-width: none;
		}
	}
	/* H1 overflow-wrap (§C5.1): a long provider display_name must break inside the word
	   rather than overflow the hero measure on a narrow phone. */
	:global(.hub-head .section-heading-text) {
		overflow-wrap: anywhere;
	}
	/* H1 > H2 weight fix (§C5.1): SectionHeading's DISPLAY mode is a fixed display scale
	   regardless of `level`, so the hub's §2 "What this is" heading rendered at the SAME
	   size as the H1 (the inversion — no visual hierarchy). Step the §2 display heading
	   DOWN one register here so the H1 clearly reads as the apex. Scoped to the hub so the
	   shared primitive is untouched. */
	.hub-what :global(.section-heading-text) {
		font-size: clamp(1.75rem, 4vw, 2.5rem);
		font-weight: 800;
		letter-spacing: var(--tracking-tight);
	}
	.corner-line {
		white-space: nowrap;
	}

	/* Faded orange rule between the identity and the live pulse (yesid hero-divider
	   idiom; --border-brand = --primary @60%, NOT amber). Only when the columns sit side
	   by side; it collapses (display:none) when they stack. */
	.hub-hero-divider {
		display: none;
	}
	@media (min-width: 1024px) {
		.hub-hero-divider {
			display: block;
			width: 1px;
			align-self: stretch;
			background: linear-gradient(
				180deg,
				transparent 0%,
				var(--border-brand) 18%,
				var(--border-brand) 82%,
				transparent 100%
			);
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
	:global(.pulse-grid) {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	:global(.pulse-grid) > li {
		min-width: 0;
	}
	/* In the hero, the live board reads as a clean 2×2 beside the identity. Below 1024
	   the panel is full width and DashboardGrid's auto-fit (minTile 150) governs. The
	   selector is `.hub-pulse ul.pulse-grid` (0,2,1) so it beats DashboardGrid's own
	   scoped `.dashboard-grid.svelte-xxx` grid-template-columns rule (0,2,0) — a bare
	   `.pulse-grid` (0,1,0) loses to it regardless of source order (the 2×2 stays inert). */
	@media (min-width: 1024px) {
		:global(.hub-pulse ul.pulse-grid) {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	/* A pulse KPI cell: the MetricDisplay (label + big value) with its (i) explainer
	   pinned beside the quiet label, top-aligned so it never overlaps the value.
	   Mirrors NetworkHealth's .network-kpi. */
	.pulse-kpi {
		display: flex;
		align-items: flex-start;
		gap: 0.375rem;
		min-width: 0;
		/* Fill the grid cell so the 2×2 pulse reads as an equal-height board (a KPI with a
		   verdict word no longer sits taller than a bare-count KPI beside it). */
		height: 100%;
	}
	/* The value + its verdict word stack; the (i) explainer pins beside the label. */
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

	/* ── What this is ─────────────────────────────────────────────────────── */
	.hub-what {
		display: grid;
		gap: clamp(1.5rem, 4vw, 2.5rem);
	}
	@media (min-width: 1024px) {
		.hub-what {
			grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
			align-items: start;
		}
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

	:global(.pillar-grid) {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.pillar {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 1rem 1.1rem;
		background-color: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
		min-width: 0;
		/* Fill the grid cell so the three pillars read as one equal-height row. */
		height: 100%;
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

	/* ── Launchpad ────────────────────────────────────────────────────────── */
	.hub-launch {
		display: flex;
		flex-direction: column;
		gap: clamp(1.75rem, 4vw, 2.75rem);
	}
	.launch-group {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.launch-group-label {
		margin: 0;
	}
	/* Accountability (4 tiles) + Trust (2 tiles) sit side by side ≥1024 — the denser
	   secondary field that uses the horizontal real estate rather than a long stack.
	   Accountability takes ~2/3, trust ~1/3. Stacked < 1024. */
	.launch-secondary {
		display: grid;
		gap: clamp(1.75rem, 4vw, 2.5rem);
	}
	@media (min-width: 1024px) {
		.launch-secondary {
			grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
			align-items: start;
		}
	}
	:global(.launch-grid) {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	:global(.launch-grid) > li {
		min-width: 0;
	}

	/* Shared tile chrome (solid card, brand-border hover lift + section glow). */
	.hub-tile {
		width: 100%;
		height: 100%;
		display: flex;
		text-align: left;
		text-decoration: none;
		background-color: var(--card);
		color: var(--foreground);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-card);
		cursor: pointer;
		transition:
			border-color var(--duration-fast) var(--ease-default),
			transform var(--duration-fast) var(--ease-out),
			box-shadow var(--duration-fast) var(--ease-out);
	}
	.hub-tile:hover {
		border-color: var(--primary);
		transform: translateY(-2px);
		box-shadow: var(--shadow-section);
	}
	.hub-tile:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}

	/* FEATURE tiles — glyph-forward launcher cards for the primary destinations. */
	.hub-tile--feature {
		flex-direction: column;
		gap: 0.85rem;
		padding: 1.5rem 1.5rem 1.35rem;
		min-height: 11rem;
	}
	.hub-tile--feature .hub-tile-glyph {
		font-size: var(--text-display);
	}
	.hub-tile--feature .hub-tile-title {
		font-size: var(--text-heading);
	}
	.hub-tile--feature .hub-tile-cta {
		margin-top: auto;
	}

	/* COMPACT tiles — inline glyph + body + cta for the secondary field. */
	.hub-tile--compact {
		flex-direction: row;
		align-items: flex-start;
		gap: 0.85rem;
		padding: 1.1rem 1.25rem;
	}
	.hub-tile--compact .hub-tile-glyph {
		font-size: var(--text-heading);
		flex-shrink: 0;
	}
	.hub-tile--compact .hub-tile-cta {
		align-self: center;
		flex-shrink: 0;
	}

	/* Shared tile parts. The glyph rides the amber TEXT accent (station wayfinding) —
	   distinct from the reserved amber GROUND conversion CTA. */
	.hub-tile-glyph {
		font-family: var(--font-mono);
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
		color: var(--primary);
		white-space: nowrap;
	}

	@media (prefers-reduced-motion: reduce) {
		.hub-tile {
			transition: none;
		}
		.hub-tile:hover {
			transform: none;
		}
	}
</style>
