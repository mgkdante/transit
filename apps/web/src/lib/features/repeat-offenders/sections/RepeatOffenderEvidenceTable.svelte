<script lang="ts">
	import type { Locale } from '$lib/i18n';
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

<table class="offender-evidence-table" data-slot="offender-evidence-table">
	<caption class="sr-only">{copy.evidenceTable.caption}</caption>
	<thead>
		<tr>
			<th scope="col">{copy.evidenceTable.columns.item}</th>
			<th scope="col">{copy.evidenceTable.columns.typeId}</th>
			<th scope="col">{copy.evidenceTable.columns.severeRate}</th>
			<th scope="col">{copy.evidenceTable.columns.recurrence}</th>
			<th scope="col">{copy.evidenceTable.columns.averageDelay}</th>
			<th scope="col">{copy.evidenceTable.columns.readings}</th>
		</tr>
	</thead>
	<tbody>
		{#each rows as row (row.key)}
			<tr>
				<th scope="row" data-col={copy.evidenceTable.columns.item}>
					{#if row.href}
						<a href={row.href} aria-label={row.ariaLabel} data-sveltekit-preload-data="hover"
							>{row.title}</a
						>
					{:else}
						{row.title}
					{/if}
				</th>
				<td data-col={copy.evidenceTable.columns.typeId}>{row.typeId}</td>
				<td class="offender-evidence-metric" data-col={copy.evidenceTable.columns.severeRate}>
					<MaybeValue value={row.severeRate} reason="no-observations" {locale} />
					{#if row.confidenceInterval != null}
						<span class="offender-evidence-ci">
							{copy.ladder.ci}
							{row.confidenceInterval}
						</span>
					{/if}
				</td>
				<td data-col={copy.evidenceTable.columns.recurrence}>{row.recurrence}</td>
				<td class="offender-evidence-metric" data-col={copy.evidenceTable.columns.averageDelay}>
					<MaybeValue value={row.averageDelay} reason="no-observations" {locale} />
				</td>
				<td class="offender-evidence-metric" data-col={copy.evidenceTable.columns.readings}>
					<MaybeValue value={row.readings} reason="no-observations" {locale} />
				</td>
			</tr>
		{/each}
	</tbody>
</table>

<style>
	.offender-evidence-table {
		width: 100%;
		margin: 0;
		border-collapse: collapse;
		font-size: var(--text-detail-body-mobile);
		overflow-wrap: anywhere;
	}
	.offender-evidence-table th,
	.offender-evidence-table td {
		padding: 0.5rem;
		text-align: left;
		vertical-align: top;
	}
	.offender-evidence-table thead th {
		border-bottom: 1px solid var(--border);
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 500;
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.offender-evidence-table th[scope='row'] {
		font-weight: 500;
		color: var(--foreground);
	}
	.offender-evidence-table tbody tr + tr th,
	.offender-evidence-table tbody tr + tr td {
		border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
	}
	.offender-evidence-table td {
		font-family: var(--font-mono);
		color: var(--foreground);
	}
	.offender-evidence-table a {
		border-radius: var(--radius-sm);
		text-decoration: none;
		color: inherit;
	}
	.offender-evidence-table a:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.offender-evidence-metric {
		font-variant-numeric: tabular-nums;
	}
	.offender-evidence-ci {
		display: block;
		margin-top: 0.125rem;
		font-size: var(--text-micro);
		color: var(--muted-foreground);
	}
	@media (min-width: 1024px) {
		.offender-evidence-table {
			font-size: var(--text-detail-body-desktop);
		}
	}
	@media (max-width: 1023px) {
		.offender-evidence-table,
		.offender-evidence-table thead,
		.offender-evidence-table tbody,
		.offender-evidence-table tr,
		.offender-evidence-table th,
		.offender-evidence-table td {
			display: block;
			text-align: left;
			white-space: normal;
		}
		.offender-evidence-table thead {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0 0 0 0);
		}
		.offender-evidence-table tbody tr {
			padding: 0.625rem 0;
			border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
		}
		.offender-evidence-table th,
		.offender-evidence-table td {
			display: grid;
			grid-template-columns: minmax(7rem, 0.45fr) minmax(0, 1fr);
			gap: 1rem;
			padding: 0.25rem 0;
			border: 0;
		}
		.offender-evidence-table th::before,
		.offender-evidence-table td::before {
			content: attr(data-col);
			font-family: var(--font-mono);
			font-size: var(--text-micro);
			font-weight: 500;
			letter-spacing: var(--tracking-wide);
			text-transform: uppercase;
			color: var(--muted-foreground);
		}
	}
</style>
