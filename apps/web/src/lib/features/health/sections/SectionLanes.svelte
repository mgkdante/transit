<script lang="ts">
	import { Badge } from '@yesid/ui/badge';
	import { intl } from '$lib/i18n';
	import type { Locale } from '$lib/i18n';
	import { FreshnessStamp } from '$lib/components/surface';
	import { TerminalPanel, StatusDot } from '@yesid/ui/brand';
	import { AbsentValue } from '$lib/components/edge';
	import type { LaneRow } from '../selectors/laneHealth';
	import type { HealthCopy } from '../health.copy';

	interface SectionLanesProps {
		rows: readonly LaneRow[];
		copy: HealthCopy;
		locale: Locale;
	}
	let { rows, copy, locale }: SectionLanesProps = $props();

	const t = $derived(copy.lanes);
</script>

<TerminalPanel title={t.terminal.title} tag={t.terminal.tag}>
	<div class="health-block" data-slot="lanes-section">
		<p class="health-note">{t.note}</p>
		<p class="health-note health-note--gate" data-slot="gate-explain">{t.gateExplain}</p>

		<ul class="lanes-list" role="list" aria-label={t.listLabel} data-slot="lanes-list">
			{#each rows as row (row.key)}
				<li
					class="lane-row"
					data-slot="lane-row"
					data-lane={row.key}
					data-applicable={row.applicable}
				>
					<div class="lane-head">
						<span class="lane-label">{row.label}</span>
						<span class="lane-cadence" aria-label={`${t.cadenceLabel}: ${row.cadence}`}
							>{row.cadence}</span
						>
					</div>

					{#if row.applicable}
						<div class="lane-meta">
							<div class="lane-cell" data-slot="lane-last-publish">
								<span class="lane-cell-label">{t.lastPublishLabel}</span>
								<FreshnessStamp variant="updated" generatedUtc={row.lastPublishUtc} {locale} />
							</div>

							<div class="lane-cell" data-slot="lane-files">
								<span class="lane-cell-label">{t.filesLabel}</span>
								{#if row.filesWritten != null && row.filesTotal != null}
									<span class="lane-cell-value"
										>{t.filesCount(
											intl.number(locale).format(row.filesWritten),
											intl.number(locale).format(row.filesTotal),
										)}</span
									>
								{:else}
									<AbsentValue variant="inline" reason="not-reported" {locale} />
								{/if}
							</div>

							<div class="lane-cell" data-slot="lane-gate">
								<span class="lane-cell-label">{t.gateLabel}</span>
								{#if row.gate}
									<span class="lane-gate-chip" data-gate={row.gate.aspect}>
										<StatusDot color={row.gate.aspect} aria-hidden="true" />
										<span class="lane-gate-verdict">{row.gate.label}</span>
									</span>
								{:else}
									<AbsentValue variant="inline" reason="not-reported" {locale} />
								{/if}
							</div>
						</div>
					{:else}
						<div class="lane-na" data-slot="lane-not-applicable">
							<Badge variant="tag">{t.notApplicable}</Badge>
							<p class="lane-na-reason">{row.notApplicableReason}</p>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	</div>
</TerminalPanel>

<style>
	.health-note--gate {
		font-family: var(--font-mono);
	}

	.lanes-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.lane-row {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.875rem 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--muted);
	}
	.lane-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.lane-label {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		text-transform: uppercase;
		letter-spacing: var(--tracking-eyebrow);
		color: var(--foreground);
	}
	.lane-cadence {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
	}

	.lane-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 2rem;
	}
	.lane-cell {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}
	.lane-cell-label {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		text-transform: uppercase;
		letter-spacing: var(--tracking-eyebrow);
		color: var(--muted-foreground);
	}
	.lane-cell-value {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
	}

	.lane-gate-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}
	.lane-gate-verdict {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
	}

	.lane-na {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.lane-na-reason {
		margin: 0;
		font-size: var(--text-small);
		line-height: 1.5;
		color: var(--muted-foreground);
	}
</style>
