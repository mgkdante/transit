<!--
  Cluster04Crowding — the 04 CROWDING band of the historic Reliability surface.

  Renders the trailing-window occupancy band-shares as a 100%-stacked proportion
  bar (StackedBar, scale='occupancy'), reusing the dataviz occupancy scale/vars.
  The dominant band is also lifted to a MetricDisplay headline for a single-glance
  read.

  HONESTY DOCTRINE:
    - occupancy_mix is null when there is no telemetry. The VM resolves that (and
      an all-zero mix) to `isEmpty`, and we render an EXPLICIT "no crowding
      telemetry" note — NEVER a fabricated bar or an even split.
    - Every band is a data mark on the dataviz occupancy scale (StackedBar owns
      this); --primary never colours a band.

  Band labels are reused from the canonical `lines` detail copy
  (detailCopy[locale].occupancyBands) so the vocabulary stays DRY across surfaces.
-->
<script lang="ts">
	import { fmtDelayMin as sharedFmtDelayMin } from '$lib/utils';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import { AbsentValue } from '$lib/components/edge';
	import { StackedBar, RankedRow, type StackedSegment } from '$lib/components/dataviz';
	import {
		DELAY_POS_DOMAIN,
		delayMinToSeverity,
		weekdayLabel,
	} from '$lib/features/reliability/shiftGrains';
	import { OCCUPANCY_CODES, type OccupancyCode } from '$lib/v1/schemas';
	import type { Locale } from '$lib/i18n';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import { metricInfoFor } from '$lib/features/metrics/metrics.content';
	import { metricsCopy } from '$lib/features/metrics/metrics.copy';
	import { detailCopy } from '../lines.copy';
	import type { CrowdingVM } from './clusters';
	import type { ReliabilityCopy } from './reliability.copy';

	interface Props {
		/** The 04-crowding view-model from `toReliabilityClusters`. */
		vm: CrowdingVM;
		/** Active locale — FR is the canonical product voice. */
		locale: Locale;
		/** The slice-9.6 reliability copy (cluster overline + honest-state notes). */
		copy: ReliabilityCopy;
	}

	let { vm, locale, copy }: Props = $props();

	/** Canonical occupancy band labels (legend + a11y), keyed by OccupancyCode. */
	const bands = $derived(detailCopy[locale].occupancyBands);

	// S7: the GRAIN-AWARE mix — the occupancy_by_grain entry the mapper already
	// resolved for the selected grain, falling back to the scalar trailing-window mix
	// (older snapshots / a grain with no telemetry). The headline + bar follow the
	// rail's grain through this single derived.
	const activeMix = $derived(vm.mixByGrain ?? vm.mix);

	/** Build the five occupancy bands as StackedBar segments (fractions 0..1). */
	const toSegments = (mix: typeof vm.mix): StackedSegment[] =>
		OCCUPANCY_CODES.map((code: OccupancyCode) => ({
			code,
			value: mix ? mix[code] : null,
			label: bands[code],
		}));
	const mixHasShare = (mix: typeof vm.mix): boolean =>
		mix != null && OCCUPANCY_CODES.some((code) => (mix[code] ?? 0) > 0);

	/** The (grain-aware) headline occupancy bar segments. */
	const segments = $derived<StackedSegment[]>(toSegments(activeMix));

	// S7 §04: weekday (ISO 1-5) vs weekend (ISO 6-7) occupancy split, a 2-col small
	// multiple. The mapper folds the per-ISO-weekday shares into one weekday + one
	// weekend mix; null when occupancy_by_dow is absent (then the sub-block is omitted).
	const weekdayWeekendCols = $derived.by(() => {
		const ww = vm.weekdayWeekend;
		if (!ww) return null;
		return {
			weekday: { segs: toSegments(ww.weekday), has: mixHasShare(ww.weekday) },
			weekend: { segs: toSegments(ww.weekend), has: mixHasShare(ww.weekend) },
		};
	});

	// P11 §04: the per-ISO-weekday occupancy SMALL MULTIPLE — up to 7 stacked strips,
	// Mon→Sun, each its own occupancy StackedBar (the same primitive + scale as the
	// headline mix). The mapper hands a FIXED 1..7 frame; a weekday with no telemetry
	// (mix:null OR all-zero shares) carries `has: false` so its cell renders the honest
	// AbsentValue chip in the SAME box, never a fabricated bar or a dropped strip. null
	// when occupancy_by_dow is absent → the small-multiple is omitted entirely.
	const weekdayStrips = $derived.by(() => {
		const rows = vm.byWeekday;
		if (!rows) return null;
		return rows.map((d) => ({
			iso: d.iso,
			label: weekdayLabel(d.iso, locale),
			segs: toSegments(d.mix),
			has: mixHasShare(d.mix),
		}));
	});

	/** Total band share (guards the dominant-band headline + share math). */
	const total = $derived(
		segments.reduce((sum, s) => sum + (s.value != null && s.value > 0 ? s.value : 0), 0),
	);

	/** The largest band — lifted to a MetricDisplay as the single-glance read. */
	const dominant = $derived.by(() => {
		if (total <= 0) return null;
		let best: { code: OccupancyCode; label: string; share: number } | null = null;
		for (const code of OCCUPANCY_CODES) {
			const v = activeMix ? activeMix[code] : null;
			if (v == null || v <= 0) continue;
			if (best == null || v > best.share) best = { code, label: bands[code], share: v };
		}
		return best;
	});

	/** Dominant-band share as a whole-percent string (e.g. "62%"). */
	const dominantPct = $derived(dominant ? `${Math.round((dominant.share / total) * 100)}%` : null);

	// The in-app metric-explainer (i) affordance for the occupancy band: the
	// one-line tip + a localized deep link to /metrics#occupancy. An INTERACTIVE
	// control beside the label, never a data mark.
	const explainerCopy = $derived(metricsCopy[locale]);
	const occupancyInfo = $derived.by(() => {
		const i = metricInfoFor('occupancy', locale);
		return {
			...i,
			label: explainerCopy.info.trigger(copy.clusters.crowding),
			linkLabel: explainerCopy.info.link,
		};
	});
	// The dominant-band tile's own (i): same occupancy tip + deep link, but a
	// distinct aria-label naming THAT band (e.g. "About Crushed") so the trigger
	// beside the headline never collides with the cluster-heading (i) above.
	const dominantInfo = $derived.by(() => {
		const i = metricInfoFor('occupancy', locale);
		return {
			...i,
			label: explainerCopy.info.trigger(dominant?.label ?? copy.clusters.crowding),
			linkLabel: explainerCopy.info.link,
		};
	});

	/* ── Delay by crowding (G1) ────────────────────────────────────────────────
	   Does crowding correlate with delay? The contract's per-band avg delay, laid
	   out on the FIXED occupancy axis (empty→full) so the reading is consistent and
	   honest about gaps. SPARSE: a band the contract omits, OR a present band whose
	   avg_delay is null, renders the explicit no-data message — NEVER a "·" or a
	   fake 0. Honest per-band absence is the explicit requirement. */
	const fmtMin = (v: number | null | undefined): string | null =>
		sharedFmtDelayMin(v, { rounding: 'fixed1' });

	// Index the sparse contract cells by band so the fixed-axis lookup is O(1). A
	// plain record (not a Map) keeps this a pure derived value with no reactivity.
	const delayByBand = $derived.by(() => {
		const index: Record<string, (typeof vm.delayByCrowding)[number]> = {};
		for (const cell of vm.delayByCrowding) index[cell.band] = cell;
		return index;
	});

	// The fixed occupancy axis, in natural order (empty→full). Each row resolves to
	// its delay display or the honest no-data message; `present` distinguishes a
	// contract-omitted band from a present-but-null one (both still honest, but the
	// secondary p50 is only meaningful for a present cell).
	const delayRows = $derived(
		OCCUPANCY_CODES.map((code: OccupancyCode) => {
			const cell = delayByBand[code];
			const display = fmtMin(cell?.avg_delay_min);
			// S7 P6: the avg delay is now a MAGNITUDE BAR on the fixed DELAY_POS_DOMAIN —
			// same delay reads the same length here as on the worst-stops list — sorted by
			// the fixed crowding axis so "more crowded → more delay" reads as a slope. The
			// p50 typical + the sample n (observation_count, day_count: computed-but-
			// unrendered until now) ride the subtitle as the honesty denominator.
			const p50 = fmtMin(cell?.p50_min);
			const n = cell?.observation_count ?? null;
			const typical = p50 ? copy.delayByCrowding.typical(p50) : null;
			const nNote = n != null ? `n=${n}` : null;
			return {
				code,
				label: bands[code],
				present: cell != null,
				display: display ?? copy.strip.noData,
				hasDelay: display != null,
				value: cell?.avg_delay_min ?? null,
				severity: delayMinToSeverity(cell?.avg_delay_min ?? null),
				subtitle: [typical, nNote].filter(Boolean).join(' · ') || undefined,
			};
		}),
	);

	// The delay sub-block has data when ANY band carries a real avg delay.
	const hasDelayByCrowding = $derived(delayRows.some((r) => r.hasDelay));
</script>

<section
	class="cluster-band"
	aria-labelledby="cluster04-crowding-label"
	data-slot="cluster-04-crowding"
>
	<span class="label-with-info">
		<SectionLabel id="cluster04-crowding-label" text={copy.clusters.crowding} variant="station" />
		<MetricInfo
			class="cluster-info"
			tip={occupancyInfo.tip}
			href={occupancyInfo.href}
			label={occupancyInfo.label}
			linkLabel={occupancyInfo.linkLabel}
			side="bottom"
		/>
	</span>
	<!-- Window caption: the occupancy mix is a fixed trailing window. -->
	<p class="crowding-window" data-slot="crowding-window">{copy.windows.crowding}</p>

	{#if dominant == null}
		<!-- Honest empty state: the styled honest-absence chip (says WHY, no telemetry), never a fake bar. -->
		<div data-slot="crowding-empty">
			<AbsentValue variant="block" reason="no-observations" {locale} />
		</div>
	{:else}
		<div class="crowding-headline-row">
			<MetricDisplay
				value={dominantPct}
				emptyLabel={copy.strip.noData}
				absentReason="no-observations"
				{locale}
				label={dominant.label}
				size="lg"
				class="crowding-headline"
			/>
			<MetricInfo
				class="cluster-info"
				tip={dominantInfo.tip}
				href={dominantInfo.href}
				label={dominantInfo.label}
				linkLabel={dominantInfo.linkLabel}
				side="bottom"
			/>
		</div>
		<!-- Interactive: each band's share reveals on hover/focus (#11). -->
		<StackedBar
			scale="occupancy"
			{segments}
			label={copy.clusters.crowding}
			size="sm"
			legend
			interactive
			class="crowding-bar"
		/>
	{/if}

	<!-- Delay by crowding (G1): per-band avg delay on the fixed occupancy axis. Lives
	     with the crowding cluster because it relates delay TO crowding. Rendered
	     independently of the mix empty-state so a route with delay data but no mix
	     still surfaces it. SPARSE: an absent band or a null delay shows the honest
	     no-data message in that cell, never a "·" / fake 0. -->
	<div class="crowding-delay" data-slot="delay-by-crowding">
		<SectionLabel text={copy.delayByCrowding.heading} variant="metric" />
		{#if hasDelayByCrowding}
			<ul class="crowding-delay-list" aria-label={copy.delayByCrowding.heading}>
				{#each delayRows as row (row.code)}
					<li data-slot="delay-by-crowding-row" data-band={row.code}>
						<RankedRow
							rank={0}
							title={row.label}
							subtitle={row.subtitle}
							severity={row.severity}
							value={row.value}
							domain={DELAY_POS_DOMAIN}
							unit=" min"
							showRank={false}
							display={row.hasDelay ? row.display : null}
							absentReason="no-observations"
							{locale}
						/>
					</li>
				{/each}
			</ul>
		{:else}
			<!-- Entirely absent → ONE honest no-data chip (says WHY), never a raw line / fake grid. -->
			<div data-slot="delay-by-crowding-empty">
				<AbsentValue variant="block" reason="no-observations" {locale} />
			</div>
		{/if}
	</div>

	{#if weekdayWeekendCols}
		<!-- S7 §04: weekday vs weekend occupancy split — a 2-col small multiple that
		     reflows to a single column on mobile. Each side is its own occupancy
		     StackedBar, or an honest no-data chip when that side has no telemetry. -->
		<div class="crowding-2col" data-slot="crowding-weekday-weekend">
			<SectionLabel text={copy.peak.dayType} variant="metric" />
			<div class="crowding-2col-grid">
				<div class="crowding-2col-cell" data-slot="crowding-weekday">
					<span class="crowding-2col-label">{copy.peak.weekday}</span>
					{#if weekdayWeekendCols.weekday.has}
						<StackedBar
							scale="occupancy"
							segments={weekdayWeekendCols.weekday.segs}
							label={copy.peak.weekday}
							size="sm"
							interactive
						/>
					{:else}
						<AbsentValue variant="block" reason="no-observations" {locale} />
					{/if}
				</div>
				<div class="crowding-2col-cell" data-slot="crowding-weekend">
					<span class="crowding-2col-label">{copy.peak.weekend}</span>
					{#if weekdayWeekendCols.weekend.has}
						<StackedBar
							scale="occupancy"
							segments={weekdayWeekendCols.weekend.segs}
							label={copy.peak.weekend}
							size="sm"
							interactive
						/>
					{:else}
						<AbsentValue variant="block" reason="no-observations" {locale} />
					{/if}
				</div>
			</div>
		</div>
	{/if}

	{#if weekdayStrips}
		<!-- P11 §04: per-ISO-weekday occupancy small multiple — up to 7 stacked strips,
		     Mon→Sun, on the SAME occupancy scale as the headline mix. A weekday with no
		     telemetry renders the honest no-data chip in the same box height, never a
		     fabricated bar. Reflows to fewer columns on narrow viewports. -->
		<div class="crowding-dow" data-slot="crowding-by-dow">
			<SectionLabel text={copy.byDow.heading} variant="metric" />
			<p class="crowding-dow-caption">{copy.byDow.caption}</p>
			<ul class="crowding-dow-grid" aria-label={copy.byDow.heading}>
				{#each weekdayStrips as day (day.iso)}
					<li class="crowding-dow-cell" data-slot="crowding-dow-cell" data-iso={day.iso}>
						<span class="crowding-dow-label">{day.label}</span>
						{#if day.has}
							<StackedBar
								scale="occupancy"
								segments={day.segs}
								label={day.label}
								size="sm"
								interactive
							/>
						{:else}
							<AbsentValue variant="block" reason="no-observations" {locale} />
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</section>

<style>
	.cluster-band {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-3, 0.75rem);
	}
	/* The cluster overline + its explainer (i), kept centred on the label. The label
	   keeps a measure (min-width:0) so a long overline wraps cleanly; the (i) wrapper
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

	/* S7 weekday/weekend 2-col: auto-fit so it's two columns on desktop and reflows
	   to a single column on mobile (each cell needs ~14rem before it shares a row). */
	.crowding-2col {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: var(--spacing-3, 0.75rem);
	}
	.crowding-2col-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(14rem, 100%), 1fr));
		gap: 1rem 1.5rem;
	}
	.crowding-2col-cell {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;
	}
	.crowding-2col-label {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	/* Window caption: quiet mono, AA both themes. */
	.crowding-window {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	/* The dominant-band headline + its explainer (i), kept on the tile's top edge.
	   The tile keeps a measure (min-width:0) so a long band label wraps cleanly; the
	   (i) wrapper never shrinks (flex:none) so the glyph stays whole beside it. */
	.crowding-headline-row {
		display: inline-flex;
		align-items: flex-start;
		gap: 0.35rem;
	}
	.crowding-headline-row :global([data-slot='metric-display']) {
		min-width: 0;
	}
	.crowding-headline-row :global(.cluster-info) {
		flex: none;
	}

	/* Delay-by-crowding sub-block: a quiet ranked-by-axis list (band label + its
	   avg delay), seated below the occupancy bar with its own overline. */
	.crowding-delay {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-2, 0.5rem);
		margin-top: var(--spacing-3, 0.75rem);
	}
	/* The delay-by-crowding bars (P6): RankedRow magnitude bars stacked in the fixed
	   occupancy order, so "more crowded → more delay" reads as a slope down the list. */
	.crowding-delay-list {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/* P11 per-ISO-weekday small multiple: a Mon→Sun grid of occupancy strips. auto-fit
	   so it packs as many ~9rem strips per row as fit (≈7 on a wide cluster, fewer on
	   narrow), each cell its own label + bar (or honest no-data chip). 8px-grid gaps. */
	.crowding-dow {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: var(--spacing-3, 0.75rem);
	}
	.crowding-dow-caption {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.crowding-dow-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(9rem, 100%), 1fr));
		gap: 1rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.crowding-dow-cell {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;
	}
	.crowding-dow-label {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
</style>
