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
	import { ResourceBoundary, SurfaceHeader } from '$lib/components/surface';
	import { Surface } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';
	import { RankedRow } from '$lib/components/dataviz';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import { copy as COPY } from './hotspots.copy';

	const locale: Locale = getLocale();
	const t = $derived(COPY[locale]);

	const hotspots = createResource(() => getHotspots());

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
			return {
				key: `${h.rank}-${h.type}-${h.id}`,
				rank: h.rank,
				title,
				// Subtitle names the cell kind + its id (a stable secondary line).
				subtitle: tag ? `${tag} · ${h.id}` : h.id,
				severity: bandSeverity(h.severity),
				value: delta != null && worst > 0 ? Math.min(1, Math.abs(delta) / worst) : null,
				display: fmtDelta(delta),
				href: target ? localizeHref(routeFor(target), locale) : null,
				ariaLabel: t.viewDetail(title),
			};
		});
	});
</script>

<Surface width="bleed" class="hotspots">
	<SurfaceHeader kicker={t.kicker} heading={t.heading} subheading={t.subheading} lede={t.lede} />

	<Separator variant="hazard" />

	<!-- The boundary gates skeleton / error / (no-file) empty. A PUBLISHED file with
	     an empty hotspots array is a legitimate "nothing is a hotspot right now"
	     reading, so we render that honest, surface-specific empty note inside the
	     children rather than the generic edge-empty (mirrors StopsIndex). -->
	<ResourceBoundary resource={hotspots} lang={locale}>
		{#if rows.length === 0}
			<p class="hotspots-note" data-slot="hotspots-empty">{t.empty}</p>
		{:else}
			<div class="hotspots-body">
				<SectionLabel text={t.heading} variant="station" />
				<p class="hotspots-caption">{t.rowCaption}</p>
				<ul class="hotspots-ranked" role="list" aria-label={t.listLabel}>
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
									<RankedRow
										bare
										rank={row.rank}
										title={row.title}
										subtitle={row.subtitle}
										severity={row.severity}
										value={row.value}
										display={row.display}
									/>
								</a>
							{:else}
								<RankedRow
									bare
									rank={row.rank}
									title={row.title}
									subtitle={row.subtitle}
									severity={row.severity}
									value={row.value}
									display={row.display}
								/>
							{/if}
						</li>
					{/each}
				</ul>
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
	.hotspots-ranked {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-width: 40rem;
		margin: 0;
		padding: 0;
		list-style: none;
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
	.hotspots-caveat,
	.hotspots-note {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.hotspots-caveat {
		max-width: 52ch;
	}
	.hotspots-note {
		padding: 0.5rem 0.875rem;
		line-height: 1.5;
	}
</style>
