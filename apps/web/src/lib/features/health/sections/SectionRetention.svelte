<!--
  SectionRetention — the detail/aggregate retention stat pair. Both windows render
  whenever the section is up; a missing one shows the styled honest-absence chip via
  MetricDisplay rather than vanishing. Mechanical move out of HealthStatus.svelte;
  the day-count formatter is passed in. Stands DOWN (parent guards) when BOTH absent.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import type { HealthCopy } from '../health.copy';

	interface SectionRetentionProps {
		detail: number | null;
		aggregate: number | null;
		/** Formats a retention day-count as "14 days", or null on no-data. */
		fmtDays: (v: number | null) => string | null;
		copy: HealthCopy;
		locale: Locale;
	}
	let { detail, aggregate, fmtDays, copy, locale }: SectionRetentionProps = $props();
	const t = $derived(copy.retention);
</script>

<div class="health-block" data-slot="retention-section">
	<p class="health-note">{t.note}</p>
	<div class="health-retention">
		<MetricDisplay
			value={fmtDays(detail)}
			absentReason="not-reported"
			{locale}
			label={t.detailLabel}
			size="md"
		/>
		<MetricDisplay
			value={fmtDays(aggregate)}
			absentReason="not-reported"
			{locale}
			label={t.aggregateLabel}
			size="md"
		/>
	</div>
</div>

<style>
	.health-retention {
		display: grid;
		gap: 1.25rem 2rem;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		max-width: 28rem;
	}
</style>
