<!--
  SectionTimeOfDay — the receipt's by-shift time-of-day cut (S13, NEW).

  Pure presenter of selectReceiptTimeOfDay: the day's severe-delay share ranked worst-
  first by canonical shift, each a RankedRow SeverityBar on the FIXED absolute
  SEVERE_DOMAIN [0,100] (doctrine-coded — never the in-view max). Mounted by the
  orchestrator only when hasTimeOfDay (RAMP-IN: by_shift is additive-optional). A
  receipt line-group below the frame — a documented hoist because a ranked severity
  ladder genuinely breaks the compact terminal-tile metaphor (WEB4).
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import { RankedRow } from '$lib/components/dataviz';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { MetricKey, SupplementalMetricKey } from '$lib/features/metrics/metrics.content';
	import type { ReceiptShiftRow } from '../selectors/timeOfDay';

	interface SectionTimeOfDayProps {
		rows: readonly ReceiptShiftRow[];
		heading: string;
		subtitle: string;
		caveat: string;
		info: (
			key: MetricKey | SupplementalMetricKey,
			name: string,
		) => { tip: string; href: string; label: string; linkLabel: string };
		locale: Locale;
	}
	let { rows, heading, subtitle, caveat, info }: SectionTimeOfDayProps = $props();

	const headingInfo = $derived(info('severe', heading));
</script>

<section class="receipt-tod" data-slot="receipt-time-of-day" aria-label={heading}>
	<span class="receipt-section">
		<SectionLabel text={heading} variant="station" />
		<MetricInfo
			tip={headingInfo.tip}
			href={headingInfo.href}
			label={headingInfo.label}
			linkLabel={headingInfo.linkLabel}
			side="bottom"
		/>
	</span>
	<div class="receipt-tod-list" role="list" aria-label={heading}>
		{#each rows as row (row.key)}
			<RankedRow
				rank={row.rank}
				title={row.title}
				{subtitle}
				severity={row.severity}
				value={row.value}
				domain={row.domain}
				unit={row.unit}
				display={row.display}
			/>
		{/each}
	</div>
	<p class="receipt-tod-caveat">{caveat}</p>
</section>

<style>
	.receipt-tod {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.receipt-section {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}
	.receipt-tod-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.receipt-tod-caveat {
		margin: 0;
		max-width: 100%;
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
</style>
