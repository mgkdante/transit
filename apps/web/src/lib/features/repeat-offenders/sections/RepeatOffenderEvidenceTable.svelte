<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import DataTable, { type DataTableColumn } from '$lib/components/data/DataTable.svelte';
	import { MaybeValue } from '$lib/components/edge';
	import type { OffenderEvidenceRow } from '../selectors/offenderEvidence';
	import type { RepeatOffendersCopy } from '../repeatOffenders.copy';

	interface RepeatOffenderEvidenceTableProps {
		readonly rows: readonly OffenderEvidenceRow[];
		readonly locale: Locale;
		readonly copy: RepeatOffendersCopy;
	}

	let { rows, locale, copy }: RepeatOffenderEvidenceTableProps = $props();
</script>

{#snippet offenderItemCell(row: OffenderEvidenceRow)}
	{#if row.href}
		<a
			class="offender-evidence-link"
			href={row.href}
			aria-label={row.ariaLabel}
			data-sveltekit-preload-data="hover">{row.title}</a
		>
	{:else}
		{row.title}
	{/if}
{/snippet}

{#snippet offenderTypeIdCell(row: OffenderEvidenceRow)}
	{row.typeId}
{/snippet}

{#snippet offenderSevereRateCell(row: OffenderEvidenceRow)}
	<MaybeValue value={row.severeRate} reason="no-observations" {locale} />
	{#if row.confidenceInterval != null}
		<span class="offender-evidence-ci">
			{copy.ladder.ci}
			{row.confidenceInterval}
		</span>
	{/if}
{/snippet}

{#snippet offenderRecurrenceCell(row: OffenderEvidenceRow)}
	{row.recurrence}
{/snippet}

{#snippet offenderAverageDelayCell(row: OffenderEvidenceRow)}
	<MaybeValue value={row.averageDelay} reason="no-observations" {locale} />
{/snippet}

{#snippet offenderReadingsCell(row: OffenderEvidenceRow)}
	<MaybeValue value={row.readings} reason="no-observations" {locale} />
{/snippet}

<DataTable
	{rows}
	columns={[
		{
			key: 'item',
			header: copy.evidenceTable.columns.item,
			rowHeader: true,
			cell: offenderItemCell,
		},
		{
			key: 'type-id',
			header: copy.evidenceTable.columns.typeId,
			cell: offenderTypeIdCell,
		},
		{
			key: 'severe-rate',
			header: copy.evidenceTable.columns.severeRate,
			numeric: true,
			cell: offenderSevereRateCell,
		},
		{
			key: 'recurrence',
			header: copy.evidenceTable.columns.recurrence,
			cell: offenderRecurrenceCell,
		},
		{
			key: 'average-delay',
			header: copy.evidenceTable.columns.averageDelay,
			numeric: true,
			cell: offenderAverageDelayCell,
		},
		{
			key: 'readings',
			header: copy.evidenceTable.columns.readings,
			numeric: true,
			cell: offenderReadingsCell,
		},
	] satisfies readonly DataTableColumn<OffenderEvidenceRow>[]}
	key={(row) => row.key}
	caption={copy.evidenceTable.caption}
	responsive={{ mode: 'stack', at: 'tablet' }}
	frame="none"
	borderCollapse="collapse"
	headerBand="none"
	tableAttrs={{ class: 'offender-evidence-table', 'data-slot': 'offender-evidence-table' }}
/>

<style>
	:global(table.offender-evidence-table.data-table) {
		font-size: var(--text-detail-body-mobile);
	}
	.offender-evidence-link {
		border-radius: var(--radius-sm);
		text-decoration: none;
		color: inherit;
	}
	.offender-evidence-link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.offender-evidence-ci {
		display: block;
		margin-top: 0.125rem;
		font-size: var(--text-micro);
		color: var(--muted-foreground);
	}
	@media (min-width: 1024px) {
		:global(table.offender-evidence-table.data-table) {
			font-size: var(--text-detail-body-desktop);
		}
	}
</style>
