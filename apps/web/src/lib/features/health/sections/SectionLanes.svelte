<!--
  SectionLanes — the /status "Pipeline lanes" section (S11).

  One row per PUBLISH lane (live / static / rollup) from data_health.json: the
  lane label + scheduled cadence, the last-publish age (relative, off the shared
  clock via FreshnessStamp variant='updated'), the file counts written/total, and
  the last value-gate verdict as a chip on the dataviz status scale. Plus the
  MAINTENANCE honest not-applicable row (built from static copy — no DB heartbeat).

  HONESTY: a null age/count/gate renders the styled honest-absence, never a
  fabricated 0 or an assumed pass. The section STANDS DOWN entirely when the
  data_health payload is absent (legacy publish) — the parent passes an empty
  rows[] and this renders nothing.

  DOCTRINE: the gate chip rides StatusDot on the status scale (on_time/late/
  unknown), never --primary. Tokens only. The gate explainer is honest, not
  alarmist: it states WHAT the gate checks (value-level rules that block a bad
  historic publish) in plain words.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { FreshnessStamp } from '$lib/components/surface';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import StatusDot from '$lib/components/brand/StatusDot.svelte';
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

<section class="health-block" aria-labelledby="health-lanes" data-slot="lanes-section">
	<SectionHeading level={2} id="health-lanes" overline={t.section} number={1} />
	<p class="health-note">{t.note}</p>
	<!-- The gate explainer: one honest, not-alarmist sentence for the whole section. -->
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
						<!-- Last publish: relative age off the shared clock (or "unknown" when the
						     lane has never published). -->
						<div class="lane-cell" data-slot="lane-last-publish">
							<span class="lane-cell-label">{t.lastPublishLabel}</span>
							<FreshnessStamp variant="updated" generatedUtc={row.lastPublishUtc} {locale} />
						</div>

						<!-- File counts: written of total. Absent → the honest absence chip. -->
						<div class="lane-cell" data-slot="lane-files">
							<span class="lane-cell-label">{t.filesLabel}</span>
							{#if row.filesTotal != null}
								<span class="lane-cell-value"
									>{t.filesCount(
										(row.filesWritten ?? 0).toLocaleString(locale === 'fr' ? 'fr-CA' : 'en-CA'),
										row.filesTotal.toLocaleString(locale === 'fr' ? 'fr-CA' : 'en-CA'),
									)}</span
								>
							{:else}
								<AbsentValue variant="inline" reason="not-reported" {locale} />
							{/if}
						</div>

						<!-- Gate verdict chip: a StatusDot on the status scale + the verdict word.
						     Null gate → the honest "not checked" absence (never an assumed pass). -->
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
					<!-- MAINTENANCE not-applicable row: no heartbeat, a plain honest reason. -->
					<div class="lane-na" data-slot="lane-not-applicable">
						<span class="lane-na-chip">{t.notApplicable}</span>
						<p class="lane-na-reason">{row.notApplicableReason}</p>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
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
	.health-note--gate {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		max-width: 72ch;
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
		gap: 0.6rem;
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
		gap: 0.2rem;
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
		gap: 0.4rem;
	}
	.lane-gate-verdict {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
	}

	/* Not-applicable (MAINTENANCE) row: a calm neutral chip + the honest reason. */
	.lane-na {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.lane-na-chip {
		align-self: flex-start;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		text-transform: uppercase;
		letter-spacing: var(--tracking-eyebrow);
		padding: 0.15rem 0.5rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--card);
		color: var(--muted-foreground);
	}
	.lane-na-reason {
		margin: 0;
		font-size: var(--text-small);
		line-height: 1.5;
		color: var(--muted-foreground);
		max-width: 60ch;
	}
</style>
