<!--
  HotspotsBoard — the /hotspots accountability surface (slice-9.6, Family D).

  The network's worst spots, ranked worst-first: the historic hotspots roll-up
  (getHotspots → /v1 historic/hotspots.json) carries a pre-ranked list of cells,
  each a route or a stop with an on-time-points delta vs the network baseline and
  a free-string severity. We render them as the dataviz RankedRow worst-first
  list (severity-banded magnitude bar), wrapping each row in a localized deep
  link to its route/stop detail where the type resolves to one.

  Composes the surface spine: createResource(getHotspots) → ResourceBoundary for
  skeleton / error / empty, SurfaceHeader for the head, RankedRow (dataviz) for
  the ranked entries. Reads locale via getLocale(); all copy is co-located in
  hotspots.copy.ts.

  DOCTRINE: the magnitude bar rides the dataviz severity scale (RankedRow owns
  that); --primary stays interactive-only (the row link's focus ring). Honesty —
  an empty/absent hotspots array shows the localized empty state (never a
  fabricated row); a null otp_delta_pts reads the localized no-data string and a
  null-magnitude (no-data) bar (never a fake 0); a free-string severity bands to
  the SHARED reliability vocabulary and falls to the quietest 'watch' when
  unknown (an unrecognized label never paints as a hot 'critical'). Tokens only,
  no hex.
-->
<script lang="ts">
	import { getLocale, localizeHref, type Locale } from '$lib/i18n';
	import { routeFor, type SurfaceKind, type SurfaceTarget } from '$lib/nav';
	import { getHotspots } from '$lib/v1';
	import type { Hotspot, SeverityCode } from '$lib/v1/schemas';
	import { createResource } from '$lib/v1/resource.svelte';
	import { ResourceBoundary, SurfaceHeader, FreshnessStamp } from '$lib/components/surface';
	import { Surface, DashboardGrid } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';
	import { RankedRow } from '$lib/components/dataviz';
	import { AbsentValue } from '$lib/components/edge';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import { copy as COPY } from './hotspots.copy';

	const locale: Locale = getLocale();
	const t = $derived(COPY[locale]);

	// The metric-explainer (i) affordance: a one-line tip + a localized deep link
	// to /metrics#<anchor>, wired onto the ranked-list heading so the OTP-points
	// delta column has its honest definition (same wiring as RouteDetail).
	const explainerCopy = $derived(metricsCopy[locale]);
	function buildInfo(key: MetricKey, name: string) {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	}
	// The (i) on the ranked-list heading explains the OTP-points delta column.
	const headingInfo = $derived(buildInfo('otp', t.heading));

	// `freshness: true` feeds the payload's generated_utc into the shared site-wide
	// newest-data timestamp (latest-wins/monotonic), with no per-page age math.
	const hotspots = createResource(() => getHotspots(), { freshness: true });

	// Freshness off the roll-up's generated_utc (a daily rebuild, not live). The
	// "Updated N ago" stamp computes its server-anchored, shared-tick age centrally
	// (FreshnessStamp variant="updated") — no per-page age math here.
	const generatedUtc = $derived(hotspots.data?.generated_utc ?? null);

	// The pipeline owns the `type` discriminator as a free string. We map the two
	// known cell kinds to their nav SurfaceKind so a row can deep-link to its
	// detail page; an unknown type maps to nothing (a plain, non-linked row).
	function navKindFor(type: string): SurfaceKind | null {
		const k = type.toLowerCase();
		if (k === 'route' || k === 'line') return 'line';
		if (k === 'stop') return 'stop';
		return null;
	}

	// Localized mode-tag chip (Line / Stop) for a known type; null for an unknown
	// type (no fabricated label).
	function typeTag(type: string): string | null {
		const kind = navKindFor(type);
		if (kind === 'line') return t.type.route;
		if (kind === 'stop') return t.type.stop;
		return null;
	}

	// Band the pipeline's free-string severity onto the closed dataviz SeverityCode
	// scale. We recognize the alert severity vocabulary (critical/high/watch) plus
	// the delay-band synonym 'severe' (→ critical) the pipeline also emits. An
	// unrecognized OR absent label bands to the quietest 'watch' so a row never
	// paints as a hot 'critical' on a guess (honesty).
	function bandSeverity(severity: string | null | undefined): SeverityCode {
		switch ((severity ?? '').toLowerCase()) {
			case 'critical':
			case 'severe':
				return 'critical';
			case 'high':
				return 'high';
			default:
				return 'watch';
		}
	}

	// Format a non-null OTP-points delta as "−3.2 pts" (the points of on-time the
	// spot has lost vs baseline). The roll-up may emit the delta as a negative
	// (points below baseline) or a positive magnitude; we read its absolute size for
	// the human "points lost" reading and let the magnitude bar carry the relative
	// scale. A NULL delta returns undefined so the row OMITS its display value
	// entirely (RankedRow only renders {#if display}) — the all-null delta column
	// disappears rather than reading a permanent "no data" string.
	function fmtDelta(pts: number | null | undefined): string | undefined {
		if (pts == null) return undefined;
		const mag = Math.abs(pts);
		return t.deltaLost(`${mag.toFixed(1)}`);
	}

	// Localized severity-band word for the no-magnitude hint (the ranked, REAL
	// signal). Mirrors the closed dataviz SeverityCode scale bandSeverity bands to.
	function bandWord(code: SeverityCode): string {
		return t.bands[code];
	}

	type HotspotRow = {
		readonly key: string;
		readonly rank: number;
		readonly title: string;
		readonly subtitle: string;
		readonly severity: SeverityCode;
		readonly value: number | null;
		readonly display: string | undefined;
		readonly href: string | null;
		readonly ariaLabel: string;
		/** The localized severity-band word, shown in place of the bar when a row
		 * carries no magnitude (severity is the real, ranked signal). */
		readonly band: string;
	};

	// The view-model: keep the pipeline's published rank ORDER (worst-first is the
	// roll-up's job — we never re-sort or invent rows). The magnitude bar is the
	// per-row OTP-points delta normalized against the WORST (largest) delta in the
	// set, so the worst spot fills the bar and the rest read relative to it; a row
	// with a null delta carries a null (no-data) bar — never a fabricated 0. Each
	// known route/stop type resolves to a localized deep link; an unknown type
	// renders a plain, non-linked row.
	const rows = $derived.by<HotspotRow[]>(() => {
		const list: Hotspot[] = hotspots.data?.hotspots ?? [];
		// Worst (largest-magnitude) delta across the set, for the [0,1] normalization.
		const worst = list.reduce<number>(
			(m, h) => (h.otp_delta_pts != null ? Math.max(m, Math.abs(h.otp_delta_pts)) : m),
			0,
		);
		return list.map((h) => {
			const kind = navKindFor(h.type);
			const target: SurfaceTarget | null = kind ? { kind, id: h.id } : null;
			const title = h.name ?? t.unnamed(h.id);
			const tag = typeTag(h.type);
			const delta = h.otp_delta_pts ?? null;
			const band = bandSeverity(h.severity);
			return {
				key: `${h.rank}-${h.type}-${h.id}`,
				rank: h.rank,
				title,
				// Subtitle names the cell kind + its id (a stable secondary line).
				subtitle: tag ? `${tag} · ${h.id}` : h.id,
				severity: band,
				value: delta != null && worst > 0 ? Math.min(1, Math.abs(delta) / worst) : null,
				display: fmtDelta(delta),
				href: target ? localizeHref(routeFor(target), locale) : null,
				ariaLabel: t.viewDetail(title),
				band: bandWord(band),
			};
		});
	});

	// HONESTY: when the WHOLE magnitude column is null (the live state the operator
	// flagged — every otp_delta_pts is absent, so every bar would render an empty
	// track and the board reads broken), we don't paint a single magnitude bar.
	// Instead the heading carries the localized "magnitude unavailable" note and
	// each row falls back to its REAL severity-band hint. A per-cell null in a
	// MIXED list (some magnitudes present) likewise drops just that row's bar. The
	// rank + name + severity + worst-first order stay fully rendered either way.
	const anyMagnitude = $derived(rows.some((r) => r.value != null));
	const caption = $derived(anyMagnitude ? t.rowCaption : t.magnitudeUnavailable);
</script>

<!-- One ranked entry. A row WITH a magnitude rides the dataviz RankedRow (its
     severity-banded bar). A row with NO magnitude (null delta) drops the bar
     entirely — an empty track reads as broken — and shows its REAL severity-band
     hint instead, keeping rank + name + the worst-first order intact (honesty). -->
{#snippet rowContent(row: HotspotRow)}
	{#if row.value != null}
		<RankedRow
			bare
			rank={row.rank}
			title={row.title}
			subtitle={row.subtitle}
			severity={row.severity}
			value={row.value}
			display={row.display}
		/>
	{:else}
		<div class="hotspots-band-row" data-slot="hotspot-band-row" data-severity={row.severity}>
			<span class="hotspots-band-rank" aria-hidden="true">{row.rank}</span>
			<div class="hotspots-band-body">
				<span class="hotspots-band-title">{row.title}</span>
				<span class="hotspots-band-subtitle">{row.subtitle}</span>
			</div>
			<span class="hotspots-band-chip" data-slot="hotspot-band-chip"
				>{t.severityHint(row.band)}</span
			>
		</div>
	{/if}
{/snippet}

<Surface width="bleed" class="hotspots">
	<SurfaceHeader kicker={t.kicker} heading={t.heading} subheading={t.subheading} lede={t.lede}>
		<FreshnessStamp variant="updated" {generatedUtc} {locale} />
	</SurfaceHeader>

	<Separator variant="hazard" />

	<!-- The boundary gates skeleton / error / (no-file) empty. A PUBLISHED file with
	     an empty hotspots array is a legitimate "nothing is a hotspot right now"
	     reading, so we render that honest, surface-specific empty note inside the
	     children rather than the generic edge-empty (mirrors StopsIndex). -->
	<ResourceBoundary resource={hotspots} lang={locale}>
		{#if rows.length === 0}
			<!-- A published file with an empty hotspots array is a legitimate "nothing
			     is a hotspot right now" reading of an aggregate roll-up. The styled
			     honest-absence block says it clearly (No data · not enough readings yet)
			     rather than a plain, easy-to-miss note. -->
			<div class="hotspots-note" data-slot="hotspots-empty">
				<AbsentValue variant="block" reason="no-observations" {locale} />
			</div>
		{:else}
			<div class="hotspots-body">
				<span class="hotspots-section">
					<SectionLabel text={t.heading} variant="station" />
					<MetricInfo
						tip={headingInfo.tip}
						href={headingInfo.href}
						label={headingInfo.label}
						linkLabel={headingInfo.linkLabel}
						side="bottom"
					/>
				</span>
				<p class="hotspots-caption" data-slot="hotspots-caption">{caption}</p>
				<!-- The ranked list rides the SHARED DashboardGrid auto-fit recipe as a
				     semantic <ul> (worst-first published order honoured left-to-right then
				     down by the grid), so the list>listitem>link a11y survives and the
				     grid-track recipe lives ONLY in DashboardGrid. -->
				<DashboardGrid
					as="ul"
					minTile="360px"
					gutter={false}
					class="hotspots-ranked"
					aria-label={t.listLabel}
				>
					{#each rows as row (row.key)}
						<!-- list > listitem > link: the <li> owns the listitem semantics so AT
						     can count the rows; the inner RankedRow is `bare` (no self role) and
						     the anchor (when present) owns the interactivity + accessible name. -->
						<li class="hotspots-item">
							{#if row.href}
								<!-- A known route/stop cell deep-links to its detail page. -->
								<a
									class="hotspots-link"
									href={row.href}
									data-sveltekit-preload-data="hover"
									aria-label={row.ariaLabel}
									data-testid="hotspot-link"
								>
									{@render rowContent(row)}
								</a>
							{:else}
								{@render rowContent(row)}
							{/if}
						</li>
					{/each}
				</DashboardGrid>
				<!-- Honest caveat: a trailing-window ranking, not a certified league table. -->
				<p class="hotspots-caveat" data-slot="hotspots-caveat">{t.caveat}</p>
			</div>
		{/if}
	</ResourceBoundary>
</Surface>

<style>
	.hotspots-body {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	/* Section heading + its (i) explainer share a baseline-aligned inline row. */
	.hotspots-section {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}
	/* The ranked list rides the SHARED DashboardGrid auto-fit recipe (rendered as a
	   semantic <ul> via `as="ul"`); the grid-track recipe + minTile live in
	   DashboardGrid. Here we only widen the measure so the board uses the desktop
	   real estate instead of a single narrow column. */
	:global(.dashboard-grid.hotspots-ranked) {
		max-width: 76rem;
	}
	.hotspots-item {
		display: block;
	}
	/* The row link is a block wrapper, it carries the focus ring (--primary,
	   interactive-only) and lets the RankedRow keep its own card chrome. */
	.hotspots-link {
		display: block;
		border-radius: var(--radius-lg);
		text-decoration: none;
		color: inherit;
	}
	.hotspots-link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.hotspots-caption,
	.hotspots-caveat {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.hotspots-caveat {
		max-width: 52ch;
	}
	/* The honest empty state wraps the styled AbsentValue block (which carries its
	   own centered chrome); the container only centers it within the surface. */
	.hotspots-note {
		display: flex;
		justify-content: center;
		padding: 0.5rem 0;
	}
	/* No-magnitude row: the RankedRow card shape WITHOUT the bar (an empty track
	   reads broken). The leading severity rail + the band chip carry the REAL,
	   ranked signal; chrome only on the dataviz severity scale, never --primary. */
	.hotspots-band-row {
		--band-tone: var(--dataviz-severity-watch);
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 0.75rem;
		position: relative;
		overflow: hidden;
		padding: 0.55rem 0.75rem 0.55rem 0.9rem;
		border: 1px solid color-mix(in srgb, var(--band-tone) 28%, var(--border) 72%);
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--band-tone) 7%, var(--card));
	}
	.hotspots-band-row::before {
		content: '';
		position: absolute;
		inset-block: 0;
		inset-inline-start: 0;
		width: 3px;
		background: var(--band-tone);
	}
	.hotspots-band-row[data-severity='critical'] {
		--band-tone: var(--dataviz-severity-critical);
	}
	.hotspots-band-row[data-severity='high'] {
		--band-tone: var(--dataviz-severity-high);
	}
	.hotspots-band-row[data-severity='watch'] {
		--band-tone: var(--dataviz-severity-watch);
	}
	.hotspots-band-rank {
		width: 1.5rem;
		text-align: right;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
	}
	.hotspots-band-body {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.hotspots-band-title {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
		color: var(--foreground);
	}
	.hotspots-band-subtitle {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--text-caption);
		color: var(--muted-foreground);
	}
	.hotspots-band-chip {
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 500;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: color-mix(in srgb, var(--band-tone) 75%, var(--foreground));
	}
</style>
