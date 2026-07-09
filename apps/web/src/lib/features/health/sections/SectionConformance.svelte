<!--
  SectionConformance — the feed-conformance verdict (ConformanceBadge) + a
  disclosure listing the COMPLETE unknown_members[] + the exact extra_row_count.
  Mechanical move out of HealthStatus.svelte. Stands DOWN (parent guards) when the
  provenance carries no conformance object.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { ConformanceBadge } from '$lib/components/surface';
	import { CollapsibleSection } from '$lib/components/shared';
	import SectionLabel from '$lib/components/brand/SectionLabel.svelte';
	import MetricDisplay from '$lib/components/brand/MetricDisplay.svelte';
	import type { ProvenanceConformance } from '$lib/v1/schemas';
	import type { HealthCopy } from '../health.copy';

	interface SectionConformanceProps {
		conformance: ProvenanceConformance;
		copy: HealthCopy;
		locale: Locale;
		closeSignal?: number | null;
		openSignal?: number | null;
	}
	let {
		conformance,
		copy,
		locale,
		closeSignal = null,
		openSignal = null,
	}: SectionConformanceProps = $props();
	const t = $derived(copy.conformance);
</script>

<div class="health-block" data-slot="conformance-section">
	<p class="health-note">{t.note}</p>
	<div class="health-conformance-badge">
		<ConformanceBadge {conformance} {locale} />
	</div>
	<!-- The badge only previews a few members; the full list + the exact extra-row
	     count live in this disclosure (rendered only when the feed named fields). -->
	{#if conformance.unknown_members && conformance.unknown_members.length > 0}
		<div class="section-block">
			<CollapsibleSection
				title={t.detailsTitle}
				sectionKey="health-conformance-members"
				open={true}
				{closeSignal}
				{openSignal}
			>
				<div class="health-conformance-detail">
					<!-- Honest extra-row count: a real number renders localized; a null/absent
					     count stands the value null so MetricDisplay renders the styled
					     honest-absence chip, never a fabricated 0. -->
					<MetricDisplay
						value={typeof conformance.extra_row_count === 'number'
							? conformance.extra_row_count.toLocaleString(locale === 'fr' ? 'fr-CA' : 'en-CA')
							: null}
						emptyLabel={copy.noData}
						absentReason="not-reported"
						{locale}
						label={t.extraRowsLabel}
						size="md"
					/>
					<div class="health-members">
						<SectionLabel text={t.membersLabel} variant="metric" />
						<ul class="health-members-list" aria-label={t.membersListLabel}>
							{#each conformance.unknown_members as member (member)}
								<li class="health-members-item">{member}</li>
							{/each}
						</ul>
					</div>
				</div>
			</CollapsibleSection>
		</div>
	{/if}
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
	@media (min-width: 1024px) {
		.health-note {
			font-size: var(--text-detail-body-desktop);
			line-height: 1.9;
		}
	}
	.health-conformance-badge {
		display: flex;
	}
	/* .section-block scroll landing is offset globally (app.css `[data-toc]` rule
	   off --chrome-offset) — the CollapsibleSection inside is the tracked target. */
	.health-conformance-detail {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}
	.health-members {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.health-members-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}
	.health-members-item {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		padding: 0.125rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--muted);
		color: var(--muted-foreground);
		overflow-wrap: anywhere;
	}
</style>
