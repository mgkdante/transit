<script lang="ts">
	import type { Locale } from '$lib/i18n';
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

<div class="coverage-block" data-slot="history-coverage-section">
	<p class="coverage-note">{t.note}</p>
	<table class="coverage-table" aria-label={t.tableLabel}>
		<thead>
			<tr>
				<th scope="col">{t.columns.family}</th>
				<th scope="col">{t.columns.window}</th>
				<th scope="col">{t.columns.selection}</th>
				<th scope="col">{t.columns.details}</th>
			</tr>
		</thead>
		<tbody>
			{#each rows as row (row.key)}
				<tr data-family={row.key} data-published={row.published}>
					<th scope="row" data-label={t.columns.family}>
						<span class="family-name">{t.families[row.key]}</span>
						{#if !row.published}<StateNotice title={t.unavailable} presentation="pill" />{/if}
					</th>
					<td data-label={t.columns.window}>
						{#if row.published}
							{#if row.firstDate && row.lastDate}
								<span class="window-value">{windowLabel(row.firstDate, row.lastDate)}</span>
							{:else}
								<StateNotice title={t.noCoverage} presentation="pill" />
							{/if}
						{:else}
							<StateNotice title={t.noCoverage} presentation="pill" />
						{/if}
					</td>
					<td data-label={t.columns.selection}>
						{#if row.selectionMode}
							<span class="selection-chip">{t.selection[row.selectionMode]}</span>
						{:else}
							<StateNotice title={t.unavailable} presentation="pill" />
						{/if}
					</td>
					<td data-label={t.columns.details}>
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
												<li
													class="metric-row"
													data-metric={metric.key}
													data-aggregation={metric.aggregation}
												>
													<div class="metric-head">
														<span class="metric-name">{t.metrics[metric.key]}</span>
														<span class="aggregation-chip">{t.aggregation[metric.aggregation]}</span
														>
													</div>
													{#if metric.firstDate && metric.lastDate}
														<span class="metric-window"
															>{windowLabel(metric.firstDate, metric.lastDate)}</span
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
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
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
	.coverage-table {
		width: 100%;
		table-layout: fixed;
		border-collapse: separate;
		border-spacing: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--card);
	}
	.coverage-table th,
	.coverage-table td {
		min-width: 0;
		padding: 0.875rem;
		vertical-align: top;
		text-align: left;
		overflow-wrap: anywhere;
		border-bottom: 1px solid var(--border);
	}
	.coverage-table thead th {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		font-weight: 600;
		letter-spacing: var(--tracking-eyebrow);
		text-transform: uppercase;
		color: var(--muted-foreground);
		background: var(--muted);
	}
	.coverage-table thead th:first-child {
		border-top-left-radius: calc(var(--radius-lg) - 1px);
	}
	.coverage-table thead th:last-child {
		border-top-right-radius: calc(var(--radius-lg) - 1px);
	}
	.coverage-table tbody tr:last-child > * {
		border-bottom: 0;
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
		.coverage-table,
		.coverage-table tbody {
			display: grid;
			gap: 0.75rem;
			border: 0;
			background: transparent;
			box-shadow: none;
		}
		.coverage-table thead {
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
		.coverage-table tbody tr {
			display: grid;
			grid-template-columns: minmax(0, 1fr);
			border: 1px solid var(--border);
			border-radius: var(--radius-lg);
			background: var(--card);
		}
		.coverage-table th,
		.coverage-table td {
			display: grid;
			grid-template-columns: minmax(6.5rem, 0.35fr) minmax(0, 1fr);
			gap: 0.75rem;
			width: auto;
			border-bottom: 1px solid var(--border);
		}
		.coverage-table th::before,
		.coverage-table td::before {
			content: attr(data-label);
			font-family: var(--font-mono);
			font-size: var(--text-caption);
			font-weight: 600;
			letter-spacing: var(--tracking-eyebrow);
			text-transform: uppercase;
			color: var(--muted-foreground);
		}
		.coverage-table tbody tr > :last-child {
			border-bottom: 0;
		}
	}

	@media (min-width: 1024px) {
		.coverage-table th:nth-child(1) {
			width: 15%;
		}
		.coverage-table th:nth-child(2) {
			width: 18%;
		}
		.coverage-table th:nth-child(3) {
			width: 17%;
		}
		.coverage-note {
			font-size: var(--text-detail-body-desktop);
			line-height: 1.9;
		}
	}
</style>
