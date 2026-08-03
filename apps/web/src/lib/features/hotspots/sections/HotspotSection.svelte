<!--
  HotspotSection — one category body inside an article-summary card.

  The board owns category presence and the shared top-N state. This presenter
  renders exactly one supplied ladder and its below-floor tray, preserving the
  absolute severe-rate chart, links, metric explainer, and honest absence.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import DataTable, { type DataTableColumn } from '$lib/components/data/DataTable.svelte';
	import { Chart } from '$lib/components/dataviz/chart';
	import { AbsentValue, MaybeValue } from '$lib/components/edge';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { HotspotLadderResult } from '../selectors/hotspotLadder';
	import type { HotspotsCopy } from '../hotspots.copy';

	interface MetricInfoVM {
		readonly tip: string;
		readonly href: string;
		readonly label: string;
		readonly linkLabel: string;
	}
	interface TrayRow {
		readonly key: string;
		readonly title: string;
		readonly type: string;
		readonly id: string;
		readonly observationCount: number | null;
		readonly href: string | null;
		readonly ariaLabel: string;
	}

	interface HotspotSectionProps {
		heading: string;
		ladder: HotspotLadderResult;
		tray: readonly TrayRow[];
		windowCaption: string;
		chartScrollLabel: string;
		info: MetricInfoVM;
		locale: Locale;
		copy: HotspotsCopy;
	}
	let {
		heading,
		ladder,
		tray,
		windowCaption,
		chartScrollLabel,
		info,
		locale,
		copy,
	}: HotspotSectionProps = $props();

	const headingText = $derived(
		ladder.total > ladder.shown
			? `${heading} ${copy.shownOfTotal(ladder.shown, ladder.total)}`
			: heading,
	);
</script>

{#snippet hotspotItemCell(row: TrayRow)}
	{#if row.href}
		<a class="hotspot-tray-link" href={row.href} aria-label={row.ariaLabel}>{row.title}</a>
	{:else}
		{row.title}
	{/if}
{/snippet}

{#snippet hotspotTypeIdCell(row: TrayRow)}
	{copy.tray.rowSubtitle(row.type, row.id)}
{/snippet}

{#snippet hotspotReadingsCell(row: TrayRow)}
	<MaybeValue
		value={row.observationCount == null ? null : row.observationCount.toLocaleString(locale)}
		variant="row"
		reason="no-observations"
		{locale}
	/>
{/snippet}

<section class="hotspot-section" data-slot="hotspot-section">
	{#if ladder.shown > 0}
		<div class="hotspot-section-head">
			<SectionHeading level={3} overline={headingText}>
				{#snippet explainer()}
					<MetricInfo
						class="hotspot-info"
						tip={info.tip}
						href={info.href}
						label={info.label}
						linkLabel={info.linkLabel}
						side="bottom"
					/>
				{/snippet}
			</SectionHeading>
		</div>
		<p class="caption" data-slot="hotspot-window">{windowCaption}</p>
		<Chart spec={ladder.spec} scrollLabel={chartScrollLabel} />
	{:else}
		<div class="hotspot-section-head">
			<SectionHeading level={3} overline={heading} />
		</div>
		<div data-slot="hotspot-ladder-empty">
			<AbsentValue variant="block" reason="no-observations" {locale} />
		</div>
	{/if}

	{#if tray.length > 0}
		<div class="hotspot-tray" data-slot="hotspot-tray">
			<SectionHeading level={3} overline={copy.tray.heading} />
			<p class="caption" data-slot="hotspot-tray-reason">{copy.tray.reason}</p>
			<DataTable
				rows={tray}
				columns={[
					{
						key: 'item',
						header: copy.tray.columns.item,
						rowHeader: true,
						cell: hotspotItemCell,
					},
					{
						key: 'type-id',
						header: copy.tray.columns.typeId,
						cell: hotspotTypeIdCell,
					},
					{
						key: 'readings',
						header: copy.tray.columns.readings,
						numeric: true,
						cell: hotspotReadingsCell,
					},
				] satisfies readonly DataTableColumn<TrayRow>[]}
				key={(row) => row.key}
				caption={copy.tray.listLabel}
				responsive={{ mode: 'stack', at: 'compact' }}
				frame="none"
				borderCollapse="collapse"
				headerBand="none"
				tableAttrs={{ class: 'hotspot-tray-table', 'data-slot': 'hotspot-tray-table' }}
			/>
		</div>
	{/if}
</section>

<style>
	.hotspot-section {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		min-width: 0;
	}
	.hotspot-section-head {
		display: flex;
		align-items: center;
		min-width: 0;
	}
	.caption {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-detail-body-mobile);
		line-height: 1.5;
		color: var(--foreground);
	}
	.hotspot-tray {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		min-width: 0;
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px dashed var(--border);
	}
	:global(table.hotspot-tray-table.data-table) {
		font-size: var(--text-detail-body-mobile);
	}
	.hotspot-tray-link {
		border-radius: var(--radius-sm);
		text-decoration: none;
		color: inherit;
	}
	.hotspot-tray-link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	@media (min-width: 1024px) {
		.caption {
			font-size: var(--text-detail-body-desktop);
		}
		:global(table.hotspot-tray-table.data-table) {
			font-size: var(--text-detail-body-desktop);
		}
	}
</style>
