<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import DataTable, { type DataTableColumn } from '$lib/components/data/DataTable.svelte';
	import { StateNotice } from '$lib/components/edge';
	import { formatDateKey } from '$lib/utils/time';
	import type { HealthCopy } from '../health.copy';
	import type {
		HistoryCoverageFamilyView,
		HistoryCoverageGapView,
	} from '../selectors/historyCoverage';

	interface SectionHistoryCoverageProps {
		rows: readonly HistoryCoverageFamilyView[];
		copy: HealthCopy;
		locale: Locale;
	}

	let { rows, copy, locale }: SectionHistoryCoverageProps = $props();
	const t = $derived(copy.historyCoverage);

	function windowLabel(first: string | null, last: string | null): string {
		if (first == null || last == null) return t.noCoverage;
		return `${formatDateKey(first, locale)} – ${formatDateKey(last, locale)}`;
	}

	function sectionLabel(key: string): string {
		return t.currentOnlySectionLabels[key] ?? key.replaceAll('_', ' ');
	}
</script>

{#snippet gapList(items: readonly HistoryCoverageGapView[] | null)}
	{#if items == null}
		<StateNotice title={t.noGapInventory} presentation="pill" />
	{:else if items.length > 0}
		<ul class="gap-list">
			{#each items as gap (`${gap.startDate}:${gap.endDate}:${gap.reason ?? ''}`)}
				<li>
					<span class="gap-dates">{windowLabel(gap.startDate, gap.endDate)}</span>
					{#if gap.reason}<span class="gap-reason">{gap.reason}</span>{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<StateNotice title={t.noDeclaredGaps} glyph="●" tone="positive" presentation="pill" />
	{/if}
{/snippet}

{#snippet familyCell(row: HistoryCoverageFamilyView)}
	<span class="family-name">{t.families[row.key]}</span>
	{#if !row.published}<StateNotice title={t.unavailable} presentation="pill" />{/if}
{/snippet}

{#snippet windowCell(row: HistoryCoverageFamilyView)}
	{#if row.published}
		{#if row.firstDate && row.lastDate}
			<span class="window-value">{windowLabel(row.firstDate, row.lastDate)}</span>
		{:else}
			<StateNotice title={t.noCoverage} presentation="pill" />
		{/if}
	{:else}
		<StateNotice title={t.noCoverage} presentation="pill" />
	{/if}
{/snippet}

{#snippet selectionCell(row: HistoryCoverageFamilyView)}
	{#if row.selectionMode}
		<span class="selection-chip">{t.selection[row.selectionMode]}</span>
	{:else}
		<StateNotice title={t.unavailable} presentation="pill" />
	{/if}
{/snippet}

{#snippet detailsCell(row: HistoryCoverageFamilyView)}
	<div class="coverage-details">
		{#if row.published}
			<div class="detail-group">
				<span class="detail-label">{t.familyGaps}</span>
				{@render gapList(row.gaps)}
			</div>
			<div class="detail-group">
				<span class="detail-label">{t.metricCoverage}</span>
				{#if row.metrics.length > 0}
					<ul class="metric-list">
						{#each row.metrics as metric (metric.key)}
							<li class="metric-row" data-metric={metric.key} data-aggregation={metric.aggregation}>
								<div class="metric-head">
									<span class="metric-name">{t.metrics[metric.key]}</span>
									<span class="aggregation-chip">{t.aggregation[metric.aggregation]}</span>
								</div>
								{#if metric.firstDate && metric.lastDate}
									<span class="metric-window">{windowLabel(metric.firstDate, metric.lastDate)}</span
									>
								{:else}
									<StateNotice title={t.noCoverage} presentation="pill" />
								{/if}
								{@render gapList(metric.gaps)}
							</li>
						{/each}
					</ul>
				{:else}
					<StateNotice title={t.noMetricInventory} presentation="pill" />
				{/if}
			</div>
		{/if}
		{#if row.currentOnlySections.length > 0}
			<div class="detail-group current-only" data-slot="current-only-limitations">
				<span class="detail-label">{t.currentOnlySections}</span>
				<p>{t.currentOnlyNote}</p>
				<ul class="current-only-list">
					{#each row.currentOnlySections as section (section)}
						<li>{sectionLabel(section)}</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>
{/snippet}

<div class="coverage-block" data-slot="history-coverage-section">
	<p class="coverage-note">{t.note}</p>
	<DataTable
		{rows}
		columns={[
			{
				key: 'family',
				header: t.columns.family,
				rowHeader: true,
				width: '15%',
				cell: familyCell,
			},
			{
				key: 'window',
				header: t.columns.window,
				width: '18%',
				cell: windowCell,
			},
			{
				key: 'selection',
				header: t.columns.selection,
				width: '17%',
				cell: selectionCell,
			},
			{
				key: 'details',
				header: t.columns.details,
				cell: detailsCell,
			},
		] satisfies readonly DataTableColumn<HistoryCoverageFamilyView>[]}
		key={(row) => row.key}
		caption={t.tableLabel}
		responsive={{ mode: 'stack', at: 'tablet' }}
		frame="card"
		borderCollapse="separate"
		frameRadius={true}
		headerBand="none"
		tableAttrs={{ class: 'coverage-table', 'data-slot': 'history-coverage-table' }}
	/>
</div>

<style>
	.coverage-block {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 0;
	}
	.coverage-note {
		margin: 0;
		max-width: 68ch;
		color: var(--muted-foreground);
		font-size: var(--text-detail-body-mobile);
		line-height: 1.8;
	}
	:global(table.coverage-table.data-table) {
		font-size: inherit;
	}
	:global(table.coverage-table.data-table th),
	:global(table.coverage-table.data-table td) {
		padding: 0.875rem;
	}
	:global(table.coverage-table.data-table tbody td) {
		font-family: inherit;
	}
	:global(table.coverage-table.data-table tbody tr + tr > *) {
		border-top-color: var(--border);
	}
	.family-name,
	.window-value,
	.metric-name {
		display: block;
		color: var(--foreground);
		font-weight: 700;
	}
	.window-value,
	.metric-window,
	.gap-dates {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-variant-numeric: tabular-nums;
	}
	.gap-reason,
	.metric-window {
		display: block;
		margin-top: 0.25rem;
		color: var(--muted-foreground);
		font-size: var(--text-caption);
		line-height: 1.45;
	}
	.selection-chip,
	.aggregation-chip {
		display: inline-flex;
		max-width: 100%;
		padding: 0.2rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		background: var(--muted);
		color: var(--foreground);
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1.35;
	}
	.coverage-details,
	.detail-group,
	.metric-row {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		min-width: 0;
	}
	.coverage-details {
		gap: 0.9rem;
	}
	.detail-label {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.gap-list,
	.metric-list,
	.current-only-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.gap-list,
	.current-only-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 0.75rem;
	}
	.gap-list li {
		min-width: 0;
	}
	.metric-list {
		display: grid;
		gap: 0.75rem;
	}
	.metric-row {
		padding-top: 0.7rem;
		border-top: 1px dashed var(--border);
	}
	.metric-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.current-only p {
		margin: 0;
		color: var(--muted-foreground);
		font-size: var(--text-caption);
		line-height: 1.5;
	}
	.current-only-list li {
		padding: 0.15rem 0.45rem;
		border-radius: var(--radius-md);
		background: var(--muted);
		color: var(--secondary-foreground);
		font-size: var(--text-caption);
	}

	@media (max-width: 1023px) {
		:global(
			.data-table-frame[data-responsive='stack'][data-stack-at='tablet']
				table.coverage-table.data-table
				tbody
				tr
		) {
			padding: 0;
		}
		:global(
			.data-table-frame[data-responsive='stack'][data-stack-at='tablet']
				table.coverage-table.data-table
				tbody
				th
		),
		:global(
			.data-table-frame[data-responsive='stack'][data-stack-at='tablet']
				table.coverage-table.data-table
				tbody
				td
		) {
			grid-template-columns: minmax(6.5rem, 0.35fr) minmax(0, 1fr);
			gap: 0.75rem;
			padding: 0.875rem;
			border-bottom: 1px solid var(--border);
		}
		:global(
			.data-table-frame[data-responsive='stack'][data-stack-at='tablet']
				table.coverage-table.data-table
				tbody
				tr
				> :last-child
		) {
			border-bottom: 0;
		}
	}

	@media (min-width: 1024px) {
		.coverage-note {
			font-size: var(--text-detail-body-desktop);
			line-height: 1.9;
		}
	}
</style>
