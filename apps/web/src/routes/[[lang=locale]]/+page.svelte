<!--
  Hub landing, the network entry surface.

  Renders inside the AppShell `main` zone (the root layout pipes the page tree
  here). Reads the active locale (context) + the booted v1 snapshot context, and
  presents the network's identity + freshness anchors plus the primary entry
  intents (network health, search, lines, stops). Navigation goes through
  $lib/nav `openSurface` so each tile resolves to a route-push (mobile) or a
  panel-swap (desktop) with zero caller awareness.

  Brand primitives only (SectionHeading / SectionLabel / MetricDisplay /
  StatusDot); tokens, no hex. The network-healthy dot rides the dataviz status
  scale (DATA), not --primary.
-->
<script lang="ts">
	import { getLocale, type Locale } from '$lib/i18n';
	import { getV1Context } from '$lib/v1';
	import { openSurface, type SurfaceTarget } from '$lib/nav';
	import { formatRelative } from '$lib/utils/time';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import StatusDot from '$lib/components/brand/StatusDot.svelte';
	import { Surface } from '$lib/components/layout';

	const locale: Locale = getLocale();
	const ctx = getV1Context();
	const manifest = $derived(ctx.manifest);

	// Live-tier build time is the freshest anchor; fall back to the static one.
	const generatedUtc = $derived(
		manifest.files.live?.generated_utc ?? manifest.files.static?.generated_utc ?? null,
	);
	const lastBuilt = $derived(generatedUtc ? formatRelative(generatedUtc, locale) : null);

	type CopyKey = 'kicker' | 'lede' | 'datasetLabel' | 'builtLabel' | 'builtUnknown' | 'enter';
	const T: Record<Locale, Record<CopyKey, string>> = {
		fr: {
			kicker: 'RÉSEAU EN DIRECT',
			lede: 'Ponctualité, achalandage et perturbations du réseau, mesurés à partir du contrat /v1. On n’invente jamais de données.',
			datasetLabel: 'Jeu de données',
			builtLabel: 'Dernière mise à jour',
			builtUnknown: 'inconnue',
			enter: 'Ouvrir',
		},
		en: {
			kicker: 'NETWORK · LIVE',
			lede: 'Network on-time performance, crowding and disruptions, measured from the /v1 contract. We never invent data.',
			datasetLabel: 'Dataset',
			builtLabel: 'Last updated',
			builtUnknown: 'unknown',
			enter: 'Open',
		},
	};
	const t = $derived(T[locale]);

	interface HubTile {
		readonly target: SurfaceTarget;
		readonly title: Record<Locale, string>;
		readonly desc: Record<Locale, string>;
		readonly glyph: string;
	}

	const TILES: readonly HubTile[] = [
		{
			target: { kind: 'network-health' },
			glyph: '◎',
			title: { fr: 'Santé du réseau', en: 'Network health' },
			desc: {
				fr: 'Vue d’ensemble de la ponctualité en direct.',
				en: 'Live network-wide on-time overview.',
			},
		},
		{
			target: { kind: 'search' },
			glyph: '⌕',
			title: { fr: 'Rechercher', en: 'Search' },
			desc: {
				fr: 'Trouver une ligne, un arrêt ou un véhicule.',
				en: 'Find a line, stop or vehicle.',
			},
		},
		{
			target: { kind: 'line' },
			glyph: '═',
			title: { fr: 'Lignes', en: 'Lines' },
			desc: {
				fr: 'Détail, horaire et fiabilité par ligne.',
				en: 'Per-line detail, schedule and reliability.',
			},
		},
		{
			target: { kind: 'stop' },
			glyph: '■',
			title: { fr: 'Arrêts', en: 'Stops' },
			desc: {
				fr: 'Prochains passages et fiabilité par arrêt.',
				en: 'Next departures and reliability per stop.',
			},
		},
	];
</script>

<Surface width="content" pad="hub" class="hub">
	<header class="hub-head">
		<SectionLabel text={t.kicker} variant="station" />
		<SectionHeading heading={manifest.display_name} level={1} dot />
		<p class="hub-lede">{t.lede}</p>

		<div class="hub-anchors">
			<MetricDisplay value={manifest.dataset_version} label={t.datasetLabel} size="sm" />
			<div class="hub-anchor-built">
				<SectionLabel text={t.builtLabel} variant="metric" />
				<span class="hub-built-value">
					<StatusDot color="on_time" pulse label="live" />
					{lastBuilt ?? t.builtUnknown}
				</span>
			</div>
		</div>
	</header>

	<ul class="hub-grid" aria-label={t.kicker}>
		{#each TILES as tile (tile.target.kind)}
			<li>
				<button type="button" class="hub-tile" onclick={() => openSurface(tile.target)}>
					<span class="hub-tile-glyph" aria-hidden="true">{tile.glyph}</span>
					<span class="hub-tile-body">
						<span class="hub-tile-title">{tile.title[locale]}</span>
						<span class="hub-tile-desc">{tile.desc[locale]}</span>
					</span>
					<span class="hub-tile-cta label-metric">{t.enter}</span>
				</button>
			</li>
		{/each}
	</ul>
</Surface>

<style>
	.hub-head {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-width: 60ch;
	}
	.hub-lede {
		color: var(--muted-foreground);
		font-size: var(--text-subheading);
		line-height: 1.6;
		max-width: 52ch;
	}
	.hub-anchors {
		display: flex;
		flex-wrap: wrap;
		gap: 2rem;
		margin-top: 0.5rem;
	}
	.hub-anchor-built {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.hub-built-value {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-subheading);
		color: var(--foreground);
	}

	.hub-grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 1rem;
		grid-template-columns: 1fr;
	}
	@media (min-width: 640px) {
		.hub-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	.hub-tile {
		width: 100%;
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		text-align: left;
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
