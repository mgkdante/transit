<!--
  _kit — the dev component gallery.

  A single surface that mounts EVERY design-system primitive (brand + ui +
  dataviz), all six EdgeStates, and the StatusBadge legend, with live lang (EN⇄FR)
  and theme (dark⇄light) toggles. Not linked from the app chrome — it is the
  visual contract sheet the design system is verified against.

  The lang toggle is LOCAL gallery state (passed explicitly to every lang/locale
  prop) so the page is self-contained regardless of the URL locale. The theme
  toggle drives the global themeStore so token swaps are observed app-wide.

  Doctrine: data marks ride the dataviz scale (sample values below use status/
  occupancy/severity codes + the heatmap ramp); --primary appears only on
  interactive affordances (buttons, the active tab marker, retry).
-->
<script lang="ts">
	import { DEFAULT_LOCALE, type Locale } from '$lib/i18n';
	import { themeStore } from '$lib/stores';
	import type { StatusCode, OccupancyCode } from '$lib/v1/schemas';
	import { STATUS_CODES, OCCUPANCY_CODES, SEVERITY_CODES } from '$lib/v1/schemas';

	// Brand primitives.
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import StopLabel from '$lib/components/brand/StopLabel.svelte';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import StatusDot from '$lib/components/brand/StatusDot.svelte';
	import ChevronToggle from '$lib/components/brand/ChevronToggle.svelte';
	import MetroStation from '$lib/components/brand/MetroStation.svelte';
	import CornerMarks from '$lib/components/brand/CornerMarks.svelte';

	// UI primitives.
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import {
		Card,
		CardHeader,
		CardTitle,
		CardDescription,
		CardContent,
	} from '$lib/components/ui/card';
	import { Tabs, TabsList, TabsTrigger, TabsContent } from '$lib/components/ui/tabs';

	// Dataviz kit.
	import {
		StatusBadge,
		Sparkline,
		TrendLine,
		Distribution,
		Heatmap,
		RankedRow,
		SeverityBar,
		StackedBar,
		ChartLegend,
		statusVar,
		STATUS_GLYPH,
		type ChartLegendItem,
	} from '$lib/components/dataviz';

	// Edge states.
	import { EdgeState } from '$lib/components/edge';

	// Chrome & layout (Set-B brand + layout primitives).
	import { TerminalChrome, StickyPanel } from '$lib/components/brand';
	import { Footer, Surface } from '$lib/components/layout';
	import { ResizablePaneGroup, ResizablePane, ResizableHandle } from '$lib/components/ui/resizable';

	// --- Gallery controls --------------------------------------------------------
	let lang = $state<Locale>(DEFAULT_LOCALE);
	const isDark = $derived(themeStore.isDark);

	function toggleLang() {
		lang = lang === 'en' ? 'fr' : 'en';
	}

	// --- Sample data (doctrine-clean) -------------------------------------------
	// STATUS_CODES / OCCUPANCY_CODES / SEVERITY_CODES come from the single source
	// ($lib/v1/schemas, derived from the zod enums) — imported above.

	const STATUS_LABEL: Record<StatusCode, Record<Locale, string>> = {
		early: { fr: 'En avance', en: 'Early' },
		on_time: { fr: 'À l’heure', en: 'On time' },
		late: { fr: 'En retard', en: 'Late' },
		severe: { fr: 'Sévère', en: 'Severe' },
		unknown: { fr: 'Inconnu', en: 'Unknown' },
	};
	const OCC_LABEL: Record<OccupancyCode, Record<Locale, string>> = {
		empty: { fr: 'Vide', en: 'Empty' },
		many_seats: { fr: 'Places assises', en: 'Many seats' },
		few_seats: { fr: 'Peu de places', en: 'Few seats' },
		standing: { fr: 'Debout', en: 'Standing' },
		full: { fr: 'Plein', en: 'Full' },
	};

	const sparkSeries: Array<number | null> = [82, 84, 80, null, 86, 88, 85, 90, 87, 91];
	const trendOnTime: Array<number | null> = [78, 80, 82, 81, 85, 86, 88];
	const trendRetard: Array<number | null> = [22, 20, 18, 19, 15, 14, 12];
	const distStats = { min: 0, p25: 2, p50: 4, p75: 7, max: 14 };

	// 7×24 heatmap of normalized delay; sprinkle nulls for the no-data token.
	const heatmapGrid: Array<Array<number | null>> = Array.from({ length: 7 }, (_, d) =>
		Array.from({ length: 24 }, (_, h) => {
			if ((d + h) % 11 === 0) return null;
			return Math.min(1, Math.max(0, Math.sin((h / 24) * Math.PI) * 0.9 - d * 0.04));
		}),
	);

	const stackedStatus = $derived(
		STATUS_CODES.map((code, i) => ({
			code,
			value: [4, 62, 20, 6, 8][i],
			label: STATUS_LABEL[code][lang],
		})),
	);
	const stackedOccupancy = $derived(
		OCCUPANCY_CODES.map((code, i) => ({
			code,
			value: [10, 30, 28, 22, 10][i],
			label: OCC_LABEL[code][lang],
		})),
	);

	// Standalone ChartLegend demo — the 5 status codes as glyph+colour swatches
	// on the dataviz scale (the same legend StackedBar/TrendLine compose).
	const legendStatusItems = $derived<ChartLegendItem[]>(
		STATUS_CODES.map((code) => ({
			colorVar: statusVar(code),
			label: STATUS_LABEL[code][lang],
			glyph: STATUS_GLYPH[code],
		})),
	);

	const EDGE_VARIANTS = [
		'skeleton',
		'stale-offline',
		'no-results',
		'empty',
		'empty-avis',
		'error-v1',
	] as const;

	const lastUpdated = new Date(Date.now() - 4 * 60 * 1000).toISOString();

	let chevronOpen = $state(false);
	let kitTab = $state('a');

	const T = $derived({
		title: lang === 'fr' ? 'Galerie de composants' : 'Component gallery',
		lede:
			lang === 'fr'
				? 'Chaque primitive marque/ui/dataviz, les six états limites et la légende de statut. Basculez la langue et le thème.'
				: 'Every brand/ui/dataviz primitive, the six edge states, and the status legend. Toggle language and theme.',
		langBtn: lang === 'fr' ? 'EN' : 'FR',
		themeBtn: isDark
			? lang === 'fr'
				? 'Thème clair'
				: 'Light theme'
			: lang === 'fr'
				? 'Thème sombre'
				: 'Dark theme',
	});
</script>

<div class="kit">
	<!-- Controls -->
	<div class="kit-bar">
		<div>
			<SectionLabel text="_KIT · DEV" variant="station" />
			<SectionHeading heading={T.title} level={1} dot />
			<p class="kit-lede">{T.lede}</p>
		</div>
		<div class="kit-controls">
			<Button variant="outline" size="sm" onclick={toggleLang}>{T.langBtn}</Button>
			<Button variant="outline" size="sm" onclick={() => themeStore.toggle()}>{T.themeBtn}</Button>
		</div>
	</div>

	<!-- BRAND -->
	<section class="kit-section">
		<SectionLabel text="BRAND" variant="section" />
		<div class="kit-row">
			<SectionHeading heading="Section heading" subheading="// SUBHEADING" level={3} />
			<SectionLabel text="SECTION" variant="section" />
			<SectionLabel text="STATION" variant="station" />
			<SectionLabel text="METRIC" variant="metric" />
			<StopLabel stop="01" label="Berri-UQAM" />
			<MetricDisplay value="82%" label={lang === 'fr' ? 'À l’heure' : 'On time'} sublabel="14j" />
			<MetricDisplay value="4 min" label={lang === 'fr' ? 'Retard moyen' : 'Avg delay'} size="lg" />
			<button type="button" class="kit-chevron" onclick={() => (chevronOpen = !chevronOpen)}>
				<ChevronToggle open={chevronOpen} direction="right" />
				<span>{chevronOpen ? 'open' : 'closed'}</span>
			</button>
			<div class="kit-metro">
				<MetroStation index={1} showLine />
				<MetroStation index={2} pulseDelay={0.2} />
			</div>
			<div class="kit-cornermarks"><CornerMarks size="md" /><span>corner marks</span></div>
		</div>
		<div class="kit-row">
			{#each STATUS_CODES as code (code)}
				<span class="kit-dot">
					<StatusDot color={code} label={STATUS_LABEL[code][lang]} />
					<span>{STATUS_LABEL[code][lang]}</span>
				</span>
			{/each}
			<span class="kit-dot"
				><StatusDot color="orange" pulse label="accent" /><span>accent (pulse)</span></span
			>
		</div>
	</section>

	<!-- UI -->
	<section class="kit-section">
		<SectionLabel text="UI" variant="section" />
		<div class="kit-row">
			<Button variant="default">Default</Button>
			<Button variant="secondary">Secondary</Button>
			<Button variant="outline">Outline</Button>
			<Button variant="ghost">Ghost</Button>
			<Button variant="destructive">Destructive</Button>
			<Button variant="link">Link</Button>
		</div>
		<div class="kit-row">
			<Badge variant="default">Default</Badge>
			<Badge variant="secondary">Secondary</Badge>
			<Badge variant="outline">Outline</Badge>
			<Badge variant="tag">Tag</Badge>
			<Badge variant="tag-active">Tag active</Badge>
			<Badge variant="number">3</Badge>
		</div>
		<div class="kit-stack">
			<Separator variant="default" />
			<Separator variant="gradient" />
			<Separator variant="hazard" />
		</div>
		<div class="kit-row">
			<Card class="max-w-xs">
				<CardHeader>
					<CardTitle>{lang === 'fr' ? 'Carte' : 'Card'}</CardTitle>
					<CardDescription
						>{lang === 'fr'
							? 'Surface solide, ombre carte.'
							: 'Solid surface, card shadow.'}</CardDescription
					>
				</CardHeader>
				<CardContent>
					<MetricDisplay
						value="91%"
						label={lang === 'fr' ? 'Fiabilité' : 'Reliability'}
						size="sm"
					/>
				</CardContent>
			</Card>
			<div class="kit-tabs-demo">
				<Tabs bind:value={kitTab}>
					<TabsList variant="line">
						<TabsTrigger value="a">{lang === 'fr' ? 'Onglet A' : 'Tab A'}</TabsTrigger>
						<TabsTrigger value="b">{lang === 'fr' ? 'Onglet B' : 'Tab B'}</TabsTrigger>
					</TabsList>
					<TabsContent value="a">{lang === 'fr' ? 'Contenu A' : 'Content A'}</TabsContent>
					<TabsContent value="b">{lang === 'fr' ? 'Contenu B' : 'Content B'}</TabsContent>
				</Tabs>
			</div>
		</div>
	</section>

	<!-- DATAVIZ -->
	<section class="kit-section">
		<SectionLabel text="DATAVIZ" variant="section" />

		<!-- StatusBadge legend (all 5 codes, three modes) -->
		<div class="kit-sub">
			<SectionLabel text={lang === 'fr' ? 'LÉGENDE STATUT' : 'STATUS LEGEND'} variant="metric" />
			<div class="kit-row">
				{#each STATUS_CODES as code (code)}
					<StatusBadge
						status={code}
						mode="legend"
						label={`${STATUS_GLYPH[code]} ${STATUS_LABEL[code][lang]}`}
					/>
				{/each}
			</div>
			<div class="kit-row">
				{#each STATUS_CODES as code (code)}
					<StatusBadge status={code} mode="pill" label={STATUS_LABEL[code][lang]} />
				{/each}
				{#each STATUS_CODES as code (code)}
					<StatusBadge status={code} mode="dot" label={STATUS_LABEL[code][lang]} />
				{/each}
			</div>
		</div>

		<div class="kit-grid2">
			<div class="kit-card">
				<SectionLabel text="SPARKLINE" variant="metric" />
				<Sparkline
					values={sparkSeries}
					width={220}
					height={48}
					label="On-time % · 10 builds"
					colorVar={statusVar('on_time')}
					yAxis={{ label: lang === 'fr' ? 'À l’heure %' : 'On-time %', unit: '%' }}
					xLabels={sparkSeries.map((_, i) => `#${i + 1}`)}
					showYTicks
					interactive
				/>
			</div>
			<div class="kit-card">
				<SectionLabel text="TRENDLINE" variant="metric" />
				<TrendLine
					onTime={trendOnTime}
					retard={trendRetard}
					onTimeLabel={lang === 'fr' ? 'À l’heure %' : 'On-time %'}
					retardLabel={lang === 'fr' ? 'Retard %' : 'Delayed %'}
					xLabels={trendOnTime.map((_, i) => (lang === 'fr' ? `J${i + 1}` : `D${i + 1}`))}
					yAxis={{
						label: lang === 'fr' ? 'À l’heure %' : 'On-time %',
						unit: '%',
						domain: [0, 100],
					}}
					retardAxis={{
						label: lang === 'fr' ? 'Retard %' : 'Delayed %',
						unit: '%',
						domain: [0, 100],
					}}
					showYTicks
					showXTicks
					label="7-day trend"
					interactive
				/>
			</div>
			<div class="kit-card">
				<SectionLabel text="DISTRIBUTION" variant="metric" />
				<Distribution
					stats={distStats}
					domain={[0, 14]}
					unit="min"
					label={lang === 'fr' ? 'Retard' : 'Delay'}
					fillVar={statusVar('late')}
					showAxis
					axisLabel={lang === 'fr' ? 'Retard (min)' : 'Delay (min)'}
					interactive
				/>
			</div>
			<div class="kit-card">
				<SectionLabel text="STACKED · STATUS" variant="metric" />
				<StackedBar
					scale="status"
					segments={stackedStatus}
					interactive
					legend
					label={lang === 'fr' ? 'Répartition statut' : 'Status mix'}
				/>
			</div>
			<div class="kit-card">
				<SectionLabel text="STACKED · OCCUPANCY" variant="metric" />
				<StackedBar
					scale="occupancy"
					segments={stackedOccupancy}
					interactive
					legend
					label={lang === 'fr' ? 'Achalandage' : 'Occupancy'}
				/>
			</div>
			<div class="kit-card">
				<SectionLabel text="SEVERITY BARS" variant="metric" />
				<div class="kit-stack">
					{#each SEVERITY_CODES as sev, i (sev)}
						<SeverityBar severity={sev} value={[0.95, 0.6, 0.3][i]} label={`${sev}`} interactive />
					{/each}
					<SeverityBar severity="watch" value={null} label="no data" interactive />
				</div>
			</div>
			<div class="kit-card kit-card-wide">
				<SectionLabel text="HEATMAP · 7×24" variant="metric" />
				<Heatmap
					grid={heatmapGrid}
					label={lang === 'fr' ? 'Carte de chaleur des retards' : 'Delay heatmap'}
					interactive
				/>
			</div>
			<div class="kit-card kit-card-wide">
				<SectionLabel text="RANKED ROWS" variant="metric" />
				<div class="kit-stack">
					<RankedRow
						rank={1}
						title="Ligne 51"
						subtitle="Édouard-Montpetit"
						severity="critical"
						value={0.92}
						display="12.4 min"
						delta={2.1}
						deltaDisplay="+2.1"
					/>
					<RankedRow
						rank={2}
						title="Ligne 24"
						subtitle="Sherbrooke"
						severity="high"
						value={0.64}
						display="8.0 min"
						delta={-1.3}
						deltaDisplay="-1.3"
					/>
					<RankedRow
						rank={3}
						title="Ligne 105"
						subtitle="Sherbrooke O."
						severity="watch"
						value={null}
						display="—"
						delta={null}
					/>
				</div>
			</div>
		</div>
	</section>

	<!-- EDGE STATES -->
	<section class="kit-section">
		<SectionLabel text={lang === 'fr' ? 'ÉTATS LIMITES' : 'EDGE STATES'} variant="section" />
		<div class="kit-grid2">
			{#each EDGE_VARIANTS as variant (variant)}
				<div class="kit-card">
					<SectionLabel text={variant} variant="metric" />
					<EdgeState
						{variant}
						{lang}
						layout="mobile"
						lastUpdated={variant === 'stale-offline' ? lastUpdated : undefined}
						onRetry={variant === 'error-v1' ? () => {} : undefined}
					/>
				</div>
			{/each}
		</div>
	</section>

	<section class="kit-section">
		<SectionLabel
			text={lang === 'fr' ? 'CHROME & DISPOSITION' : 'CHROME & LAYOUT'}
			variant="section"
		/>
		<div class="kit-grid2">
			<TerminalChrome
				title="receipt.log"
				tag="STM"
				status="live"
				footer={[
					{ label: 'rows', value: '128' },
					{ label: 'ms', value: '42' },
				]}
			>
				<pre class="kit-term">route 165 — on_time 0.82
stop 51234 — next 3 min
vehicle 40231 — occupancy LOW</pre>
			</TerminalChrome>

			<StickyPanel top="1rem">
				<SectionLabel text="STICKY" variant="metric" />
				<p class="kit-lede">
					{lang === 'fr' ? 'Panneau en position sticky.' : 'position: sticky panel.'}
				</p>
			</StickyPanel>

			<div class="kit-resizable-demo kit-card-wide">
				<ResizablePaneGroup direction="horizontal">
					<ResizablePane defaultSize={55}>
						<div class="kit-pane">{lang === 'fr' ? 'Carte' : 'Map'}</div>
					</ResizablePane>
					<ResizableHandle withHandle />
					<ResizablePane defaultSize={45}>
						<div class="kit-pane">{lang === 'fr' ? 'Détail' : 'Detail'}</div>
					</ResizablePane>
				</ResizablePaneGroup>
			</div>

			<!-- Surface widths + hazard separator + standalone ChartLegend. -->
			<div class="kit-card kit-card-wide">
				<SectionLabel
					text={lang === 'fr' ? 'SURFACE · LARGEURS' : 'SURFACE · WIDTHS'}
					variant="metric"
				/>
				<div class="kit-stack">
					<Surface width="content" pad="none" gutter={false} class="kit-surface-demo">
						<span class="kit-surface-label">content — var(--container-content)</span>
					</Surface>
					<Surface width="wide" pad="none" gutter={false} class="kit-surface-demo">
						<span class="kit-surface-label">wide — var(--container-wide)</span>
					</Surface>
					<Surface width="bleed" pad="none" gutter={false} class="kit-surface-demo">
						<span class="kit-surface-label"
							>{lang === 'fr' ? 'bleed — pleine largeur' : 'bleed — edge-to-edge'}</span
						>
					</Surface>
				</div>

				<SectionLabel
					text={lang === 'fr' ? 'SÉPARATEUR · HASARD' : 'SEPARATOR · HAZARD'}
					variant="metric"
				/>
				<Separator variant="hazard" />

				<SectionLabel
					text={lang === 'fr' ? 'LÉGENDE GRAPHIQUE' : 'CHART LEGEND'}
					variant="metric"
				/>
				<ChartLegend items={legendStatusItems} />
			</div>
		</div>
	</section>

	<Footer />
</div>

<style>
	.kit {
		max-width: var(--width-content);
		margin-inline: auto;
		padding: clamp(1.5rem, 4vw, 3rem) var(--space-page-x, 1.5rem);
		display: flex;
		flex-direction: column;
		gap: clamp(2rem, 4vw, 3rem);
	}
	.kit-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}
	.kit-lede {
		color: var(--muted-foreground);
		font-size: var(--text-small);
		max-width: 52ch;
		margin-top: 0.5rem;
	}
	.kit-controls {
		display: flex;
		gap: 0.5rem;
	}
	.kit-section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}
	.kit-sub {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.kit-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}
	.kit-stack {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.kit-dot {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	.kit-chevron,
	.kit-cornermarks {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: var(--text-small);
		color: var(--muted-foreground);
		background: none;
		border: none;
		cursor: pointer;
	}
	.kit-cornermarks {
		position: relative;
		padding: 0.75rem;
	}
	.kit-metro {
		display: flex;
		gap: 0.5rem;
	}
	.kit-grid2 {
		display: grid;
		gap: 1rem;
		grid-template-columns: 1fr;
	}
	@media (min-width: 768px) {
		.kit-grid2 {
			grid-template-columns: repeat(2, 1fr);
		}
		.kit-card-wide {
			grid-column: 1 / -1;
		}
	}
	.kit-card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
		background-color: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg, 0.75rem);
		box-shadow: var(--shadow-card);
		overflow: hidden;
	}
	.kit-tabs-demo {
		min-width: 16rem;
	}
	.kit-term {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--secondary-foreground);
		white-space: pre-wrap;
	}
	.kit-resizable-demo {
		height: 9rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}
	.kit-pane {
		display: grid;
		place-items: center;
		height: 100%;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	:global(.kit-surface-demo) {
		padding: 0.5rem 0.75rem;
		background-color: var(--muted);
		border: 1px dashed var(--border);
		border-radius: var(--radius-md);
	}
	.kit-surface-label {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
	}
</style>
