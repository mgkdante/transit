<!--
  RepeatOffenders — the /repeat-offenders ("récidivistes") accountability
  surface (slice-9.6, Family D).

  Composes the surface spine + dataviz kit into an honest "worst first" ledger
  of the entities (routes / stops) that run late again and again:
    · createResource(getRepeatOffenders) → ResourceBoundary for skeleton / error
      / empty (the boundary's isEmpty stands the whole list down when the
      contract publishes no offenders).
    · SurfaceHeader for the head; a single ranked list of RankedRows, worst-first
      (the pipeline already orders the feed), each row severity-banded by its
      average delay and linking to the offending route (/route/{route}) or stop
      (/stop/{id}) where the id maps.

  DOCTRINE: the magnitude bar rides the dataviz SEVERITY scale (banded via the
  shared severeShareToSeverity-style helper below); --primary stays
  interactive-only. Honesty rule — a null avg delay shows the localized "no data"
  string, never a fabricated 0; a row with no recurrence string reads the honest
  "recurrence not recorded"; an empty / absent offenders list shows the localized
  empty state, never an invented row. Tokens only, no hex. All prose is co-located
  in ./repeatOffenders.copy.
-->
<script lang="ts">
	import { getLocale, localizeHref, type Locale } from '$lib/i18n';
	import { routeFor, type SurfaceTarget } from '$lib/nav';
	import { getRepeatOffenders, type Offender } from '$lib/v1';
	import type { SeverityCode } from '$lib/v1/schemas';
	import { createResource } from '$lib/v1/resource.svelte';
	import { ResourceBoundary, SurfaceHeader } from '$lib/components/surface';
	import { Surface, DashboardGrid } from '$lib/components/layout';
	import { Separator } from '$lib/components/ui/separator';
	import { RankedRow } from '$lib/components/dataviz';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import { copy as COPY } from './repeatOffenders.copy';

	const locale: Locale = getLocale();
	const t = $derived(COPY[locale]);

	const offenders = createResource(() => getRepeatOffenders());

	// Severity thresholds (avg delay, minutes) for banding the magnitude bar onto
	// the dataviz SeverityCode scale: >=10 min critical, >=5 min high, else watch.
	// A null delay bands to the quietest 'watch' so an absent reading never paints
	// as a hot severity (same convention as the shared severeShareToSeverity).
	const DELAY_CRITICAL_MIN = 10;
	const DELAY_HIGH_MIN = 5;
	function delayToSeverity(min: number | null): SeverityCode {
		if (min == null) return 'watch';
		if (min >= DELAY_CRITICAL_MIN) return 'critical';
		if (min >= DELAY_HIGH_MIN) return 'high';
		return 'watch';
	}

	/** Format a nullable minute-delay as "12.4 min" or the honest "no data". */
	function fmtMin(v: number | null): string {
		return v == null ? t.noData : `${v.toFixed(1)}${t.units.min}`;
	}

	// One row view-model per offender. The pipeline already ranks the feed
	// worst-first, so we preserve order and assign 1-based ranks as published.
	// The magnitude bar encodes the average delay normalized to [0,1] against the
	// WORST delay in the list (the dataviz severity mark); a row with no avg delay
	// reads a quiet no-data bar (value=null) while still holding its published
	// rank. The subtitle leads with the entity-type tag + the human recurrence
	// string (honest "recurrence not recorded" when absent).
	type OffenderRow = {
		readonly key: string;
		readonly rank: number;
		readonly title: string;
		readonly subtitle: string;
		readonly severity: SeverityCode;
		readonly value: number | null;
		readonly display: string;
		readonly target: SurfaceTarget;
		readonly href: string;
		readonly ariaLabel: string;
	};

	/** Localized title for one offender — its route name, then a sane fallback. */
	function offenderTitle(o: Offender): string {
		const typeLabel =
			o.type === 'route' ? t.type.route : o.type === 'stop' ? t.type.stop : t.type.other;
		const name = o.route_name?.trim();
		if (name) return name;
		const route = o.route?.trim();
		if (route) return `${typeLabel} ${route}`;
		return `${typeLabel} ${o.id}`;
	}

	/** Subtitle: the entity-type tag + the recurrence string (honest when absent). */
	function offenderSubtitle(o: Offender): string {
		const typeLabel =
			o.type === 'route' ? t.type.route : o.type === 'stop' ? t.type.stop : t.type.other;
		const recurrence = o.recurrence?.trim();
		const recurrenceText = recurrence ? `${t.recurrenceLabel} ${recurrence}` : t.recurrenceUnknown;
		// The offending route id is useful context when the title is the route NAME.
		const route = o.route?.trim();
		const routeText = route && o.route_name?.trim() ? ` · ${typeLabel} ${route}` : '';
		return `${recurrenceText}${routeText}`;
	}

	// Resolve each offender to the offending entity's detail route. A 'stop' links
	// to /stop/{id}; anything carrying a route id links to /route/{route}; failing
	// both, the row falls back to a non-navigating self target (its own id) so the
	// link is never broken — routeFor encodes the id and never throws.
	function offenderTarget(o: Offender): SurfaceTarget {
		if (o.type === 'stop') return { kind: 'stop', id: o.id };
		const route = o.route?.trim();
		if (route) return { kind: 'line', id: route };
		if (o.type === 'route') return { kind: 'line', id: o.id };
		return { kind: 'stop', id: o.id };
	}

	function buildRows(list: readonly Offender[]): OffenderRow[] {
		// Worst delay in the list → the [0,1] bar denominator. Guard a zero/empty
		// worst (every delay null) so we never divide by zero.
		const worst = list.reduce<number>(
			(m, o) => (o.avg_delay_min != null && o.avg_delay_min > m ? o.avg_delay_min : m),
			0,
		);
		return list.map((o, i) => {
			const delay = o.avg_delay_min ?? null;
			const target = offenderTarget(o);
			const title = offenderTitle(o);
			return {
				// Composite key over the (type, id, route) accountability unit: the
				// SAME offender id can legitimately appear on two different routes (one
				// vehicle, two lines — truth-audit found vehicle 42010 on routes 49 AND
				// 55), so the route is what disambiguates the unit. Keying on the
				// (type, id, route) triple keeps the {#each} reconciler stable across
				// reorders without leaning on the array index as a tie-breaker.
				key: `${o.type}:${o.id}:${o.route ?? ''}`,
				rank: i + 1,
				title,
				subtitle: offenderSubtitle(o),
				severity: delayToSeverity(delay),
				value: delay != null && worst > 0 ? Math.min(1, Math.max(0, delay / worst)) : null,
				display: fmtMin(delay),
				target,
				href: localizeHref(routeFor(target), locale),
				ariaLabel: t.viewDetail(title),
			};
		});
	}

	const rows = $derived.by<OffenderRow[]>(() => buildRows(offenders.data?.offenders ?? []));
</script>

<Surface width="bleed" class="repeat-offenders">
	<SurfaceHeader kicker={t.kicker} heading={t.heading} subheading={t.subheading} lede={t.lede} />

	<Separator variant="hazard" />

	<ResourceBoundary
		resource={offenders}
		lang={locale}
		isEmpty={(d) => (d.offenders?.length ?? 0) === 0}
	>
		<div class="repeat-offenders-block">
			<SectionLabel text={t.listSection} variant="station" />
			<p class="repeat-offenders-caption">{t.rowCaption}</p>
			<!-- The ranked ledger rides the SHARED DashboardGrid auto-fit recipe as a
			     semantic <ul> (worst-first published order honoured left-to-right then
			     down), so the list>listitem>link a11y survives and the grid-track recipe
			     lives ONLY in DashboardGrid. -->
			<DashboardGrid
				as="ul"
				minTile="360px"
				gutter={false}
				class="repeat-offenders-ranked"
				aria-label={t.listSummary}
			>
				{#each rows as row (row.key)}
					<!-- list > listitem > link: the <li> owns the listitem semantics so AT
					     can count the rows; the anchor owns the interactivity + accessible
					     name, and the inner RankedRow is `bare` (no self listitem role). -->
					<li class="repeat-offenders-item">
						<a
							class="repeat-offenders-link"
							href={row.href}
							data-sveltekit-preload-data="hover"
							data-slot="offender-link"
							aria-label={row.ariaLabel}
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
					</li>
				{/each}
			</DashboardGrid>
			<!-- Honest caveat: trailing-window recurrence proxy, not a certified scorecard. -->
			<p class="repeat-offenders-caveat" data-slot="offenders-caveat">{t.caveat}</p>
		</div>
	</ResourceBoundary>
</Surface>

<style>
	.repeat-offenders-block {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	/* The ranked ledger rides the SHARED DashboardGrid auto-fit recipe (rendered as a
	   semantic <ul> via `as="ul"`); the grid-track recipe + minTile live in
	   DashboardGrid. Here we only widen the measure so the board uses the desktop
	   real estate instead of a single narrow column. */
	:global(.dashboard-grid.repeat-offenders-ranked) {
		max-width: 76rem;
	}
	.repeat-offenders-item {
		display: block;
	}
	/* The whole ranked row is a link; strip the anchor chrome so RankedRow owns the
	   visuals, and ride the shared ring token on keyboard focus. */
	.repeat-offenders-link {
		display: block;
		text-decoration: none;
		color: inherit;
		border-radius: var(--radius-lg);
	}
	.repeat-offenders-link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	/* Quiet mono caption (what the headline + bar encode) + the honest caveat. */
	.repeat-offenders-caption,
	.repeat-offenders-caveat {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.repeat-offenders-caveat {
		max-width: 52ch;
	}
</style>
