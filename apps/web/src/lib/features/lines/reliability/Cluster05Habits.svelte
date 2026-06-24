<!--
  Cluster05Habits — the "05 Time-of-day habits" band of the historic Reliability
  surface (slice-9.6, approach B).

  Two reads, one band:
    - habits.matrix (7 days × 24 hours, cells number|null) → the Heatmap
      primitive. A `null` cell is "no data" (the primitive paints the dedicated
      --dataviz-heatmap-nodata token), distinct from a low real value — the
      honesty rule the doctrine demands.
    - dayOfWeek[] (ISO 1=Mon..7=Sun) → a weekday-seasonality ranked list of mean
      delay, worst day first, on the dataviz severity scale (RankedRow).

  Honest states: when BOTH reads are empty (no habit matrix AND no weekday rows)
  the band renders an explicit no-data note — never a fabricated zero, never a
  silently dropped section. Each sub-section also stands down independently when
  only it is empty.

  DOCTRINE: every data mark rides the dataviz scale (the Heatmap ramp + the
  severity scale); --primary is NEVER a data colour here. All copy is bilingual
  (FR canonical) — the shared cluster overline + no-data note come from the
  ReliabilityCopy prop; the band-intrinsic strings are co-located.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import type { RouteDayOfWeek } from '$lib/v1';
	import {
		Heatmap,
		RankedRow,
		ChartLegend,
		HEATMAP_RAMP,
		HEATMAP_NODATA,
	} from '$lib/components/dataviz';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import { AbsentValue } from '$lib/components/edge';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor, type MetricKey } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import {
		weekdayLabel,
		delayMinToSeverity,
		DELAY_DOW_DOMAIN,
	} from '$lib/features/reliability/shiftGrains';
	import type { HabitsVM } from './clusters';
	import type { ReliabilityCopy } from './reliability.copy';
	import { habitsBandCopy } from './Cluster05Habits.copy';

	export interface Cluster05HabitsProps {
		/** The 05 habits view-model (matrix kept verbatim; cells number|null). */
		habits: HabitsVM;
		/** Weekday-seasonality rows (ISO 1=Mon..7=Sun), pre-filtered/sorted by the VM. */
		dayOfWeek: RouteDayOfWeek[];
		/** Active locale. */
		locale: Locale;
		/** Shared reliability copy — supplies the cluster overline + no-data note. */
		copy: ReliabilityCopy;
	}

	let { habits, dayOfWeek, locale, copy }: Cluster05HabitsProps = $props();

	const band = $derived(habitsBandCopy[locale]);

	// The in-app metric-explainer (i) affordance: the one-line tip + a localized
	// deep link to /metrics#<anchor>. An INTERACTIVE control beside each heading.
	const explainerCopy = $derived(metricsCopy[locale]);
	const info = $derived((key: MetricKey, name: string) => {
		const i = metricInfoFor(key, locale);
		return { ...i, label: explainerCopy.info.trigger(name), linkLabel: explainerCopy.info.link };
	});

	/* ── Weekday seasonality ─────────────────────────────────────────────────
	   Only rows carrying a real mean delay rank; the band degrades to its
	   honest empty when none do (never a fabricated 0-delay row). Each row also
	   carries its SEVERE-delay share + observation count (A2) — the severe value
	   is surfaced as a second reading, but ONLY when the sample is large enough
	   to trust (a 1–2-observation weekday bucket stays unlabelled, never a
	   fabricated severe number). */
	type WeekdayRow = {
		readonly iso: number;
		readonly name: string;
		readonly delay: number;
		readonly severePct: number | null;
		readonly observationCount: number | null;
	};

	// A weekday severe share rests on too few observations below this floor → we
	// keep the row (its mean delay still ranks) but withhold the severe reading.
	const MIN_SEVERE_OBSERVATIONS = 5;

	const weekdayRows = $derived.by<WeekdayRow[]>(() =>
		dayOfWeek
			.filter((d): d is RouteDayOfWeek & { avg_delay_min: number } => d.avg_delay_min != null)
			.map((d) => ({
				iso: d.day_of_week_iso,
				// Shared ISO weekday vocabulary (1=Mon..7=Sun) — same table the stops
				// surface reads, so the two never drift.
				name: weekdayLabel(d.day_of_week_iso, locale),
				delay: d.avg_delay_min,
				severePct: d.severe_pct ?? null,
				observationCount: d.observation_count ?? null,
			})),
	);

	// S7 (B9 cycle): weekdays in FIXED Mon→Sun cycle order — NOT sorted by delay (the
	// cycle order IS the meaning). value = the ABSOLUTE mean delay (min), scaled by the
	// fixed DELAY_DOW_DOMAIN at the bar (never delay/max, so the same delay reads the
	// same length every visit); severity from the absolute delayMinToSeverity, decoupled
	// from the other days. The rank ordinal is dropped at the render (showRank=false).
	const rankedWeekdays = $derived.by(() =>
		weekdayRows
			.slice()
			.sort((a, b) => a.iso - b.iso)
			.map((r, i) => {
				// Severe share is shown only when enough observations back it.
				const severeTrusted =
					r.severePct != null &&
					r.observationCount != null &&
					r.observationCount >= MIN_SEVERE_OBSERVATIONS;
				return {
					rank: i + 1,
					title: r.name,
					value: r.delay,
					display: `${r.delay.toFixed(1)} min`,
					subtitle: severeTrusted
						? `${copy.peak.dayOfWeekSevere} ${r.severePct!.toFixed(1)}%`
						: band.avgDelay,
					severity: delayMinToSeverity(r.delay),
					key: r.iso,
				};
			}),
	);

	const hasHeatmap = $derived(!habits.isEmpty);
	const hasWeekday = $derived(weekdayRows.length > 0);
	const isEmpty = $derived(!hasHeatmap && !hasWeekday);

	// Full day names in heatmap ROW order (Mon..Sun) for the tooltip heading +
	// cell aria-label — the axis itself keeps the short labels.
	const fullDayLabels = $derived(band.weekdays.slice(1));

	// Heatmap scale legend — three ramp buckets (low→high) + the dedicated no-data
	// swatch, so the legend reads as an ordered scale. The ramp colours are data
	// marks (--dataviz-heatmap-*); the legend is decorative (the Heatmap's own
	// role=img summary + the plain-language caption are the a11y source of truth).
	const legendItems = $derived([
		{ colorVar: HEATMAP_RAMP[0], label: band.legend.low, swatch: 'square' as const },
		{ colorVar: HEATMAP_RAMP[2], label: band.legend.medium, swatch: 'square' as const },
		{
			colorVar: HEATMAP_RAMP[HEATMAP_RAMP.length - 1],
			label: band.legend.high,
			swatch: 'square' as const,
		},
		{ colorVar: HEATMAP_NODATA, label: band.legend.noData, swatch: 'square' as const },
	]);

	// Plain-language word for a cell's row-normalized intensity, bucketed on the
	// SAME 5-stop ramp the colour uses, so the readout word matches the colour.
	// `null` → the honest no-data text (never a fabricated Low).
	function heatmapCellText(value: number | null, norm: number | null): string {
		if (value == null || norm == null) return band.legend.noData;
		const bucket = Math.min(4, Math.floor(Math.min(1, Math.max(0, norm)) * 5));
		return [
			band.legend.low,
			band.legend.low,
			band.legend.medium,
			band.legend.high,
			band.legend.high,
		][bucket];
	}

	// Plain-language caption: the resolved scale phrase (never the raw snake_case
	// `scale`) + the how-to-read sentence. Null/unmapped scale → heading fallback.
	const scaleCaptionText = $derived(
		habits.scale
			? `${band.scaleLegend[habits.scale] ?? band.heatmapHeading} · ${band.scaleCaption}`
			: band.scaleCaption,
	);
</script>

<section class="habits-band" data-slot="cluster-05-habits" aria-label={copy.clusters.habits}>
	<SectionLabel text={copy.clusters.habits} variant="station" />
	<!-- Window caption: the heatmap + weekday seasonality accrue all available data. -->
	<p class="habits-window" data-slot="habits-window">{copy.windows.habits}</p>

	{#snippet metricInfo(key: MetricKey, name: string)}
		{@const i = info(key, name)}
		<MetricInfo
			class="cluster-info"
			tip={i.tip}
			href={i.href}
			label={i.label}
			linkLabel={i.linkLabel}
			side="bottom"
		/>
	{/snippet}

	{#if isEmpty}
		<!-- Honest empty: the styled honest-absence chip (says WHY), never a fabricated zero / dropped band. -->
		<div data-slot="habits-empty">
			<AbsentValue variant="block" reason="no-observations" {locale} />
		</div>
	{:else}
		<div class="habits-body">
			{#if hasHeatmap}
				<div class="habits-subsection" data-slot="habits-heatmap">
					<span class="label-with-info">
						<SectionLabel text={band.heatmapHeading} variant="metric" />
						{@render metricInfo('habits', band.heatmapHeading)}
					</span>
					<Heatmap
						grid={habits.matrix}
						dayLabels={[...band.weekdaysShort]}
						fullDayLabels={[...fullDayLabels]}
						label={band.heatmapLabel}
						hourAxisLabel={band.hourAxisLabel}
						dayAxisLabel={band.dayAxisLabel}
						valueLabel={band.cellValueLabel}
						noDataText={band.legend.noData}
						hourTicks={[0, 3, 6, 9, 12, 15, 18, 21]}
						clockTicks
						valueFormat={heatmapCellText}
						interactive
						class="habits-heatmap"
					/>
					<ChartLegend items={legendItems} />
					<p class="habits-scale-caption" data-slot="habits-scale-caption">
						{scaleCaptionText}
					</p>
				</div>
			{/if}

			{#if hasWeekday}
				<div class="habits-subsection" data-slot="habits-weekday">
					<span class="label-with-info">
						<SectionLabel text={band.weekdayHeading} variant="metric" />
						{@render metricInfo('seasonality', band.weekdayHeading)}
					</span>
					<ul class="habits-weekday-list" aria-label={band.weekdayHeading}>
						{#each rankedWeekdays as row (row.key)}
							<li class="habits-weekday-row">
								<RankedRow
									rank={row.rank}
									title={row.title}
									subtitle={row.subtitle}
									severity={row.severity}
									value={row.value}
									domain={DELAY_DOW_DOMAIN}
									unit=" min"
									showRank={false}
									display={row.display}
								/>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	{/if}
</section>

<style>
	.habits-band {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.habits-body {
		display: flex;
		flex-direction: column;
		gap: 1.75rem;
	}
	.habits-subsection {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	/* Mobile/360px hardening: keep the 7×24 heatmap inside its subsection at narrow
	   widths; a dense matrix may scroll horizontally rather than overflow the card.
	   `:global` reaches the Heatmap wrapper rendered via the `habits-heatmap` class. */
	.habits-subsection :global(.habits-heatmap) {
		max-width: 100%;
		overflow-x: auto;
	}
	/* A subsection heading + its explainer (i), kept centred on the label. The label
	   keeps a measure (min-width:0) so a long heading wraps cleanly; the (i) wrapper
	   never shrinks (flex:none) so the glyph stays whole beside it. */
	.label-with-info {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.label-with-info :global([data-slot='section-label']) {
		min-width: 0;
	}
	.label-with-info :global(.cluster-info) {
		flex: none;
	}
	/* Window caption: quiet mono, AA both themes. */
	.habits-window {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.habits-scale-caption {
		margin: 0;
		max-width: 42ch;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		color: var(--muted-foreground);
	}
	.habits-weekday-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.habits-weekday-row {
		display: block;
	}
</style>
