<!--
  Hub landing, the network entry surface.

  Renders inside the AppShell `main` zone (the root layout pipes the page tree
  here). Reads the active locale (context) + the booted v1 snapshot context, and
  presents the project at a glance in three movements:

    1. CONTROL-ROOM HERO — the provider identity (display_name) framed in
       TerminalChrome, with a LIVE PULSE of the network right now. The pulse
       reads the same live network.json the /network surface does, via
       createLiveStore (on-time %, vehicles in service, not-reporting count,
       coverage %). HONESTY: before the first client tick (and during SSR) the
       store is null, so every headline stands down to the localized "no data"
       glyph — never a fabricated 0. The LiveFreshness chip + a pulsing StatusDot
       carry the "right now" verdict on the dataviz status scale (not --primary).

    2. WHAT THIS IS — one tight bilingual paragraph + three honesty pillars
       (Live / Honest / Accountable) so a first-time visitor instantly grasps the
       whole project: an independent, honesty-first citizen-analytics dashboard
       derived from the live GTFS-realtime feed, a measured PROXY (not certified
       OTP), where null always means "no data". Provider-agnostic: the copy
       templates on short_name / city / display_name from the manifest, never a
       hardcoded agency or place.

    3. EXPLORE EVERYTHING — ALL ~10 surfaces as organized entry points, GROUPED
       (Explore / Accountability / Trust) so the project's full scope is obvious
       and people find themselves easily. Each entry is a focusable tile with a
       glyph, a bilingual title and a one-line description. Primary surfaces route
       through $lib/nav `openSurface` (route-push on mobile, panel-swap on
       desktop); reference surfaces are localized <a> links.

  Brand primitives + tokens only (no hex). The live/healthy dots ride the dataviz
  status scale (DATA), never --primary; --primary stays interactive-only (tile
  hover/focus). Responsive: the page is a centered Surface and every board is a
  DashboardGrid (auto-fit minmax(min(N,100%),1fr)) so it fits and centers without
  overflow at 360px.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { getLocale, localizeHref, type Locale } from '$lib/i18n';
	import { getV1Context, createLiveStore } from '$lib/v1';
	import { openSurface, type SurfaceTarget } from '$lib/nav';
	import { formatRelative } from '$lib/utils/time';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import StatusDot from '$lib/components/brand/StatusDot.svelte';
	import TerminalChrome from '$lib/components/brand/TerminalChrome.svelte';
	import { LiveFreshness } from '$lib/components/surface';
	import { Surface, DashboardGrid } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';

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
	const lastBuilt = generatedUtc ? formatRelative(generatedUtc, locale) : null;

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

	/** Nullable percent → "82%" or the honest no-data glyph (never a fake 0). */
	function fmtPct(v: number | null | undefined): string {
		return v == null ? T[locale].noData : `${v}${T[locale].pct}`;
	}
	/** A required count → localized integer, or the no-data glyph before first tick. */
	function fmtCount(v: number | null | undefined): string {
		return v == null ? T[locale].noData : v.toLocaleString(locale === 'fr' ? 'fr-CA' : 'en-CA');
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

<Surface width="wide" pad="hub" class="hub">
	<!-- 1. CONTROL-ROOM HERO ------------------------------------------------- -->
	<header class="hub-head">
		<SectionLabel text={t.kicker} variant="station" />
		<SectionHeading heading={manifest.display_name} level={1} dot />
		<p class="hub-tagline">{t.tagline}</p>
	</header>

	<TerminalChrome
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
			<LiveFreshness
				generatedUtc={live.generatedUtc}
				ageSeconds={live.ageSeconds}
				isStale={live.isStale}
				{locale}
			/>
		</div>

		<DashboardGrid
			as="ul"
			minTile="160px"
			maxWidth="none"
			gutter={false}
			class="pulse-grid"
			aria-label={t.pulseLabel}
		>
			<li><MetricDisplay value={fmtPct(net?.on_time_pct)} label={t.metricOnTime} size="lg" /></li>
			<li>
				<MetricDisplay
					value={fmtCount(net?.vehicles_in_service)}
					label={t.metricVehicles}
					size="lg"
				/>
			</li>
			<li>
				<MetricDisplay value={fmtCount(net?.non_responding)} label={t.metricSilent} size="lg" />
			</li>
			<li>
				<MetricDisplay value={fmtPct(net?.coverage_pct)} label={t.metricCoverage} size="lg" />
			</li>
		</DashboardGrid>
	</TerminalChrome>

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

	<!-- 3. EXPLORE EVERYTHING ------------------------------------------------- -->
	<nav class="hub-explore" aria-label={t.exploreNav}>
		{#each GROUPS as group (group.key)}
			<section class="explore-group" aria-labelledby={`group-${group.key}`}>
				<h2 class="explore-group-label" id={`group-${group.key}`}>
					<SectionLabel text={group.label()} variant="station" />
				</h2>
				<DashboardGrid as="ul" minTile="240px" maxWidth="none" gutter={false} class="explore-grid">
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
				</DashboardGrid>
			</section>
		{/each}
	</nav>
</Surface>

{#snippet tileBody(glyph: string, title: string, desc: string)}
	<span class="hub-tile-glyph" aria-hidden="true">{glyph}</span>
	<span class="hub-tile-body">
		<span class="hub-tile-title">{title}</span>
		<span class="hub-tile-desc">{desc}</span>
	</span>
	<span class="hub-tile-cta label-metric" aria-hidden="true">{t.enter}</span>
{/snippet}

<style>
	/* ── Hero ─────────────────────────────────────────────────────────────── */
	.hub-head {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		max-width: 62ch;
	}
	.hub-tagline {
		color: var(--muted-foreground);
		font-size: var(--text-subheading);
		line-height: 1.6;
		max-width: 56ch;
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
		gap: 0.55rem;
	}
	:global(.pulse-grid) {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	:global(.pulse-grid) > li {
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
		transition: border-color 150ms ease;
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
		gap: 0.4rem;
		padding: 1rem 1.1rem;
		background-color: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg, 0.75rem);
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

	/* ── Explore everything ───────────────────────────────────────────────── */
	.hub-explore {
		display: flex;
		flex-direction: column;
		gap: clamp(1.75rem, 4vw, 2.5rem);
	}
	.explore-group {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.explore-group-label {
		margin: 0;
	}
	:global(.explore-grid) {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	:global(.explore-grid) > li {
		min-width: 0;
	}

	.hub-tile {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		text-align: left;
		text-decoration: none;
		padding: 1.25rem 1.5rem;
		background-color: var(--card);
		color: var(--foreground);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg, 0.75rem);
		box-shadow: var(--shadow-card);
		cursor: pointer;
		transition:
			border-color 150ms ease,
			transform 150ms ease;
	}
	.hub-tile:hover {
		border-color: var(--primary);
		transform: translateY(-2px);
	}
	.hub-tile:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 2px;
	}
	.hub-tile-glyph {
		font-family: var(--font-mono);
		font-size: var(--text-heading);
		line-height: 1;
		color: var(--accent-text);
		flex-shrink: 0;
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
	}
	.hub-tile-desc {
		color: var(--muted-foreground);
		font-size: var(--text-small);
		line-height: 1.5;
	}
	.hub-tile-cta {
		flex-shrink: 0;
		align-self: center;
		color: var(--primary);
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
