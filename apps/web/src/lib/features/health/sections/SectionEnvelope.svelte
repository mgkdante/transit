<!--
  SectionEnvelope — the /status "Build accountability" section (S11).

  Surfaces the in-band accountability envelope every /v1 payload carries but that
  /status previously RENDERED NONE OF:

    · publish_generation_id — the deterministic stamp of the ONE publish run that
      produced everything on the page. Rendered in a dedicated stacked card with
      an always-visible plain-language explanation after the break-safe run ID.
    · schema_version         — the contract version, as a MetricDisplay row.
    · methodology_version    — the methodology family version, as a MetricDisplay row.

  HONESTY: each field is null-safe — an absent value renders the styled honest-
  absence chip ("not reported") via AbsentValue / MetricDisplay, never a fabricated
  value. The section STANDS DOWN only when all three are absent (the parent guards
  that). DOCTRINE: no data mark painted (quiet card + rows), tokens only.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { SectionLabel } from '@yesid/ui/brand';
	import { MetricDisplay } from '$lib/components/brand';
	import { AbsentValue } from '$lib/components/edge';
	import WorkflowIcon from '@lucide/svelte/icons/workflow';
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

<div class="health-block" data-slot="envelope-section">
	<p class="health-note">{t.note}</p>

	<!-- publish_generation_id: the stacked card keeps the run ID full-width and
	     places the explanation after it in reading order. -->
	<article class="publish-run-card" data-slot="publish-run-card">
		<header class="publish-run-header">
			<SectionLabel text={t.generationIdLabel} variant="metric" />
			<span class="publish-run-badge" aria-hidden="true">
				<WorkflowIcon size={16} strokeWidth={1.75} />
			</span>
		</header>
		{#if envelope.generationId}
			<code class="publish-run-id" data-slot="publish-run-id">{envelope.generationId}</code>
		{:else}
			<AbsentValue reason="not-reported" {locale} variant="inline" />
		{/if}
		<p class="publish-run-explanation" data-slot="publish-run-explanation">
			{t.generationIdExplain}
		</p>
	</article>

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
</div>

<style>
	.health-block {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.health-note {
		margin: 0;
		color: var(--muted-foreground);
		font-size: var(--text-detail-body-mobile);
		line-height: 1.8;
		max-width: 60ch;
	}
	.publish-run-card {
		--publish-run-tone: var(--dataviz-occupancy-standing);
		display: flex;
		flex-direction: column;
		gap: 0.875rem;
		min-width: 0;
		padding: 1rem 1.125rem 1.125rem;
		border: 1px solid color-mix(in srgb, var(--publish-run-tone) 42%, var(--border) 58%);
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--publish-run-tone) 7%, var(--card) 93%);
	}
	.publish-run-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.publish-run-badge {
		display: inline-flex;
		padding: 0.375rem;
		border: 1px solid color-mix(in srgb, var(--publish-run-tone) 52%, var(--border) 48%);
		border-radius: var(--radius-pill);
		color: var(--publish-run-tone);
		background: color-mix(in srgb, var(--publish-run-tone) 13%, transparent);
	}
	.publish-run-id {
		display: block;
		width: 100%;
		min-width: 0;
		padding: 0.75rem 0.875rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--terminal);
		color: var(--terminal-ink);
		font-family: var(--font-mono);
		font-size: var(--text-mono);
		line-height: 1.6;
		overflow-wrap: anywhere;
		word-break: break-word;
		white-space: normal;
	}
	.publish-run-explanation {
		margin: 0;
		max-width: 68ch;
		color: var(--foreground);
		font-size: var(--text-detail-body-mobile);
		line-height: 1.8;
		text-wrap: pretty;
	}
	.envelope-rows {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1.25rem 2rem;
		max-width: 28rem;
	}
	@media (min-width: 1024px) {
		.health-note,
		.publish-run-explanation {
			font-size: var(--text-detail-body-desktop);
			line-height: 1.9;
		}
		.envelope-rows {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
