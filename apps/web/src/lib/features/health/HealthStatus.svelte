<!--
  HealthStatus — the /status (data-health) surface screen (S11 re-seat).

  Thin ORCHESTRATOR over two live resources + one mapping pass. Every derivation
  lives in ./selectors and every block in ./sections; this file only fetches,
  maps, and lays the sections out with the shared spine:

    · HEADER      — SurfaceHeader + a NEUTRAL "Updated N ago" stamp off
                    provenance.generated_utc.
    · LANES       — NEW (S11): per-publish-lane freshness + file counts + the last
                    value-gate verdict, from data_health.json (live lane). Stands
                    DOWN on a legacy publish (no data_health yet).
    · FRESHNESS   — per-feed run-status verdict + humanized age.
    · SOURCES     — feed + storage chain + relative last-loaded.
    · GAPS        — the known-gaps honesty callout.
    · NOTES       — EVERY published methodology string with no /metrics card.
    · RETENTION   — detail/aggregate retention stat pair.
    · CONFORMANCE — the conformance verdict + the complete unknown-member list.
    · ENVELOPE    — NEW (S11): the build-accountability envelope (publish run id +
                    schema/methodology versions) every payload carries.

  Two resources, BOTH freshness:true — so the shared dataPulse epoch re-runs both
  on a new publish (auto-refresh, no polling) AND both contribute to the site-wide
  newest-data timestamp. HONESTY: a null/absent slice stands its section DOWN or
  shows the styled absence, never a fabricated value. DOCTRINE: status marks ride
  the dataviz status scale (StatusDot), never --primary. Prose comes from
  ./health.copy; provider-agnostic (no agency literals).
-->
<script lang="ts">
	import { getLocale, type Locale } from '$lib/i18n';
	import { getProvenance, getDataHealth, freshnessRelative, type Provenance } from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import { formatRelativeSeconds } from '$lib/utils/time';
	import { METHODOLOGY_METRIC_KEY } from '$lib/features/metrics/metrics.content';
	import { Surface } from '$lib/components/layout';
	import { SurfaceHeader, ResourceBoundary, FreshnessStamp } from '$lib/components/surface';
	import { Separator } from '$lib/components/ui/separator';
	import { copy as COPY } from './health.copy';
	import {
		verdictFor as verdictForRaw,
		freshnessOf,
		sourcesOf,
		gapsOf,
		pipelineNotesOf,
		retentionOf,
	} from './selectors/provenanceViews';
	import { selectLaneRows, type LaneLabels } from './selectors/laneHealth';
	import { selectEnvelope } from './selectors/envelope';
	import SectionLanes from './sections/SectionLanes.svelte';
	import SectionFreshness from './sections/SectionFreshness.svelte';
	import SectionSources from './sections/SectionSources.svelte';
	import SectionGaps from './sections/SectionGaps.svelte';
	import SectionNotes from './sections/SectionNotes.svelte';
	import SectionRetention from './sections/SectionRetention.svelte';
	import SectionConformance from './sections/SectionConformance.svelte';
	import SectionEnvelope from './sections/SectionEnvelope.svelte';

	const locale: Locale = getLocale();
	const t = $derived(COPY[locale]);

	// The two honesty documents. `freshness: true` on BOTH wires the shared
	// newest-data contribution AND the dataPulse-epoch auto-refresh: a new publish
	// bumps the epoch and both resources re-run, so /status advances with no polling.
	const provenance = createResource(() => getProvenance(), { freshness: true });
	// data_health.json lives on the LIVE lane; null when not published yet (legacy
	// manifest / 404) → the lanes section stands down honestly.
	const dataHealth = createResource(() => getDataHealth(), { freshness: true });

	// ── Localized pass-through helpers handed to the sections ────────────────────
	function verdictFor(status: string | null | undefined) {
		return verdictForRaw(status, t.statusVerdict);
	}
	/** Humanize a non-negative age in seconds, or the localized "no age" note. */
	function humanizeAge(ageS: number | null | undefined): string {
		return ageS == null ? t.freshness.noAge : formatRelativeSeconds(ageS, locale);
	}
	/** Relative last-loaded stamp from an ISO string, or the localized fallback. */
	function lastLoaded(iso: string | null | undefined): string {
		return freshnessRelative(iso, locale) ?? t.sources.neverLoaded;
	}
	/** Humanize a raw gap feed-token into a citizen sentence (localized lookup). */
	function humanizeGap(token: string): string {
		return t.gaps.tokens[token] ?? token.replace(/_/g, ' ');
	}
	/** detail/aggregate day-count as "14 days", or null → the honest-absence chip. */
	function fmtDays(v: number | null): string | null {
		return v == null ? null : `${v}${t.retention.daysUnit}`;
	}

	// The lane-label bundle the selector interpolates (i18n stays here).
	const laneLabels = $derived<LaneLabels>({
		laneLabel: (key) => t.lanes.laneLabel[key] ?? key,
		cadence: (key) => t.lanes.cadence[key] ?? '',
		gateVerdict: t.lanes.gateVerdict,
		maintenanceReason: t.lanes.maintenanceReason,
		maintenanceLabel: t.lanes.laneLabel.maintenance,
		maintenanceCadence: t.lanes.maintenanceCadence,
	});
</script>

<Surface class="health">
	<!-- The surface head renders UNCONDITIONALLY (h1 present in every state). The
	     ResourceBoundary below gates only the provenance body; the once-daily
	     "Updated N ago" stamp rides inside it because it reads prov.generated_utc. -->
	<SurfaceHeader kicker={t.kicker} heading={t.heading} subheading={t.subheading} lede={t.lede} />

	<ResourceBoundary resource={provenance} lang={locale}>
		{#snippet children(prov)}
			{@const freshness = freshnessOf(prov)}
			{@const sources = sourcesOf(prov)}
			{@const gaps = gapsOf(prov)}
			{@const retention = retentionOf(prov)}
			{@const conformance = prov.conformance}
			{@const pipelineNotes = pipelineNotesOf(prov, METHODOLOGY_METRIC_KEY, t.pipelineNotes.labels)}
			{@const hasRetention = retention.detail != null || retention.aggregate != null}
			<!-- The lanes section reads the SECOND resource. When data_health is absent
			     (legacy publish, or still loading), laneRows is empty → the section
			     stands down. It is otherwise independent of the provenance body. -->
			{@const dh = dataHealth.data ?? null}
			{@const laneRows = selectLaneRows(dh, laneLabels)}
			<!-- The accountability envelope: read off data_health first (the live lane's
			     own stamp), falling back to provenance so it shows on a legacy publish. -->
			{@const envelope = selectEnvelope(prov as Provenance, dh)}
			{@const hasEnvelope =
				envelope.generationId != null ||
				envelope.schemaVersion != null ||
				envelope.methodologyVersion != null}

			<!-- UPMOST-LATEST stamp — the shared FreshnessStamp (variant="updated"): a
			     calm non-pulsing neutral "Updated N ago" off this daily document's
			     generated_utc. The surface AUTO-REFRESHES with the shared epoch. -->
			<div class="health-asof" data-slot="health-asof">
				<span class="health-asof-label">{t.asOf}</span>
				<FreshnessStamp variant="updated" generatedUtc={prov.generated_utc} {locale} />
			</div>

			<!-- ── Pipeline lanes (S11, top section) ──────────────────────────── -->
			{#if laneRows.length > 0}
				<Separator variant="hazard" />
				<SectionLanes rows={laneRows} copy={t} {locale} />
			{/if}

			<!-- ── Per-feed freshness ─────────────────────────────────────────── -->
			{#if freshness.length > 0}
				<Separator variant="hazard" />
				<SectionFreshness items={freshness} {verdictFor} {humanizeAge} copy={t} />
			{/if}

			<!-- ── Source-feed lineage ────────────────────────────────────────── -->
			{#if sources.length > 0}
				<Separator variant="hazard" />
				<SectionSources items={sources} {lastLoaded} copy={t} />
			{/if}

			<!-- ── Known data gaps (honesty banner) ───────────────────────────── -->
			{#if gaps.length > 0}
				<Separator variant="hazard" />
				<SectionGaps {gaps} {humanizeGap} copy={t} />
			{/if}

			<!-- ── Pipeline notes ─────────────────────────────────────────────── -->
			{#if pipelineNotes.length > 0}
				<Separator variant="hazard" />
				<SectionNotes notes={pipelineNotes} copy={t} />
			{/if}

			<!-- ── Retention ──────────────────────────────────────────────────── -->
			{#if hasRetention}
				<Separator variant="hazard" />
				<SectionRetention
					detail={retention.detail}
					aggregate={retention.aggregate}
					{fmtDays}
					copy={t}
					{locale}
				/>
			{/if}

			<!-- ── Conformance ────────────────────────────────────────────────── -->
			{#if conformance}
				<Separator variant="hazard" />
				<SectionConformance {conformance} copy={t} {locale} />
			{/if}

			<!-- ── Build accountability (S11 envelope) ────────────────────────── -->
			{#if hasEnvelope}
				<Separator variant="hazard" />
				<SectionEnvelope {envelope} copy={t} {locale} />
			{/if}
		{/snippet}
	</ResourceBoundary>
</Surface>

<style>
	/* "as of" stamp: a mono overline beside a neutral "Updated N ago" stamp. */
	.health-asof {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.health-asof-label {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		letter-spacing: 1px;
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
</style>
