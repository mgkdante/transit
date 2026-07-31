<!--
  ScheduleTable — one semantic timetable chassis for rider-facing schedule data.

  The three modes keep their own row contracts while sharing the same caption,
  scoped headers, row rhythm and mobile overflow; tabular numerics ride the
  numeric columns only (DataTable's data-numeric law - S5-386 F3):

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
	import DataTable, { type DataTableColumn } from '$lib/components/data/DataTable.svelte';
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

{#snippet gridRouteCell(entry: ScheduleGridRow)}
	<span class="schedule-route">{entry.route}</span>
{/snippet}

{#snippet gridDestinationCell(entry: ScheduleGridRow)}
	<span class="schedule-destination">
		{#if entry.headsign}
			{entry.headsign}
		{:else}
			<AbsentValue variant="inline" reason="no-observations" {locale} />
		{/if}
	</span>
{/snippet}

{#snippet gridDeparturesCell(entry: ScheduleGridRow)}
	{@const shown = entry.times.slice(0, cap)}
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
{/snippet}

{#snippet boardRouteCell(departure: ScheduleBoardRow)}
	<span class="stop-departure-route">{departure.route ?? routeFallback}</span>
{/snippet}

{#snippet boardDepartureCell(departure: ScheduleBoardRow)}
	<span class="stop-departure-eta">
		<time datetime={departure.eta_utc}>{formatUtc(departure.eta_utc, locale)}</time>
	</span>
{/snippet}

{#snippet boardStatusCell(departure: ScheduleBoardRow)}
	{@const tone = depTone(departure.delay_min)}
	<span class="stop-departure-delay" style:color={rowColorVar(tone)} data-tone={tone}>
		{#if rowGlyph(tone)}<span class="stop-departure-glyph" aria-hidden="true">{rowGlyph(tone)}</span
			>{/if}{delayLabel(departure.delay_min, delayCopy ?? EMPTY_DELAY_COPY)}
	</span>
{/snippet}

{#snippet servicePeriodCell(service: ScheduleServiceRow)}
	<span class="schedule-period">{service.period}</span>
{/snippet}

{#snippet serviceWindowCell(service: ScheduleServiceRow)}
	{#if service.window}
		{service.window}
	{:else}
		<AbsentValue variant="inline" reason="not-in-schedule" {locale} />
	{/if}
{/snippet}

{#snippet serviceHeadwayCell(service: ScheduleServiceRow)}
	{#if service.headway}
		{service.headway}
	{:else}
		<AbsentValue variant="inline" reason="not-in-schedule" {locale} />
	{/if}
{/snippet}

{#if mode === 'grid'}
	<DataTable
		rows={gridRows}
		columns={[
			{
				key: 'route',
				header: labels.route ?? '',
				rowHeader: true,
				width: '6rem',
				cell: gridRouteCell,
			},
			{
				key: 'destination',
				header: labels.destination ?? '',
				width: '11rem',
				cell: gridDestinationCell,
			},
			{
				key: 'departures',
				header: labels.departures ?? '',
				numeric: true,
				cell: gridDeparturesCell,
			},
		] satisfies readonly DataTableColumn<ScheduleGridRow>[]}
		key={(entry, i) => `${entry.route}-${entry.headsign ?? i}`}
		caption={labels.caption}
		responsive={{
			mode: 'scroll',
			minWidth: '42rem',
			minWidthCompact: '32rem',
			scrollLabel: labels.caption,
		}}
		frame="card"
		borderCollapse="collapse"
		frameRadius={true}
		headerBand="terminal"
		tableAttrs={{ class: 'schedule-table' }}
		frameAttrs={{ class: 'schedule-table-frame', 'data-mode': mode }}
	/>
{:else if mode === 'board'}
	<DataTable
		rows={boardRows}
		columns={[
			{
				key: 'route',
				header: labels.route ?? '',
				rowHeader: true,
				cell: boardRouteCell,
			},
			{
				key: 'departure',
				header: labels.departure ?? '',
				numeric: true,
				cell: boardDepartureCell,
			},
			{
				key: 'status',
				header: labels.status ?? '',
				cell: boardStatusCell,
			},
		] satisfies readonly DataTableColumn<ScheduleBoardRow>[]}
		key={(departure, i) =>
			`${departure.trip ?? departure.route ?? 'dep'}-${departure.eta_utc}-${i}`}
		caption={labels.caption}
		responsive={{
			mode: 'scroll',
			minWidth: '34rem',
			minWidthCompact: '32rem',
			scrollLabel: labels.caption,
		}}
		frame="card"
		borderCollapse="collapse"
		frameRadius={true}
		headerBand="terminal"
		tableAttrs={{ class: 'schedule-table' }}
		frameAttrs={{ class: 'schedule-table-frame', 'data-mode': mode }}
	/>
{:else}
	<DataTable
		rows={serviceRows}
		columns={[
			{
				key: 'period',
				header: labels.period ?? '',
				rowHeader: true,
				cell: servicePeriodCell,
			},
			{
				key: 'window',
				header: labels.window ?? '',
				numeric: true,
				cell: serviceWindowCell,
			},
			{
				key: 'headway',
				header: labels.headway ?? '',
				numeric: true,
				cell: serviceHeadwayCell,
			},
		] satisfies readonly DataTableColumn<ScheduleServiceRow>[]}
		key={(service, i) => `${service.period}-${i}`}
		caption={labels.caption}
		responsive={{
			mode: 'scroll',
			minWidth: '34rem',
			minWidthCompact: '32rem',
			scrollLabel: labels.caption,
		}}
		frame="card"
		borderCollapse="collapse"
		frameRadius={true}
		headerBand="terminal"
		tableAttrs={{ class: 'schedule-table' }}
		frameAttrs={{ class: 'schedule-table-frame', 'data-mode': mode }}
	/>
{/if}

<style>
	:global(.schedule-table-frame.data-table-frame[data-frame='card']) {
		background: var(--surface-2);
	}
	:global(.schedule-table.data-table th),
	:global(.schedule-table.data-table td) {
		padding: 0.8rem 1rem;
		border-bottom: 1px solid var(--border-subtle, var(--border));
		vertical-align: top;
	}
	:global(.schedule-table.data-table thead th) {
		white-space: nowrap;
	}
	:global(.schedule-table.data-table tbody tr + tr > *) {
		border-top: 0;
	}
	:global(.schedule-table.data-table tbody tr:last-child > *) {
		border-bottom: 0;
	}
	:global(.schedule-table.data-table tbody th),
	:global(.schedule-table.data-table tbody td) {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.45;
		color: var(--foreground);
	}
	:global(.schedule-table.data-table tbody th) {
		font-weight: 700;
		color: var(--accent-text);
	}
	.stop-schedule-times {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
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
		:global(.schedule-table.data-table th),
		:global(.schedule-table.data-table td) {
			padding: 0.7rem 0.75rem;
		}
	}
</style>
