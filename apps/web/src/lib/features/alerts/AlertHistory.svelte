<!--
  AlertHistory — the /alerts surface screen ("Avis", slice-9.6 Family D).

  The citizen-facing ACCOUNTABILITY log of PAST service alerts: a chronological
  (newest-first) list of resolved/expired alerts with their active window,
  resolved duration, reach (routes/stops) and estimated rider-impact — plus the
  Tier-2 cause/effect/severity distribution when the archive carries one.

  Composes the surface spine:
    · createResource(getAlertHistory) → ResourceBoundary for skeleton/error/empty
    · SurfaceHeader for the head + a FreshnessStamp (variant="updated") off the archive's
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
	import { formatUtc } from '$lib/utils/time';
	import {
		ResourceBoundary,
		SurfaceHeader,
		FreshnessStamp,
		GrainPicker,
		SearchInput,
		type GrainSegment,
	} from '$lib/components/surface';
	import { Surface, DashboardGrid, ControlsRail } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';
	import { RankedRow } from '$lib/components/dataviz';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import { AbsentValue } from '$lib/components/edge';
	// Reuse the SAME alert presentation the map + AffectedAlerts use: the
	// locale-aware headline resolver (HTML scrub + generic-header guard) and the
	// bilingual GTFS-RT cause/effect labels. All pure + provider-agnostic.
	import { alertDisplayText } from '$lib/features/map/mapAlerts';
	import { causeLabel, effectLabel } from '$lib/features/map/gtfsAlertLabels';
	import { alertHistoryCopy } from './alerts.copy';

	const locale: Locale = getLocale();
	const t = $derived(alertHistoryCopy[locale]);

	// Historic tier — the daily-rebuilt alert archive (createResource, browser-only).
	// `freshness: true` feeds the payload's generated_utc into the shared site-wide
	// newest-data timestamp (latest-wins/monotonic) with ZERO per-page age math —
	// the FreshnessStamp below derives the relative "Updated N ago" off the spine.
	const history = createResource(() => getAlertHistory(), { freshness: true });

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

	// --- Client-side filters (entity type + severity) ------------------------
	// Two clearable axes narrow the already-loaded log, no new fetch. Both ride the
	// shared ControlsRail + GrainPicker primitives (the same radiogroup filter UI as
	// /lines), each with an "all" segment that clears that axis. Honest: when the
	// active filters narrow the log to ZERO, an explicit "no alerts match" note +
	// "clear filters" action shows — never an empty void or a fabricated row.
	//   · entity — what an alert affects: lines (routes non-empty) vs stops.
	//   · severity — the alert's banded severity (asSeverity guards free strings).
	type EntityFilter = 'all' | 'lines' | 'stops';
	let entityFilter = $state<EntityFilter>('all');
	let severityFilter = $state<string>('all');

	const entitySegments = $derived<GrainSegment<EntityFilter>[]>([
		{ key: 'all', label: t.filters.entity.all },
		{ key: 'lines', label: t.filters.entity.lines },
		{ key: 'stops', label: t.filters.entity.stops },
	]);
	// All + the three closed severity codes (banded via asSeverity), labelled with
	// the shared severity vocabulary so the chips read like the live surfaces.
	const severitySegments = $derived<GrainSegment<string>[]>([
		{ key: 'all', label: t.filters.severity.all },
		...SEVERITY_CODES.map((code) => ({ key: code, label: t.severity[code] })),
	]);

	// --- Specific-entity axis (E3) -------------------------------------------
	// A THIRD axis: narrow to alerts touching ONE chosen route/stop. The picker is
	// a searchable chip set built from the routes/stops PRESENT in the loaded log
	// (no new fetch) — a SearchInput narrows the chips, clicking one selects it.
	// The selection is a stable kind+id token so a route "24" and a stop "24" never
	// collide. Honest: a query matching no affected entity reads the localized
	// "no entity" note; a selection narrowing the log to zero falls through to the
	// shared no-match note. Combines cleanly with type + severity (all clearable).
	type EntityToken = { readonly kind: 'route' | 'stop'; readonly id: string };
	let entityQuery = $state('');
	// The chosen entity token, serialized as "route:24" / "stop:52458"; '' = none.
	let selectedEntity = $state('');

	function tokenKey(tok: EntityToken): string {
		return `${tok.kind}:${tok.id}`;
	}
	function entityLabel(tok: EntityToken): string {
		return tok.kind === 'route'
			? t.filters.entityPick.route(tok.id)
			: t.filters.entityPick.stop(tok.id);
	}

	// Distinct affected entities present in the log, honouring the entity-TYPE axis
	// (so "Lines" hides stop chips, "Stops" hides route chips). Sorted numerically
	// when both ids are numeric, else lexically — a stable, scannable chip order.
	const entityTokens = $derived.by<EntityToken[]>(() => {
		// Plain record for dedup (a mutable Set trips the svelte-reactivity lint, and
		// this is a transient build map, never reactive state).
		const seen: Record<string, true> = {};
		const out: EntityToken[] = [];
		const add = (kind: 'route' | 'stop', id: string) => {
			const k = `${kind}:${id}`;
			if (seen[k]) return;
			seen[k] = true;
			out.push({ kind, id });
		};
		for (const e of sorted) {
			if (entityFilter !== 'stops') for (const r of e.routes ?? []) add('route', r);
			if (entityFilter !== 'lines') for (const s of e.stops ?? []) add('stop', s);
		}
		return out.sort((a, b) => {
			const na = Number(a.id);
			const nb = Number(b.id);
			if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
			return entityLabel(a).localeCompare(entityLabel(b), locale);
		});
	});

	// The chips after the search query (case-insensitive, over the localized label
	// AND the bare id). An empty query shows them all.
	const entityMatches = $derived.by<EntityToken[]>(() => {
		const q = entityQuery.trim().toLowerCase();
		if (!q) return entityTokens;
		return entityTokens.filter(
			(tok) => entityLabel(tok).toLowerCase().includes(q) || tok.id.toLowerCase().includes(q),
		);
	});

	// The active selection as a token (or null). A stale selection (the chosen
	// entity is no longer present after a type-filter change) is treated as cleared.
	const selectedToken = $derived.by<EntityToken | null>(() => {
		if (!selectedEntity) return null;
		return entityTokens.find((tok) => tokenKey(tok) === selectedEntity) ?? null;
	});

	function selectEntity(tok: EntityToken): void {
		selectedEntity = tokenKey(tok);
	}
	function clearEntity(): void {
		selectedEntity = '';
	}

	const filtersActive = $derived(
		entityFilter !== 'all' || severityFilter !== 'all' || selectedToken != null,
	);

	function clearFilters(): void {
		entityFilter = 'all';
		severityFilter = 'all';
		selectedEntity = '';
		entityQuery = '';
	}

	// The filtered log (over the newest-first `sorted` list). An empty routes/stops
	// array (or absent) means the alert does NOT affect that entity → it is excluded
	// by that axis. Severity is banded the same way the rows render it.
	const filtered = $derived.by<readonly AlertHistoryEntry[]>(() => {
		const sel = selectedToken;
		return sorted.filter((e) => {
			if (entityFilter === 'lines' && (e.routes?.length ?? 0) === 0) return false;
			if (entityFilter === 'stops' && (e.stops?.length ?? 0) === 0) return false;
			if (severityFilter !== 'all' && asSeverity(e.severity) !== severityFilter) return false;
			if (sel) {
				const list = sel.kind === 'route' ? (e.routes ?? []) : (e.stops ?? []);
				if (!list.includes(sel.id)) return false;
			}
			return true;
		});
	});
	const hasMatches = $derived(filtered.length > 0);

	const overflow = $derived(Math.max(0, filtered.length - VISIBLE_CAP));
	const visible = $derived(expanded || overflow === 0 ? filtered : filtered.slice(0, VISIBLE_CAP));

	// Freshness off the archive's generated_utc (a daily rebuild, not live). The
	// "Updated N ago" stamp computes its server-anchored, shared-tick age centrally
	// (FreshnessStamp variant="updated") — no per-page age math here.
	const generatedUtc = $derived(history.data?.generated_utc ?? null);

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
		<FreshnessStamp variant="updated" {generatedUtc} {locale} />
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
					{t.count(visible.length, filtered.length)}
				</span>
			</div>

			<!-- Filter rail — two clearable axes (entity type + severity) over the
			     already-loaded log. ONE ControlsRail (quiet infra chrome) collecting two
			     GrainPicker radiogroups, the same filter UI as /lines; --primary lives
			     only on the active chips, never on the rail. -->
			<ControlsRail label={t.filters.railLabel} class="alert-history-filters">
				<GrainPicker
					segments={entitySegments}
					bind:value={entityFilter}
					label={t.filters.entity.label}
				/>
				<GrainPicker
					segments={severitySegments}
					bind:value={severityFilter}
					label={t.filters.severity.label}
				/>
				<!-- Specific-entity picker: a searchable chip set of the routes/stops
				     PRESENT in the loaded log. Reuses the shared SearchInput; the chips
				     are a single-select (the chosen entity, or none). -->
				<div class="alert-history-entity" data-slot="entity-pick">
					{#if selectedToken}
						<!-- An active selection collapses the picker to a single clearable
						     chip naming the chosen entity (honest, never a silent narrow). -->
						<span class="alert-history-entity-active">
							{t.filters.entityPick.active(entityLabel(selectedToken))}
						</span>
						<button
							type="button"
							class="alert-history-clear"
							data-slot="clear-entity"
							onclick={clearEntity}
						>
							{t.filters.entityPick.clear}
						</button>
					{:else}
						<SearchInput
							bind:value={entityQuery}
							label={t.filters.entityPick.label}
							placeholder={t.filters.entityPick.placeholder}
							class="alert-history-entity-search"
						/>
						{#if entityMatches.length > 0}
							<div
								class="alert-history-entity-chips"
								role="group"
								aria-label={t.filters.entityPick.groupLabel}
								data-slot="entity-chips"
							>
								{#each entityMatches as tok (tokenKey(tok))}
									<button
										type="button"
										class="alert-history-entity-chip"
										data-slot="entity-chip"
										onclick={() => selectEntity(tok)}
									>
										{entityLabel(tok)}
									</button>
								{/each}
							</div>
						{:else}
							<!-- Honest: the query matches no affected entity — say so. -->
							<p class="alert-history-no-match" data-slot="entity-no-match">
								{t.filters.entityPick.noEntity}
							</p>
						{/if}
					{/if}
				</div>
				{#if filtersActive}
					<button
						type="button"
						class="alert-history-clear"
						data-slot="clear-filters"
						onclick={clearFilters}
					>
						{t.filters.clear}
					</button>
				{/if}
			</ControlsRail>

			{#if !hasMatches}
				<!-- Honest no-match: the active filters narrowed the log to zero. Say so
				     explicitly + offer to clear; never an empty void or a "·". -->
				<p class="alert-history-no-match" data-slot="alert-no-match">{t.filters.noMatch}</p>
			{:else}
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
			{/if}
		</div>

		<!-- Tier-2 cause / effect / severity distribution. The section stays present
		     (alerts exist in this branch), but its BODY is honest: when no distribution
		     was published, it renders the ONE styled honest-absence chip ("No data ·
		     not enough readings yet") instead of silently vanishing. Each distribution
		     stands down on its own {#if} when its bucket list is empty; the magnitude
		     bar rides the dataviz severity scale (RankedRow owns it). -->
		<Separator variant="hazard" />
		<div class="alert-history-block" data-slot="alert-breakdown">
			<SectionLabel text={t.breakdown.section} variant="station" />
			{#if !hasBreakdown}
				<!-- HONEST ABSENCE: the archive carries alerts but no published
				     cause/effect/severity distribution (a historic rollup with too few
				     readings to break down). Say so with the styled chip, never a blank. -->
				<AbsentValue variant="block" reason="no-observations" {locale} />
			{:else}
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
			{/if}
		</div>
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
	/* "Clear filters" — an INTERACTION control, so --primary belongs here. A quiet
	   mono link seated in the filter rail beside the two GrainPicker radiogroups. */
	.alert-history-clear {
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
	.alert-history-clear:hover {
		text-decoration-thickness: 2px;
	}
	.alert-history-clear:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
		border-radius: var(--radius-sm, 0.375rem);
	}
	/* Specific-entity picker — the SearchInput + its chip set (or the active
	   selection chip), seated in the filter rail beside the two radiogroups. */
	.alert-history-entity {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}
	.alert-history-entity-active {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
	}
	.alert-history-entity-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		max-width: 36rem;
	}
	/* A single affected-entity chip — a quiet selectable token. --primary stays
	   interactive-only (the focus ring + hover), never a data mark. */
	.alert-history-entity-chip {
		appearance: none;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1.2;
		color: var(--foreground);
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		padding: 0.25rem 0.65rem;
		cursor: pointer;
		transition:
			border-color 150ms ease,
			background-color 150ms ease;
	}
	.alert-history-entity-chip:hover {
		border-color: var(--primary);
		background: var(--muted);
	}
	.alert-history-entity-chip:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	@media (prefers-reduced-motion: reduce) {
		.alert-history-entity-chip {
			transition: none;
		}
	}
	/* Honest no-match note — quiet mono caption, never an empty void or a "·". */
	.alert-history-no-match {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
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
