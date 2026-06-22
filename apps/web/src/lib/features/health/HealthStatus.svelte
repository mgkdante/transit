<!--
  HealthStatus — the /status (data-health) surface screen.

  The full citizen read-out of provenance.json (the historic-tier honesty
  manifest). Where ConformanceBadge surfaces ~5% of that payload, this surface
  renders the whole thing through the shared spine:

    · HEADER     — SurfaceHeader (kicker/heading/lede) + a NEUTRAL "Updated N ago"
                   stamp driven by provenance.generated_utc (a daily doc, never
                   the live-tier LIVE chip).
    · FRESHNESS  — one EntityRow-style row per freshness[] entry: feed + a
                   StatusDot encoding the run-status verdict + a humanized age
                   from age_s ("4 minutes ago").
    · SOURCES    — one row per sources[] entry: feed + storage chain + a relative
                   last_loaded_utc.
    · GAPS       — an honesty callout naming gaps[] feeds (metro has no realtime,
                   …), each token humanized. Stands DOWN when gaps is empty.
    · NOTES      — every methodology[] string NOT threaded into a /metrics card
                   (label + verbatim string), so no published note is ever lost.
                   Stands DOWN when every key is already threaded (or absent).
    · RETENTION  — a MetricDisplay stat pair (detail_days / aggregate_days).
    · CONFORMANCE— a ConformanceBadge verdict + a CollapsibleSection listing the
                   COMPLETE unknown_members[] + the exact extra_row_count.

  DOCTRINE: every status verdict rides the dataviz status scale via StatusDot
  (on_time/late/unknown), never --primary; --primary stays interactive-only (the
  conformance disclosure). HONESTY: a null/absent/empty contract value stands the
  section/row DOWN or shows the localized "no data" — never a fabricated value or
  an empty card. All prose comes from ./health.copy; provider-agnostic (no agency
  literals). The whole surface gates behind ResourceBoundary, so the provenance
  fetch's skeleton/error/empty states render once, here.
-->
<script lang="ts">
	import { getLocale, type Locale } from '$lib/i18n';
	import { getProvenance, freshnessRelative, type Provenance } from '$lib/v1';
	import { createResource } from '$lib/v1/resource.svelte';
	import { formatRelativeSeconds } from '$lib/utils/time';
	import { METHODOLOGY_METRIC_KEY } from '$lib/features/metrics/metrics.content';
	import { Surface } from '$lib/components/layout';
	import {
		SurfaceHeader,
		ConformanceBadge,
		ResourceBoundary,
		EntityList,
		FreshnessStamp,
	} from '$lib/components/surface';
	import { Separator } from '$lib/components/ui/separator';
	import { CollapsibleSection } from '$lib/components/shared';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import StatusDot from '$lib/components/brand/StatusDot.svelte';
	import { copy as COPY } from './health.copy';

	const locale: Locale = getLocale();
	const t = $derived(COPY[locale]);

	// The honesty manifest. The WHOLE surface is this one document, so unlike the
	// supplementary ConformanceBadge elsewhere, here the fetch IS the surface — we
	// gate it behind ResourceBoundary (skeleton/error/empty) rather than rendering
	// nothing on failure. `freshness: true` contributes provenance.generated_utc to
	// the shared site-wide newest-data timestamp AND, via dataRefresh.epoch, this
	// resource RE-RUNS on a new publish (dataPulse bumps the epoch) — so /status
	// AUTO-REFRESHES to the upmost-latest data with no per-page polling.
	const provenance = createResource(() => getProvenance(), { freshness: true });

	// --- per-feed freshness verdict ------------------------------------------
	// freshness[].status is the LAST INGESTION-RUN status (succeeded/failed/
	// running/pending), not a freshness band. Map it to a dataviz status aspect +
	// a localized verdict label. An unknown/absent status falls back to the
	// neutral "unknown" aspect — honest about a verdict we don't recognize.
	type Verdict = { aspect: 'on_time' | 'late' | 'unknown'; label: string };
	function verdictFor(status: string | null | undefined): Verdict {
		switch (status) {
			case 'succeeded':
				return { aspect: 'on_time', label: t.statusVerdict.ok };
			case 'failed':
				return { aspect: 'late', label: t.statusVerdict.failed };
			case 'running':
			case 'pending':
				return { aspect: 'unknown', label: t.statusVerdict.running };
			default:
				return { aspect: 'unknown', label: t.statusVerdict.unknown };
		}
	}

	/** Humanize a non-negative age in seconds, or the localized "no age" note. */
	function humanizeAge(ageS: number | null | undefined): string {
		return ageS == null ? t.freshness.noAge : formatRelativeSeconds(ageS, locale);
	}

	/**
	 * Relative last-loaded stamp from an ISO string, or the localized fallback.
	 * Routed through the ONE centralized server-anchored, shared-tick derivation
	 * (freshnessRelative) so this per-source age uses the same math as every stamp.
	 */
	function lastLoaded(iso: string | null | undefined): string {
		return freshnessRelative(iso, locale) ?? t.sources.neverLoaded;
	}

	// --- section presence guards ---------------------------------------------
	// Each section stands DOWN (renders nothing) when its slice of the manifest is
	// absent/empty — never a fabricated or empty card. `freshness`/`sources`/
	// `gaps` are arrays; `retention`/`conformance` are objects.
	function freshnessOf(p: Provenance) {
		return p.freshness ?? [];
	}
	function sourcesOf(p: Provenance) {
		return p.sources ?? [];
	}
	function gapsOf(p: Provenance) {
		return p.gaps ?? [];
	}

	/**
	 * Humanize a raw gap feed-token into a citizen sentence: a localized lookup
	 * for known tokens (e.g. `metro_realtime` → "Metro: no realtime feed"), else
	 * the token with underscores turned to spaces (so an unknown token still reads
	 * as words, never raw `metro_realtime`). Provider-agnostic — the token map is
	 * generic, never an agency literal.
	 */
	function humanizeGap(token: string): string {
		return t.gaps.tokens[token] ?? token.replace(/_/g, ' ');
	}

	/**
	 * The provenance.methodology entries NOT threaded into a /metrics card — every
	 * key present in the published dict that has no METHODOLOGY_METRIC_KEY mapping
	 * (history_freeze, service_time_conversion, alert_text_en, network_no_data,
	 * alert_breakdown). Each carries a human label (from copy, falling back to the
	 * humanized key) + the verbatim published string, so EVERY methodology string
	 * renders somewhere. Empty (→ the section stands down) when the dict is absent
	 * or every key is already threaded to a metric.
	 */
	function pipelineNotesOf(
		p: Provenance,
	): ReadonlyArray<{ key: string; label: string; text: string }> {
		const methodology = p.methodology;
		if (!methodology) return [];
		return Object.entries(methodology)
			.filter(([key, value]) => !(key in METHODOLOGY_METRIC_KEY) && typeof value === 'string')
			.map(([key, value]) => ({
				key,
				label: t.pipelineNotes.labels[key] ?? key.replace(/_/g, ' '),
				text: (value as string).trim(),
			}))
			.filter((n) => n.text.length > 0);
	}
	/** detail/aggregate retention days, each present only when the key exists. */
	function retentionOf(p: Provenance): { detail: number | null; aggregate: number | null } {
		const r = p.retention ?? {};
		const detail = typeof r.detail_days === 'number' ? r.detail_days : null;
		const aggregate = typeof r.aggregate_days === 'number' ? r.aggregate_days : null;
		return { detail, aggregate };
	}

	/** Format a retention day-count as "14 days", or the localized no-data. */
	function fmtDays(v: number | null): string {
		return v == null ? t.noData : `${v}${t.retention.daysUnit}`;
	}
</script>

<Surface width="content" class="health">
	<!-- The surface head renders UNCONDITIONALLY (h1 present in every state — skeleton,
	     error, empty — matching every other surface). The ResourceBoundary below gates
	     only the provenance body; the once-daily "Updated N ago" stamp rides inside it
	     because it reads prov.generated_utc. -->
	<SurfaceHeader kicker={t.kicker} heading={t.heading} subheading={t.subheading} lede={t.lede} />

	<ResourceBoundary resource={provenance} lang={locale}>
		{#snippet children(prov)}
			{@const freshness = freshnessOf(prov)}
			{@const sources = sourcesOf(prov)}
			{@const gaps = gapsOf(prov)}
			{@const retention = retentionOf(prov)}
			{@const conformance = prov.conformance}
			{@const pipelineNotes = pipelineNotesOf(prov)}
			{@const hasRetention = retention.detail != null || retention.aggregate != null}

			<!-- UPMOST-LATEST stamp — the shared FreshnessStamp (variant="updated"): a
			     calm non-pulsing neutral "Updated N ago" off this daily document's
			     generated_utc. Deliberately NOT the live chip (no "LIVE"/pulse). The
			     surface AUTO-REFRESHES: dataPulse bumps the epoch on a new publish, the
			     provenance resource re-runs, and this stamp advances with it. -->
			<div class="health-asof" data-slot="health-asof">
				<span class="health-asof-label">{t.asOf}</span>
				<FreshnessStamp variant="updated" generatedUtc={prov.generated_utc} {locale} />
			</div>

			<!-- ── Per-feed freshness ─────────────────────────────────────────── -->
			{#if freshness.length > 0}
				<Separator variant="hazard" />
				<section class="health-block" aria-labelledby="health-freshness">
					<SectionLabel id="health-freshness" text={t.freshness.section} variant="station" />
					<p class="health-note">{t.freshness.note}</p>
					<EntityList
						items={freshness}
						key={(f) => f.feed}
						class="health-list"
						aria-label={t.freshness.listLabel}
					>
						{#snippet row(f)}
							{@const v = verdictFor(f.status)}
							<div class="health-row" data-slot="freshness-row">
								<span class="health-row-lead">
									<!-- Decorative: the verdict is already visible text in
									     .health-row-verdict, so the dot carries no sr-only label
									     (AT would otherwise announce the verdict twice). -->
									<StatusDot color={v.aspect} aria-hidden="true" />
									<span class="health-row-feed">{f.feed}</span>
								</span>
								<span class="health-row-meta">
									<span class="health-row-verdict">{v.label}</span>
									<span class="health-row-age">{humanizeAge(f.age_s)}</span>
								</span>
							</div>
						{/snippet}
					</EntityList>
				</section>
			{/if}

			<!-- ── Source-feed lineage ────────────────────────────────────────── -->
			{#if sources.length > 0}
				<Separator variant="hazard" />
				<section class="health-block" aria-labelledby="health-sources">
					<SectionLabel id="health-sources" text={t.sources.section} variant="station" />
					<p class="health-note">{t.sources.note}</p>
					<EntityList
						items={sources}
						key={(s) => s.feed}
						class="health-list"
						aria-label={t.sources.listLabel}
					>
						{#snippet row(s)}
							<div class="health-row health-row--source" data-slot="source-row">
								<span class="health-row-body">
									<span class="health-row-feed">{s.feed}</span>
									<span
										class="health-row-chain"
										aria-label={`${t.sources.chainPrefix}: ${s.chain ?? t.sources.noChain}`}
									>
										{s.chain ?? t.sources.noChain}
									</span>
								</span>
								<span class="health-row-age">{lastLoaded(s.last_loaded_utc)}</span>
							</div>
						{/snippet}
					</EntityList>
				</section>
			{/if}

			<!-- ── Known data gaps (honesty banner) ───────────────────────────── -->
			<!-- Stands DOWN entirely when gaps is empty — never an empty callout. -->
			{#if gaps.length > 0}
				<Separator variant="hazard" />
				<section class="health-block" aria-labelledby="health-gaps">
					<SectionLabel id="health-gaps" text={t.gaps.section} variant="station" />
					<div class="health-gaps" data-slot="gaps-callout">
						<p class="health-gaps-lede">{t.gaps.lede}</p>
						<ul class="health-gaps-list" aria-label={t.gaps.listLabel}>
							{#each gaps as gap (gap)}
								<li class="health-gaps-item">{humanizeGap(gap)}</li>
							{/each}
						</ul>
					</div>
				</section>
			{/if}

			<!-- ── Retention ──────────────────────────────────────────────────── -->
			{#if pipelineNotes.length > 0}
				<Separator variant="hazard" />
				<section class="health-block" aria-labelledby="health-pipeline-notes">
					<SectionLabel
						id="health-pipeline-notes"
						text={t.pipelineNotes.section}
						variant="station"
					/>
					<p class="health-note">{t.pipelineNotes.note}</p>
					<ul
						class="health-notes-list"
						aria-label={t.pipelineNotes.listLabel}
						data-slot="pipeline-notes"
					>
						{#each pipelineNotes as note (note.key)}
							<li class="health-note-item">
								<SectionLabel text={note.label} variant="metric" />
								<p class="health-note-text">{note.text}</p>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			<!-- Retention -->
			{#if hasRetention}
				<Separator variant="hazard" />
				<section class="health-block" aria-labelledby="health-retention">
					<SectionLabel id="health-retention" text={t.retention.section} variant="station" />
					<p class="health-note">{t.retention.note}</p>
					<div class="health-retention">
						{#if retention.detail != null}
							<MetricDisplay
								value={fmtDays(retention.detail)}
								label={t.retention.detailLabel}
								size="md"
							/>
						{/if}
						{#if retention.aggregate != null}
							<MetricDisplay
								value={fmtDays(retention.aggregate)}
								label={t.retention.aggregateLabel}
								size="md"
							/>
						{/if}
					</div>
				</section>
			{/if}

			<!-- ── Conformance (full verdict + complete unknown-member list) ──── -->
			{#if conformance}
				<Separator variant="hazard" />
				<section class="health-block" aria-labelledby="health-conformance">
					<SectionLabel id="health-conformance" text={t.conformance.section} variant="station" />
					<p class="health-note">{t.conformance.note}</p>
					<div class="health-conformance-badge">
						<ConformanceBadge {conformance} {locale} />
					</div>
					<!-- The badge only previews a few members; the full list + the exact
					     extra-row count live in this disclosure (rendered only when the
					     feed named unexpected fields). -->
					{#if conformance.unknown_members && conformance.unknown_members.length > 0}
						<div class="section-block">
							<CollapsibleSection
								title={t.conformance.detailsTitle}
								sectionKey="health-conformance-members"
								open={false}
							>
								<div class="health-conformance-detail">
									<!-- Honest extra-row count: a real number renders localized; a
									     null/absent count shows the no-data string, never a fabricated 0. -->
									<MetricDisplay
										value={typeof conformance.extra_row_count === 'number'
											? conformance.extra_row_count.toLocaleString(
													locale === 'fr' ? 'fr-CA' : 'en-CA',
												)
											: t.noData}
										label={t.conformance.extraRowsLabel}
										size="md"
									/>
									<div class="health-members">
										<SectionLabel text={t.conformance.membersLabel} variant="metric" />
										<ul class="health-members-list" aria-label={t.conformance.membersListLabel}>
											{#each conformance.unknown_members as member (member)}
												<li class="health-members-item">{member}</li>
											{/each}
										</ul>
									</div>
								</div>
							</CollapsibleSection>
						</div>
					{/if}
				</section>
			{/if}
		{/snippet}
	</ResourceBoundary>
</Surface>

<style>
	/* "as of" stamp: a mono overline beside a neutral "Updated N ago" stamp (the
	   daily doc is NOT live — no pulsing LIVE chip). */
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

	.health-block {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.health-note {
		margin: 0;
		color: var(--muted-foreground);
		font-size: var(--text-small);
		line-height: 1.6;
		max-width: 60ch;
	}

	/* Pipeline-notes list: one label + verbatim methodology string per un-threaded
	   key. The string reads on the mono caption voice, set apart from prose. */
	.health-notes-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.health-note-item {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.health-note-text {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
		line-height: 1.7;
		max-width: 72ch;
		overflow-wrap: anywhere;
	}

	/* Freshness + source rows: a leading identity cluster and a right-aligned
	   meta cell, all on the mono signage voice. */
	.health-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.875rem;
		padding: 0.75rem 0.25rem;
		min-width: 0;
	}
	.health-row--source {
		align-items: flex-start;
	}
	.health-row-lead {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}
	.health-row-body {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}
	.health-row-feed {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.health-row-chain {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
		overflow-wrap: anywhere;
	}
	.health-row-meta {
		display: inline-flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.1rem;
		flex-shrink: 0;
		text-align: right;
	}
	.health-row-verdict {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		text-transform: uppercase;
		letter-spacing: var(--tracking-eyebrow);
		color: var(--muted-foreground);
	}
	.health-row-age {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
		flex-shrink: 0;
	}

	/* Known-data-gaps honesty callout. */
	.health-gaps {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.875rem 1rem;
		border: 1px solid var(--border);
		border-left: 3px solid var(--dataviz-status-late);
		border-radius: var(--radius-md);
		background: var(--muted);
	}
	.health-gaps-lede {
		margin: 0;
		color: var(--foreground);
		font-size: var(--text-small);
		line-height: 1.6;
	}
	.health-gaps-list {
		margin: 0;
		padding-inline-start: 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.health-gaps-item {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
		overflow-wrap: anywhere;
	}

	/* Retention stat pair. */
	.health-retention {
		display: grid;
		gap: 1.25rem 2rem;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		max-width: 28rem;
	}

	/* Conformance disclosure body. */
	.health-conformance-badge {
		display: flex;
	}
	.section-block {
		scroll-margin-block-start: 5.5rem;
	}
	.health-conformance-detail {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.health-members {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.health-members-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.health-members-item {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		padding: 0.15rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--muted);
		color: var(--muted-foreground);
		overflow-wrap: anywhere;
	}
</style>
