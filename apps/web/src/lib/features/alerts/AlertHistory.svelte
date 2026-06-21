<!--
  AlertHistory — the /alerts surface screen ("Avis", slice-9.6 Family D).

  The citizen-facing ACCOUNTABILITY log of PAST service alerts: a chronological
  (newest-first) list of resolved/expired alerts with their active window,
  resolved duration, reach (routes/stops) and estimated rider-impact — plus the
  Tier-2 cause/effect/severity distribution when the archive carries one.

  Composes the surface spine:
    · createResource(getAlertHistory) → ResourceBoundary for skeleton/error/empty
    · SurfaceHeader for the head + a LiveFreshness chip off the archive's
      generated_utc (a daily rebuild, never "live")
    · a chronological alert list whose ROWS match the LIVE-alert presentation —
      the SAME alertDisplayText() headline the map + AffectedAlerts use, the SAME
      severity glyph + dataviz-severity dot + visually-hidden severity word, and
      the SAME bilingual gtfsAlertLabels vocabulary — so a past alert reads like
      the live ones a rider already knows.
    · the cause/effect/severity breakdown as RankedRow lists (the bar rides the
      dataviz severity scale; --primary stays interactive-only).

  HONESTY: a null/absent field is OMITTED (never a fabricated 0 or invented row);
  a generic/empty headline falls back to the shared "Service alert" string (same
  as the live surfaces); an empty archive routes to the localized empty state;
  the breakdown stands DOWN entirely when no distribution was published, and an
  "unknown" cause/effect bucket reads a localized "Unspecified", never raw. The
  visible log is CAPPED with an honest "+N more" disclosure (never a silent drop).
  Data marks ride the dataviz scale; tokens only, no hex. All prose is in
  ./alerts.copy — no inline literals, no provider/place names.
-->
<script lang="ts">
	import { getLocale, type Locale } from '$lib/i18n';
	import { getAlertHistory } from '$lib/v1';
	import type {
		AlertHistory,
		AlertHistoryEntry,
		AlertBreakdownBucket,
		Alert,
		SeverityCode,
	} from '$lib/v1/schemas';
	import { SEVERITY_CODES } from '$lib/v1/schemas';
	import { createResource } from '$lib/v1/resource.svelte';
	import { ageSeconds as ageSecondsOf, formatUtc } from '$lib/utils/time';
	import { ResourceBoundary, SurfaceHeader, LiveFreshness } from '$lib/components/surface';
	import { Surface, DashboardGrid } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';
	import { RankedRow } from '$lib/components/dataviz';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	// Reuse the SAME alert presentation the map + AffectedAlerts use: the
	// locale-aware headline resolver (HTML scrub + generic-header guard) and the
	// bilingual GTFS-RT cause/effect labels. All pure + provider-agnostic.
	import { alertDisplayText } from '$lib/features/map/mapAlerts';
	import { causeLabel, effectLabel } from '$lib/features/map/gtfsAlertLabels';
	import { alertHistoryCopy } from './alerts.copy';

	const locale: Locale = getLocale();
	const t = $derived(alertHistoryCopy[locale]);

	// Historic tier — the daily-rebuilt alert archive (createResource, browser-only).
	const history = createResource(() => getAlertHistory());

	/** Max rows rendered before the "+N more" disclosure. */
	const VISIBLE_CAP = 25;
	let expanded = $state(false);

	/** Glyph per severity — colour is never the sole channel (mirrors AffectedAlerts). */
	const SEVERITY_GLYPH: Record<SeverityCode, string> = {
		critical: '◆',
		high: '▲',
		watch: '○',
	};
	const SEVERITY_SET = new Set<string>(SEVERITY_CODES);

	/**
	 * Coerce the archive's FREE-STRING severity to a valid SeverityCode. The
	 * historic build does NOT re-validate the closed enum (see alert_history.ts),
	 * so an unexpected/absent value bands to the quietest 'watch' — an unknown
	 * severity must never paint as a hot 'critical'.
	 */
	function asSeverity(raw: string | null | undefined): SeverityCode {
		return raw != null && SEVERITY_SET.has(raw) ? (raw as SeverityCode) : 'watch';
	}

	/**
	 * The headline for a history entry, via the SAME resolver the live surfaces
	 * use. The entry has no description/header_key, so we shape it as a minimal
	 * Alert carrying just the raw FR/EN headline text; alertDisplayText scrubs
	 * HTML, drops the generic "your stop"/"your line" placeholders and falls back
	 * to the shared localized "Service alert" — identical to the map + stop/route
	 * detail presentation, never a raw or fabricated string.
	 */
	function headline(entry: AlertHistoryEntry): string {
		const shaped: Alert = {
			id: entry.id,
			severity: asSeverity(entry.severity),
			header_key: '',
			header_text: entry.header_text ?? undefined,
			header_text_en: entry.header_text_en ?? undefined,
		};
		return alertDisplayText(shaped, locale);
	}

	/** A localized wall-clock for a window bound, or null when absent/invalid. */
	function windowTime(iso: string | null | undefined): string | null {
		if (iso == null) return null;
		const text = formatUtc(iso, locale);
		// formatUtc returns the no-data middot for invalid input — drop the line.
		return text === '·' ? null : text;
	}

	// Sort newest-first by start time. Entries with no start_utc sink to the end
	// (a missing instant can't be ordered) — never dropped, just last.
	const sorted = $derived.by<readonly AlertHistoryEntry[]>(() => {
		const alerts = history.data?.alerts ?? [];
		const stamp = (e: AlertHistoryEntry) => {
			const ms = e.start_utc != null ? Date.parse(e.start_utc) : NaN;
			return Number.isNaN(ms) ? -Infinity : ms;
		};
		return alerts.slice().sort((a, b) => stamp(b) - stamp(a));
	});

	const overflow = $derived(Math.max(0, sorted.length - VISIBLE_CAP));
	const visible = $derived(expanded || overflow === 0 ? sorted : sorted.slice(0, VISIBLE_CAP));

	// Freshness off the archive's generated_utc (a daily rebuild, not live → never
	// "stale"). A null stamp reads as the chip's own unknown state.
	const generatedUtc = $derived(history.data?.generated_utc ?? null);
	const ageSeconds = $derived(generatedUtc != null ? ageSecondsOf(generatedUtc) : null);

	// --- Tier-2 breakdown (by_cause / by_effect / by_severity) ---------------
	// Distinct-alert distribution; null/absent when no alerts in the window. Each
	// section stands DOWN when its bucket list is empty. The magnitude bar rides
	// the dataviz severity scale (RankedRow owns that), normalized to the busiest
	// bucket in its own group. Honesty: a bucket with no count is dropped; an
	// "unknown" cause/effect key reads the localized "Unspecified" (never raw).
	type BreakdownKind = 'cause' | 'effect' | 'severity';
	type BreakdownRow = {
		readonly key: string;
		readonly rank: number;
		readonly title: string;
		readonly severity: SeverityCode;
		readonly value: number | null;
		readonly display: string;
		readonly subtitle: string | undefined;
	};

	/** Localized title for a breakdown bucket key, per distribution kind. */
	function bucketTitle(key: string, kind: BreakdownKind): string {
		if (kind === 'severity') {
			return SEVERITY_SET.has(key) ? t.severity[key as SeverityCode] : key;
		}
		// The build emits the bare sentinel "unknown" when the provider omitted the
		// cause/effect (see alert_history.ts). That literal carries no rider meaning,
		// so it reads the localized "Unspecified" — not the humanized "Unknown" the
		// generic helper would produce for a non-enum token.
		if (key.trim().toLowerCase() === 'unknown') return t.breakdown.unspecified;
		const resolved = kind === 'cause' ? causeLabel(key, locale) : effectLabel(key, locale);
		// causeLabel/effectLabel return null for an uninformative GTFS-RT enum (e.g.
		// UNKNOWN_CAUSE) or a numeric vendor code → fall back to "Unspecified",
		// never a raw token; otherwise the curated/humanized label.
		return resolved ?? t.breakdown.unspecified;
	}

	function toRows(
		buckets: readonly AlertBreakdownBucket[] | undefined,
		kind: BreakdownKind,
	): BreakdownRow[] {
		const real = (buckets ?? []).filter((b) => (b.count ?? 0) > 0);
		const maxCount = real.reduce((m, b) => Math.max(m, b.count ?? 0), 0);
		return real
			.slice()
			.sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
			.map((b, i) => {
				const count = b.count ?? 0;
				const median = b.median_duration_min ?? null;
				return {
					key: b.key,
					rank: i + 1,
					title: bucketTitle(b.key, kind),
					// For the severity distribution the bucket IS a severity; otherwise the
					// bar reads as a neutral 'watch' (cause/effect carry no severity).
					severity: kind === 'severity' ? asSeverity(b.key) : 'watch',
					value: maxCount > 0 ? count / maxCount : null,
					display: t.breakdown.buckets(count),
					subtitle: median != null ? t.breakdown.median(median) : undefined,
				};
			});
	}

	const causeRows = $derived.by(() => toRows(history.data?.breakdown?.by_cause, 'cause'));
	const effectRows = $derived.by(() => toRows(history.data?.breakdown?.by_effect, 'effect'));
	const severityRows = $derived.by(() => toRows(history.data?.breakdown?.by_severity, 'severity'));
	const hasBreakdown = $derived(
		causeRows.length > 0 || effectRows.length > 0 || severityRows.length > 0,
	);

	const uid = $props.id();
	const logId = `alert-history-log-${uid}`;
</script>

<Surface width="bleed" class="alert-history">
	<SurfaceHeader kicker={t.kicker} heading={t.heading} subheading={t.subheading} lede={t.lede}>
		<LiveFreshness {generatedUtc} {ageSeconds} isStale={false} {locale} />
	</SurfaceHeader>

	<Separator variant="hazard" />

	<!-- HONEST ABSENCE: a zero-length alert archive is the GOOD empty — the network
	     ran normally with no disruptions in the window. Route it to the green
	     network-healthy verdict (empty-avis) rather than a grey nothing-to-show. -->
	<ResourceBoundary
		resource={history}
		lang={locale}
		isEmpty={(d: AlertHistory) => (d.alerts?.length ?? 0) === 0}
		emptyVariant="empty-avis"
	>
		<div class="alert-history-block">
			<div class="alert-history-head">
				<SectionLabel text={t.logSection} variant="station" />
				<span class="alert-history-count" data-slot="alert-count">
					{t.count(visible.length, sorted.length)}
				</span>
			</div>

			<ul id={logId} class="alert-history-log" aria-label={t.logListLabel} data-slot="alert-log">
				{#each visible as entry (entry.id)}
					{@const sev = asSeverity(entry.severity)}
					{@const from = windowTime(entry.start_utc)}
					{@const until = windowTime(entry.end_utc)}
					{@const duration = entry.duration_min ?? null}
					{@const routes = entry.routes ?? []}
					{@const stops = entry.stops ?? []}
					{@const impact = entry.impact_passages ?? null}
					<li class="alert-history-row" data-severity={sev} data-slot="alert-row">
						<p class="alert-history-row-head">
							<span class="alert-history-dot" aria-hidden="true">{SEVERITY_GLYPH[sev]}</span>
							<span class="sr-only">{t.severity[sev]}</span>
							<span class="alert-history-title">{headline(entry)}</span>
						</p>
						<dl class="alert-history-meta">
							{#if from}
								<div>
									<dt>{t.meta.from}</dt>
									<dd>{from}</dd>
								</div>
							{/if}
							{#if until}
								<div>
									<dt>{t.meta.until}</dt>
									<dd>{until}</dd>
								</div>
							{/if}
							{#if duration != null}
								<div>
									<dt>{t.meta.duration}</dt>
									<dd>{t.meta.durationValue(duration)}</dd>
								</div>
							{/if}
							{#if routes.length > 0}
								<div>
									<dt>{t.meta.routes}</dt>
									<dd>{routes.join(' · ')}</dd>
								</div>
							{/if}
							{#if stops.length > 0}
								<div>
									<dt>{t.meta.stops}</dt>
									<dd>{stops.length}</dd>
								</div>
							{/if}
							{#if impact != null}
								<div>
									<dt>{t.meta.impact}</dt>
									<dd>{t.meta.impactValue(impact)}</dd>
								</div>
							{/if}
						</dl>
					</li>
				{/each}
			</ul>

			{#if overflow > 0}
				<!-- Honest disclosure: the overflow is one click away, never silently
				     dropped. --primary belongs here (an interaction control). -->
				<button
					type="button"
					class="alert-history-more"
					aria-expanded={expanded}
					aria-controls={logId}
					onclick={() => (expanded = !expanded)}
				>
					{expanded ? t.showLess : t.more(overflow)}
				</button>
			{/if}
		</div>

		<!-- Tier-2 cause / effect / severity distribution — stands down entirely
		     when no distribution was published. Each section stands down when its
		     bucket list is empty. The magnitude bar rides the dataviz severity
		     scale (RankedRow owns it). -->
		{#if hasBreakdown}
			<Separator variant="hazard" />
			<div class="alert-history-block" data-slot="alert-breakdown">
				<SectionLabel text={t.breakdown.section} variant="station" />
				<!-- The three distributions tile into a fluid board: 3-up on a wide
				     desktop, 2-up mid, one column on a phone (auto-fit reflow, no
				     breakpoint bookkeeping). Each distribution stands DOWN on its own
				     {#if} — an empty bucket list emits NO tile and the grid reflows past
				     it, never a fabricated empty card. (The chronological LOG above stays
				     a single column — reading order is sacred there.) No `label`: the
				     enclosing breakdown block's SectionLabel already names the zone, so the
				     grid stays a plain layout container (no redundant region landmark). -->
				<DashboardGrid minTile="240px" gutter={false}>
					{#if causeRows.length > 0}
						<div class="alert-history-dist">
							<SectionLabel text={t.breakdown.byCause} variant="metric" />
							<div class="alert-history-ranked" role="list" aria-label={t.breakdown.byCauseLabel}>
								{#each causeRows as row (row.key)}
									<RankedRow
										rank={row.rank}
										title={row.title}
										subtitle={row.subtitle}
										severity={row.severity}
										value={row.value}
										display={row.display}
									/>
								{/each}
							</div>
						</div>
					{/if}
					{#if effectRows.length > 0}
						<div class="alert-history-dist">
							<SectionLabel text={t.breakdown.byEffect} variant="metric" />
							<div class="alert-history-ranked" role="list" aria-label={t.breakdown.byEffectLabel}>
								{#each effectRows as row (row.key)}
									<RankedRow
										rank={row.rank}
										title={row.title}
										subtitle={row.subtitle}
										severity={row.severity}
										value={row.value}
										display={row.display}
									/>
								{/each}
							</div>
						</div>
					{/if}
					{#if severityRows.length > 0}
						<div class="alert-history-dist">
							<SectionLabel text={t.breakdown.bySeverity} variant="metric" />
							<div
								class="alert-history-ranked"
								role="list"
								aria-label={t.breakdown.bySeverityLabel}
							>
								{#each severityRows as row (row.key)}
									<RankedRow
										rank={row.rank}
										title={row.title}
										subtitle={row.subtitle}
										severity={row.severity}
										value={row.value}
										display={row.display}
									/>
								{/each}
							</div>
						</div>
					{/if}
				</DashboardGrid>
			</div>
		{/if}
	</ResourceBoundary>
</Surface>

<style>
	.alert-history-block {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	/* Section label + the capped-count caption on one row. */
	.alert-history-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.25rem 1rem;
	}
	.alert-history-count {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
		font-variant-numeric: tabular-nums;
	}
	.alert-history-log {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
		max-width: 52rem;
	}
	/* Each past alert is a card with a severity-coloured leading rail — the same
	   signage pattern AffectedAlerts uses, on the dataviz severity scale. */
	.alert-history-row {
		--alert-tone: var(--dataviz-severity-watch);
		position: relative;
		margin: 0;
		border: 1px solid color-mix(in srgb, var(--alert-tone) 32%, var(--border) 68%);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--alert-tone) 9%, var(--card));
		padding: 0.6rem 0.7rem 0.6rem 0.9rem;
		overflow: hidden;
	}
	.alert-history-row::before {
		content: '';
		position: absolute;
		inset-block: 0;
		inset-inline-start: 0;
		width: 3px;
		background: var(--alert-tone);
	}
	.alert-history-row[data-severity='critical'] {
		--alert-tone: var(--dataviz-severity-critical);
	}
	.alert-history-row[data-severity='high'] {
		--alert-tone: var(--dataviz-severity-high);
	}
	.alert-history-row[data-severity='watch'] {
		--alert-tone: var(--dataviz-severity-watch);
	}
	.alert-history-row-head {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin: 0;
	}
	.alert-history-dot {
		flex: none;
		font-size: var(--text-small);
		line-height: 1.2;
		color: var(--alert-tone);
		font-variant-emoji: text;
	}
	.alert-history-title {
		min-width: 0;
		font-size: var(--text-small);
		font-weight: 500;
		line-height: 1.35;
		color: var(--foreground);
	}
	/* Window / duration / reach / impact — a labeled mono caption block, tinted by
	   the alert's own severity tone so it reads as one signage unit. */
	.alert-history-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 0.7rem;
		margin: 0.5rem 0 0;
	}
	.alert-history-meta div {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		min-width: 0;
	}
	.alert-history-meta dt {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 500;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: color-mix(in srgb, var(--alert-tone) 70%, var(--muted-foreground));
	}
	.alert-history-meta dd {
		margin: 0;
		min-width: 0;
		font-size: var(--text-caption);
		font-weight: 500;
		color: var(--foreground);
		font-variant-numeric: tabular-nums;
	}
	/* "+N more" disclosure — an INTERACTION control, so --primary belongs here. */
	.alert-history-more {
		align-self: flex-start;
		appearance: none;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.2;
		color: var(--primary);
		background: none;
		border: none;
		padding: 0.15rem 0;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	.alert-history-more:hover {
		text-decoration-thickness: 2px;
	}
	.alert-history-more:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
		border-radius: var(--radius-sm, 0.375rem);
	}
	/* Each cause / effect / severity distribution is a quiet bordered tile that
	   fills its DashboardGrid cell, so the three use the desktop width instead of
	   being capped narrow. Chrome only (--card bg, --border) — never a data mark;
	   the RankedRow bars bring their own dataviz-severity scale colour. */
	.alert-history-dist {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		min-width: 0;
		padding: 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--card);
	}
	.alert-history-ranked {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	/* Visually-hidden severity word — colour + glyph are never the sole channel. */
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
