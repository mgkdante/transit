<!--
  ScheduleTable — the ONE reusable schedule/departure row-list, extracted from
  StopDetail's two divergent renderings (P5.3e) so neither surface forks the
  markup, the column-major grid, or the delay-glyph presentation.

  Two modes over a discriminated row set:

    grid   STATIC — per-route blocks (route code + optional headsign) → a
                    COLUMN-MAJOR 5-col times grid (times read top→bottom then
                    across, driven by --sched-rows = ceil(shown/columns) +
                    grid-auto-flow:column). Caps at `cap` (default 30) with an
                    honest "+N more" note via `moreLabel`; a route listed with
                    NO times renders the honest AbsentValue chip, never a
                    silently empty block.

    board  LIVE   — per-departure rows (route · eta · delay caption). The delay
                    caption is COLOUR-CODED by the shared status scale AND carries
                    a redundant glyph (Chart Doctrine: never colour-only), with
                    delayLabel's plain-language text as the third channel. A null
                    delay rides the muted 'none' track (no fill, no glyph) —
                    absence never reads as an on-time claim.

  This component renders ONLY the row list. The GRID per-route empty is internal
  (AbsentValue). BOARD has NO whole-list empty/skeleton/filters/count — those stay
  with the caller (StopDetail owns the status/route chips, the count, the skeleton,
  and the filter-empty state). Faithful extraction: no redesign.

  Tokens only; the delay fills come EXCLUSIVELY from the shared delayPresentation
  --dataviz-status-* scale. Copy (moreLabel / delayCopy) is passed as props.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { formatUtc } from '$lib/utils/time';
	import {
		delayLabel,
		depTone,
		rowGlyph,
		rowColorVar,
		type DelayLabelCopy,
	} from '$lib/site/delayPresentation';
	import { AbsentValue } from '$lib/components/edge';

	/** A static per-route schedule block (route code + headsign + times). */
	export interface ScheduleGridRow {
		readonly kind: 'grid';
		readonly route: string;
		readonly headsign?: string | null;
		readonly times: string[];
	}

	/** A live departure row (route · eta · delay). */
	export interface ScheduleBoardRow {
		readonly kind: 'board';
		readonly route?: string | null;
		readonly eta_utc: string;
		readonly delay_min?: number | null;
		readonly trip?: string | null;
	}

	export type ScheduleRow = ScheduleGridRow | ScheduleBoardRow;

	export interface ScheduleTableProps {
		/** The row set — discriminated by `kind` (must match `mode`). */
		rows: ScheduleRow[];
		/** Which renderer to use for the row set. */
		mode: 'grid' | 'board';
		locale: Locale;
		/** GRID: per-route times cap (default 30). */
		cap?: number;
		/** GRID: column count of the column-major times grid (default 5). */
		columns?: number;
		/** GRID: "+N more times" overflow note builder. */
		moreLabel?: (n: number) => string;
		/** BOARD: the plain-language delay-label copy (t.next). */
		delayCopy?: DelayLabelCopy;
		/** BOARD: fallback route label when a departure has no route code (t.next.route). */
		routeFallback?: string;
	}

	let {
		rows,
		mode,
		locale,
		cap = 30,
		columns = 5,
		moreLabel,
		delayCopy,
		routeFallback,
	}: ScheduleTableProps = $props();

	const gridRows = $derived(rows.filter((r): r is ScheduleGridRow => r.kind === 'grid'));
	const boardRows = $derived(rows.filter((r): r is ScheduleBoardRow => r.kind === 'board'));

	// Defensive fallback so delayLabel always has copy even if a board caller omits
	// delayCopy — StopDetail always passes t.next, so this is never hit in practice.
	const EMPTY_DELAY_COPY: DelayLabelCopy = { early: () => '', late: () => '', onTime: '' };
</script>

{#if mode === 'grid'}
	{#each gridRows as entry, i (`${entry.route}-${entry.headsign ?? i}`)}
		{@const shown = entry.times.slice(0, cap)}
		<div class="stop-schedule-route">
			<div class="stop-schedule-route-head">
				<span class="stop-schedule-route-code">{entry.route}</span>
				{#if entry.headsign}
					<span class="stop-schedule-headsign">{entry.headsign}</span>
				{/if}
			</div>
			{#if shown.length > 0}
				<!-- B4: a COLUMN-MAJOR grid — times read top→bottom then across (the
				     operator's "vertical grid"). Both the column count (--sched-cols) and the
				     explicit row count (--sched-rows = ceil(shown/columns)) derive from the
				     `columns` prop + grid-auto-flow:column, so the prop is fully honored; it
				     collapses to a single readable column on mobile. -->
				<ul
					class="stop-schedule-times"
					style:--sched-cols={columns}
					style:--sched-rows={Math.ceil(shown.length / columns)}
				>
					{#each shown as time, ti (`${time}-${ti}`)}
						<li class="stop-schedule-time">{time}</li>
					{/each}
				</ul>
				{#if entry.times.length > cap}
					<p class="stop-schedule-time-more">
						{moreLabel?.(entry.times.length - cap)}
					</p>
				{/if}
			{:else}
				<!-- Honest absence: a route listed with NO scheduled times says so
				     explicitly instead of a silently empty block. -->
				<AbsentValue variant="inline" reason="no-observations" {locale} />
			{/if}
		</div>
	{/each}
{:else}
	<ul class="stop-departures">
		{#each boardRows as d, i (`${d.trip ?? d.route ?? 'dep'}-${d.eta_utc}-${i}`)}
			{@const tone = depTone(d.delay_min)}
			<li class="stop-departure">
				<span class="stop-departure-route">{d.route ?? routeFallback}</span>
				<span class="stop-departure-eta">{formatUtc(d.eta_utc, locale)}</span>
				<!-- The delay caption is COLOUR-CODED by the shared status scale AND
				     carries a redundant glyph (Doctrine: never colour-only), with the
				     plain-language delayLabel text as the third channel. A null delay
				     rides the muted 'none' track: no fill, no glyph — absence never
				     reads as an on-time claim. -->
				<span class="stop-departure-delay" style:color={rowColorVar(tone)} data-tone={tone}>
					{#if rowGlyph(tone)}<span class="stop-departure-glyph" aria-hidden="true"
							>{rowGlyph(tone)}</span
						>{/if}{delayLabel(d.delay_min, delayCopy ?? EMPTY_DELAY_COPY)}
				</span>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.stop-departures {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.stop-departure {
		display: flex;
		align-items: baseline;
		gap: 0.875rem;
		padding: 0.75rem 0.875rem;
		border-bottom: 1px solid var(--border-subtle, var(--border));
	}
	.stop-departure:last-child {
		border-bottom: none;
	}
	.stop-departure-route {
		font-family: var(--font-mono);
		font-weight: 700;
		font-size: var(--text-body);
		color: var(--accent-text);
		flex-shrink: 0;
		min-width: 3ch;
	}
	.stop-departure-eta {
		font-family: var(--font-mono);
		font-size: var(--text-body);
		color: var(--foreground);
		flex: 1 1 auto;
	}
	.stop-departure-delay {
		display: inline-flex;
		align-items: baseline;
		gap: 0.375rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		/* Fallback for the null/none case (no realtime delta beyond on-time) — the inline
		   style:color from toneColorVar overrides this when a tone resolves a status fill. */
		color: var(--muted-foreground);
		flex-shrink: 0;
	}
	/* The redundant status glyph beside the delay caption (colour + glyph, never
	   colour-only). Inherits the caption's tone colour via the inline style. */
	.stop-departure-glyph {
		font-size: var(--text-micro);
		line-height: 1;
	}

	.stop-schedule-route {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.stop-schedule-route-head {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}
	.stop-schedule-route-code {
		font-family: var(--font-mono);
		font-weight: 700;
		color: var(--accent-text);
	}
	.stop-schedule-headsign {
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	/* B4: a COLUMN-MAJOR grid. grid-auto-flow:column + an explicit row count
	   (--sched-rows = ceil(shown/columns)) fills top→bottom then left→right, so the times
	   read vertically down each column (the operator's "vertical grid"). The column count
	   comes from --sched-cols (the `columns` prop, default 5). */
	.stop-schedule-times {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(var(--sched-cols, 5), minmax(0, 1fr));
		grid-template-rows: repeat(var(--sched-rows, 1), auto);
		grid-auto-flow: column;
		gap: 0.375rem 0.75rem;
	}
	.stop-schedule-time {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
	}
	.stop-schedule-time-more {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	/* Mobile: a dense 5-col grid is unreadable on a phone — collapse to a single column
	   (row-major again, since there is one column). */
	@media (max-width: 48rem) {
		.stop-schedule-times {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: none;
			grid-auto-flow: row;
		}
	}
</style>
