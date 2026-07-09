<!--
  SectionWorst — the receipt's worst-of-day callouts (S13).

  Pure presenter of the worstOfDay VM: the single worst line (→ /lines/[id]) + worst
  stop (→ /stop/[id]) as linked EntityRows. The whole panel is mounted by the
  orchestrator ONLY when hasWorst — so it stands down (the grid reflows past it) rather
  than a fabricated empty card. A receipt line-group inside the TerminalPanel (WEB4).
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import EntityRow from '$lib/components/surface/EntityRow.svelte';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { MetricKey, SupplementalMetricKey } from '$lib/features/metrics/metrics.content';
	import type { WorstOfDayVM } from '../selectors/day-worst';

	interface SectionWorstProps {
		worst: WorstOfDayVM;
		heading: string;
		info: (
			key: MetricKey | SupplementalMetricKey,
			name: string,
		) => { tip: string; href: string; label: string; linkLabel: string };
		locale: Locale;
	}
	let { worst, heading, info, locale }: SectionWorstProps = $props();

	const headingInfo = $derived(info('otp', heading));
</script>

<section class="receipt-panel receipt-worst-panel" data-slot="receipt-worst">
	<SectionHeading level={2} overline={heading}>
		{#snippet explainer()}
			<MetricInfo
				tip={headingInfo.tip}
				href={headingInfo.href}
				label={headingInfo.label}
				linkLabel={headingInfo.linkLabel}
				side="bottom"
			/>
		{/snippet}
	</SectionHeading>
	<div class="receipt-worst">
		{#if worst.route}
			<EntityRow
				target={{ kind: 'line', id: worst.route.id }}
				{locale}
				title={worst.route.title}
				subtitle={worst.route.subtitle}
				meta={worst.route.meta}
			/>
		{/if}
		{#if worst.stop}
			<EntityRow
				target={{ kind: 'stop', id: worst.stop.id }}
				{locale}
				title={worst.stop.title}
				subtitle={worst.stop.subtitle}
				meta={worst.stop.meta}
			/>
		{/if}
	</div>
</section>

<style>
	.receipt-panel {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		padding: 1.1rem 1.2rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--card);
	}
	.receipt-worst {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
</style>
