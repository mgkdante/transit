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
	import type { SeverityCode } from '$lib/v1/schemas';
	import type { RouteDayOfWeek } from '$lib/v1';
	import {
		Heatmap,
		RankedRow,
		ChartLegend,
		HEATMAP_RAMP,
		HEATMAP_NODATA,
	} from '$lib/components/dataviz';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
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

	/* ── Weekday seasonality ─────────────────────────────────────────────────
	   Only rows carrying a real mean delay rank; the band degrades to its
	   honest empty when none do (never a fabricated 0-delay row). */
	type WeekdayRow = {
		readonly iso: number;
		readonly name: string;
		readonly delay: number;
	};

	const weekdayRows = $derived.by<WeekdayRow[]>(() =>
		dayOfWeek
			.filter((d): d is RouteDayOfWeek & { avg_delay_min: number } => d.avg_delay_min != null)
			.map((d) => ({
				iso: d.day_of_week_iso,
				name: band.weekdays[d.day_of_week_iso] ?? `${d.day_of_week_iso}`,
				delay: d.avg_delay_min,
			})),
	);

	// Worst day (highest mean delay) first → rank 1.
	const rankedWeekdays = $derived.by(() => {
		const max = weekdayRows.reduce((m, r) => Math.max(m, r.delay), 0);
		return weekdayRows
			.slice()
			.sort((a, b) => b.delay - a.delay)
			.map((r, i) => {
				// Normalize against the busiest weekday so the bar reads relative.
				const norm = max > 0 ? r.delay / max : 0;
				const severity: SeverityCode = norm >= 0.66 ? 'critical' : norm >= 0.33 ? 'high' : 'watch';
				return {
					rank: i + 1,
					title: r.name,
					value: norm,
					display: `${r.delay.toFixed(1)} min`,
					severity,
					key: r.iso,
				};
			});
	});

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

	{#if isEmpty}
		<p class="habits-empty" data-slot="habits-empty">{copy.strip.noDataNote}</p>
	{:else}
		<div class="habits-body">
			{#if hasHeatmap}
				<div class="habits-subsection" data-slot="habits-heatmap">
					<SectionLabel text={band.heatmapHeading} variant="metric" />
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
					<SectionLabel text={band.weekdayHeading} variant="metric" />
					<ul class="habits-weekday-list" aria-label={band.weekdayHeading}>
						{#each rankedWeekdays as row (row.key)}
							<li class="habits-weekday-row">
								<RankedRow
									rank={row.rank}
									title={row.title}
									subtitle={band.avgDelay}
									severity={row.severity}
									value={row.value}
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
	.habits-empty {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
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
