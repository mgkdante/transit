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
	import { AbsentValue } from '$lib/components/edge';
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
		readonly subtitle: string;
		readonly href: string | null;
		readonly ariaLabel: string;
	}

	interface HotspotSectionProps {
		heading: string;
		ladder: HotspotLadderResult;
		tray: readonly TrayRow[];
		windowCaption: string;
		info: MetricInfoVM;
		locale: Locale;
		copy: HotspotsCopy;
	}
	let { heading, ladder, tray, windowCaption, info, locale, copy }: HotspotSectionProps = $props();

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
		<div data-slot="hotspot-ladder">
			<Chart spec={ladder.spec} />
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
			<ul class="hotspot-tray-list" aria-label={copy.tray.listLabel}>
				{#each tray as row (row.key)}
					<li class="hotspot-tray-item">
						{#if row.href}
							<a
								class="hotspot-tray-link"
								href={row.href}
								data-sveltekit-preload-data="hover"
								aria-label={row.ariaLabel}
								data-testid="hotspot-tray-link"
							>
								<span class="hotspot-tray-title">{row.title}</span>
								<span class="hotspot-tray-subtitle">{row.subtitle}</span>
							</a>
						{:else}
							<span class="hotspot-tray-title">{row.title}</span>
							<span class="hotspot-tray-subtitle">{row.subtitle}</span>
						{/if}
					</li>
				{/each}
			</ul>
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
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px dashed var(--border);
	}
	.hotspot-tray-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.hotspot-tray-item {
		display: block;
	}
	.hotspot-tray-link {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.375rem;
		border-radius: var(--radius-sm);
		text-decoration: none;
		color: inherit;
	}
	.hotspot-tray-link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.hotspot-tray-title {
		font-size: var(--text-detail-body-mobile);
		color: var(--foreground);
	}
	.hotspot-tray-subtitle {
		font-family: var(--font-mono);
		font-size: var(--text-detail-body-mobile);
		color: var(--foreground);
	}
	@media (min-width: 1024px) {
		.caption,
		.hotspot-tray-title,
		.hotspot-tray-subtitle {
			font-size: var(--text-detail-body-desktop);
		}
	}
</style>
