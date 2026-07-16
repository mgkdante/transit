<!--
  ScheduleTable — one semantic timetable chassis for rider-facing schedule data.

  The three modes keep their own row contracts while sharing the same caption,
  scoped headers, row rhythm, mobile overflow and tabular-number treatment:

    grid     planned departures grouped by route and destination
    board    live departures with scheduled/estimated time and realtime status
    service  planned line service periods and headways

  Empty cells remain explicit through AbsentValue. The component owns table
  semantics only; filters, loading, whole-table empty states and disclosures stay
  with the caller.
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

	export interface ScheduleGridRow {
		readonly kind: 'grid';
		readonly route: string;
		readonly headsign?: string | null;
		readonly times: string[];
	}

	export interface ScheduleBoardRow {
		readonly kind: 'board';
		readonly route?: string | null;
		readonly eta_utc: string;
		readonly delay_min?: number | null;
		readonly trip?: string | null;
	}

	export interface ScheduleServiceRow {
		readonly kind: 'service';
		readonly period: string;
		readonly window?: string | null;
		readonly headway?: string | null;
	}

	export type ScheduleRow = ScheduleGridRow | ScheduleBoardRow | ScheduleServiceRow;

	export interface ScheduleTableLabels {
		readonly caption: string;
		readonly route?: string;
		readonly destination?: string;
		readonly departures?: string;
		readonly departure?: string;
		readonly status?: string;
		readonly period?: string;
		readonly window?: string;
		readonly headway?: string;
	}

	export interface ScheduleTableProps {
		rows: ScheduleRow[];
		mode: 'grid' | 'board' | 'service';
		locale: Locale;
		labels: ScheduleTableLabels;
		cap?: number;
		moreLabel?: (n: number) => string;
		delayCopy?: DelayLabelCopy;
		routeFallback?: string;
	}

	let {
		rows,
		mode,
		locale,
		labels,
		cap = 30,
		moreLabel,
		delayCopy,
		routeFallback,
	}: ScheduleTableProps = $props();

	const gridRows = $derived(rows.filter((row): row is ScheduleGridRow => row.kind === 'grid'));
	const boardRows = $derived(rows.filter((row): row is ScheduleBoardRow => row.kind === 'board'));
	const serviceRows = $derived(
		rows.filter((row): row is ScheduleServiceRow => row.kind === 'service'),
	);
	const EMPTY_DELAY_COPY: DelayLabelCopy = { early: () => '', late: () => '', onTime: '' };
</script>

<div class="schedule-table-frame" data-mode={mode}>
	<table class="schedule-table">
		<caption>{labels.caption}</caption>
		<thead>
			<tr>
				{#if mode === 'grid'}
					<th scope="col">{labels.route}</th>
					<th scope="col">{labels.destination}</th>
					<th scope="col">{labels.departures}</th>
				{:else if mode === 'board'}
					<th scope="col">{labels.route}</th>
					<th scope="col">{labels.departure}</th>
					<th scope="col">{labels.status}</th>
				{:else}
					<th scope="col">{labels.period}</th>
					<th scope="col">{labels.window}</th>
					<th scope="col">{labels.headway}</th>
				{/if}
			</tr>
		</thead>
		<tbody>
			{#if mode === 'grid'}
				{#each gridRows as entry, i (`${entry.route}-${entry.headsign ?? i}`)}
					{@const shown = entry.times.slice(0, cap)}
					<tr>
						<th class="schedule-route" scope="row">{entry.route}</th>
						<td class="schedule-destination">
							{#if entry.headsign}
								{entry.headsign}
							{:else}
								<AbsentValue variant="inline" reason="no-observations" {locale} />
							{/if}
						</td>
						<td>
							{#if shown.length > 0}
								<ul class="stop-schedule-times">
									{#each shown as time, ti (`${time}-${ti}`)}
										<li class="stop-schedule-time"><time datetime={time}>{time}</time></li>
									{/each}
								</ul>
								{#if entry.times.length > cap}
									<p class="stop-schedule-time-more">
										{moreLabel?.(entry.times.length - cap)}
									</p>
								{/if}
							{:else}
								<AbsentValue variant="inline" reason="no-observations" {locale} />
							{/if}
						</td>
					</tr>
				{/each}
			{:else if mode === 'board'}
				{#each boardRows as departure, i (`${departure.trip ?? departure.route ?? 'dep'}-${departure.eta_utc}-${i}`)}
					{@const tone = depTone(departure.delay_min)}
					<tr>
						<th class="stop-departure-route" scope="row">
							{departure.route ?? routeFallback}
						</th>
						<td class="stop-departure-eta">
							<time datetime={departure.eta_utc}>{formatUtc(departure.eta_utc, locale)}</time>
						</td>
						<td>
							<span class="stop-departure-delay" style:color={rowColorVar(tone)} data-tone={tone}>
								{#if rowGlyph(tone)}<span class="stop-departure-glyph" aria-hidden="true"
										>{rowGlyph(tone)}</span
									>{/if}{delayLabel(departure.delay_min, delayCopy ?? EMPTY_DELAY_COPY)}
							</span>
						</td>
					</tr>
				{/each}
			{:else}
				{#each serviceRows as service, i (`${service.period}-${i}`)}
					<tr>
						<th class="schedule-period" scope="row">{service.period}</th>
						<td>
							{#if service.window}
								{service.window}
							{:else}
								<AbsentValue variant="inline" reason="not-in-schedule" {locale} />
							{/if}
						</td>
						<td>
							{#if service.headway}
								{service.headway}
							{:else}
								<AbsentValue variant="inline" reason="not-in-schedule" {locale} />
							{/if}
						</td>
					</tr>
				{/each}
			{/if}
		</tbody>
	</table>
</div>

<style>
	.schedule-table-frame {
		width: 100%;
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface-2);
	}
	.schedule-table {
		width: 100%;
		min-width: 34rem;
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
	}
	.schedule-table-frame[data-mode='grid'] .schedule-table {
		min-width: 42rem;
	}
	.schedule-table caption {
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
	.schedule-table thead {
		background: var(--terminal-chrome);
	}
	.schedule-table th,
	.schedule-table td {
		padding: 0.8rem 1rem;
		border-bottom: 1px solid var(--border-subtle, var(--border));
		text-align: left;
		vertical-align: top;
	}
	.schedule-table thead th {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		line-height: 1.25;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		white-space: nowrap;
		color: var(--muted-foreground);
	}
	.schedule-table-frame[data-mode='grid'] th:first-child {
		width: 6rem;
	}
	.schedule-table-frame[data-mode='grid'] th:nth-child(2) {
		width: 11rem;
	}
	.schedule-table tbody tr:last-child > * {
		border-bottom: 0;
	}
	.schedule-table tbody th,
	.schedule-table tbody td {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.45;
		color: var(--foreground);
	}
	.schedule-table tbody th {
		font-weight: 700;
		color: var(--accent-text);
	}
	.stop-schedule-times {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.stop-schedule-time time {
		display: inline-flex;
		align-items: center;
		min-height: 2rem;
		padding: 0.25rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--background);
	}
	.stop-schedule-time-more {
		margin: 0.5rem 0 0;
		color: var(--muted-foreground);
	}
	.stop-departure-delay {
		display: inline-flex;
		align-items: baseline;
		gap: 0.375rem;
		white-space: nowrap;
		color: var(--muted-foreground);
	}
	.stop-departure-glyph {
		font-size: var(--text-micro);
		line-height: 1;
	}
	@media (max-width: 48rem) {
		.schedule-table,
		.schedule-table-frame[data-mode='grid'] .schedule-table {
			min-width: 32rem;
		}
		.schedule-table th,
		.schedule-table td {
			padding: 0.7rem 0.75rem;
		}
	}
</style>
