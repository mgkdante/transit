<!--
  SectionEnvelope — the /status "Build accountability" section (S11).

  Surfaces the in-band accountability envelope every /v1 payload carries but that
  /status previously RENDERED NONE OF:

    · publish_generation_id — the deterministic stamp of the ONE publish run that
      produced everything on the page. Rendered in an ExplainedMetricCard with an
      always-visible plain-language explanation (col2), so the reader understands
      what the stamp means in place, not behind a hover.
    · schema_version         — the contract version, as a MetricDisplay row.
    · methodology_version    — the methodology family version, as a MetricDisplay row.

  HONESTY: each field is null-safe — an absent value renders the styled honest-
  absence chip ("not reported") via MetricDisplay / ExplainedMetricCard, never a
  fabricated value. The section STANDS DOWN only when all three are absent (the
  parent guards that). DOCTRINE: no data mark painted (quiet card + rows), tokens
  only.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { ExplainedMetricCard } from '$lib/components/dataviz';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import type { EnvelopeView } from '../selectors/envelope';
	import type { HealthCopy } from '../health.copy';

	interface SectionEnvelopeProps {
		envelope: EnvelopeView;
		copy: HealthCopy;
		locale: Locale;
	}
	let { envelope, copy, locale }: SectionEnvelopeProps = $props();

	const t = $derived(copy.envelope);
</script>

<section class="health-block" aria-labelledby="health-envelope" data-slot="envelope-section">
	<SectionLabel id="health-envelope" text={t.section} variant="station" />
	<p class="health-note">{t.note}</p>

	<!-- publish_generation_id: the wide explained card carries the WHY in col2. -->
	<ExplainedMetricCard
		label={t.generationIdLabel}
		value={envelope.generationId}
		explanation={t.generationIdExplain}
		emptyLabel={copy.noData}
		absentReason="not-reported"
		{locale}
		size="md"
	/>

	<!-- schema_version + methodology_version: quiet MetricDisplay rows. -->
	<div class="envelope-rows">
		<MetricDisplay
			value={envelope.schemaVersion}
			emptyLabel={copy.noData}
			absentReason="not-reported"
			{locale}
			label={t.schemaVersionLabel}
			size="md"
		/>
		<MetricDisplay
			value={envelope.methodologyVersion}
			emptyLabel={copy.noData}
			absentReason="not-reported"
			{locale}
			label={t.methodologyVersionLabel}
			size="md"
		/>
	</div>
</section>

<style>
	.health-block {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.health-note {
		margin: 0;
		color: var(--muted-foreground);
		font-size: var(--text-small);
		line-height: 1.6;
		max-width: 60ch;
	}
	.envelope-rows {
		display: grid;
		gap: 1.25rem 2rem;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		max-width: 28rem;
	}
</style>
