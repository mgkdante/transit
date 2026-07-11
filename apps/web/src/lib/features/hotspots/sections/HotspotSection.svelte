<!--
  HotspotSection — one category body inside an article-summary card.

  The board owns category presence and the shared top-N state. This presenter
  renders exactly one supplied ladder and its below-floor tray, preserving the
  absolute severe-rate chart, links, metric explainer, and honest absence.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
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

	let chartViewport = $state<HTMLDivElement | null>(null);
	let chartScrollable = $state(false);
	let chartMoreEnd = $state(false);

	function measureChartOverflow(): void {
		const viewport = chartViewport;
		if (!viewport) return;
		const overflowX = getComputedStyle(viewport).overflowX;
		const scrollRange = viewport.scrollWidth - viewport.clientWidth;
		chartScrollable = (overflowX === 'auto' || overflowX === 'scroll') && scrollRange > 1;
		chartMoreEnd = chartScrollable && viewport.scrollLeft < scrollRange - 1;
	}

	$effect(() => {
		const viewport = chartViewport;
		if (!viewport) return;
		measureChartOverflow();
		if (typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(measureChartOverflow);
		observer.observe(viewport);
		if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
		return () => observer.disconnect();
	});

	const headingText = $derived(
		ladder.total > ladder.shown
			? `${heading} ${copy.shownOfTotal(ladder.shown, ladder.total)}`
			: heading,
	);
</script>

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
		<div class="hotspot-chart-shell" data-slot="hotspot-chart-shell" data-more-end={chartMoreEnd}>
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				bind:this={chartViewport}
				class="hotspot-chart-viewport"
				data-slot="hotspot-chart-viewport"
				role={chartScrollable ? 'region' : undefined}
				aria-label={chartScrollable ? chartScrollLabel : undefined}
				tabindex={chartScrollable ? 0 : undefined}
				onscroll={measureChartOverflow}
			>
				<div class="hotspot-chart-canvas" data-slot="hotspot-chart-canvas">
					<Chart spec={ladder.spec} />
				</div>
			</div>
		</div>
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
			<table class="hotspot-tray-table" data-slot="hotspot-tray-table">
				<caption class="sr-only">{copy.tray.listLabel}</caption>
				<thead>
					<tr>
						<th scope="col">{copy.tray.columns.item}</th>
						<th scope="col">{copy.tray.columns.typeId}</th>
						<th scope="col">{copy.tray.columns.readings}</th>
					</tr>
				</thead>
				<tbody>
					{#each tray as row (row.key)}
						<tr>
							<th scope="row">
								{#if row.href}<a href={row.href} aria-label={row.ariaLabel}>{row.title}</a
									>{:else}{row.title}{/if}
							</th>
							<td data-col={copy.tray.columns.typeId}>{copy.tray.rowSubtitle(row.type, row.id)}</td>
							<td class="hotspot-tray-readings" data-col={copy.tray.columns.readings}>
								<MaybeValue
									value={row.observationCount == null
										? null
										: row.observationCount.toLocaleString(locale)}
									reason="no-observations"
									{locale}
								/>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
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
	.hotspot-chart-shell,
	.hotspot-chart-viewport,
	.hotspot-chart-canvas {
		min-width: 0;
	}
	.hotspot-chart-shell {
		position: relative;
	}
	.hotspot-chart-shell::after {
		display: none;
	}
	.hotspot-chart-viewport {
		overflow-x: visible;
		overflow-y: visible;
	}
	.hotspot-chart-viewport:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.caption {
		margin: 0;
		max-width: 52ch;
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
	.hotspot-tray-table {
		width: 100%;
		margin: 0;
		border-collapse: collapse;
		font-size: var(--text-detail-body-mobile);
		overflow-wrap: anywhere;
	}
	.hotspot-tray-table th,
	.hotspot-tray-table td {
		padding: 0.5rem;
		text-align: left;
	}
	.hotspot-tray-table thead th {
		border-bottom: 1px solid var(--border);
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		font-weight: 500;
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.hotspot-tray-table th[scope='row'] {
		font-weight: 500;
		color: var(--foreground);
	}
	.hotspot-tray-table tbody tr + tr th,
	.hotspot-tray-table tbody tr + tr td {
		border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
	}
	.hotspot-tray-table td {
		font-family: var(--font-mono);
		color: var(--foreground);
	}
	.hotspot-tray-table a {
		border-radius: var(--radius-sm);
		text-decoration: none;
		color: inherit;
	}
	.hotspot-tray-table a:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.hotspot-tray-readings,
	.hotspot-tray-table th[scope='col']:last-child {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	@media (min-width: 1024px) {
		.caption,
		.hotspot-tray-table {
			font-size: var(--text-detail-body-desktop);
		}
	}
	@media (max-width: 1023px) {
		.hotspot-chart-shell[data-more-end='true']::after {
			content: '';
			display: block;
			position: absolute;
			inset-block: 0;
			inset-inline-end: 0;
			width: 2rem;
			background: linear-gradient(to right, transparent, var(--card));
			pointer-events: none;
		}
		.hotspot-chart-viewport {
			max-width: 100%;
			overflow-x: auto;
			overflow-y: hidden;
			scrollbar-width: thin;
			overscroll-behavior-inline: contain;
			touch-action: pan-x pan-y;
		}
		.hotspot-chart-canvas {
			min-width: 48rem;
		}
	}
	@media (max-width: 28rem) {
		.hotspot-tray-table,
		.hotspot-tray-table thead,
		.hotspot-tray-table tbody,
		.hotspot-tray-table tr,
		.hotspot-tray-table th,
		.hotspot-tray-table td {
			display: block;
			text-align: left;
			white-space: normal;
		}
		.hotspot-tray-table thead {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0 0 0 0);
		}
		.hotspot-tray-table tbody tr {
			padding: 0.5rem 0;
			border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
		}
		.hotspot-tray-table th[scope='row'] {
			margin-bottom: 0.25rem;
		}
		.hotspot-tray-table td {
			display: flex;
			justify-content: space-between;
			gap: 1rem;
			padding: 0.125rem 0;
			border: 0;
		}
		.hotspot-tray-table td::before {
			content: attr(data-col);
			font-family: var(--font-mono);
			font-size: var(--text-micro);
			letter-spacing: var(--tracking-wide);
			text-transform: uppercase;
			color: var(--muted-foreground);
		}
	}
</style>
