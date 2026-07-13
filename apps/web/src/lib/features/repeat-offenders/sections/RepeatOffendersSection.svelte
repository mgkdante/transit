<!--
  RepeatOffendersSection — one offender kind inside an article-summary card.

  The board owns kind presence and the shared top-N state. This pure presenter
  renders exactly one supplied recurrence ladder and its below-floor tray,
  preserving links, metric context, and honest absence.
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import { Chart } from '$lib/components/dataviz/chart';
	import { AbsentValue } from '$lib/components/edge';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { OffenderLadderResult } from '../selectors/offenderLadder';
	import type { RepeatOffendersCopy } from '../repeatOffenders.copy';

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
	interface RecurrenceLine {
		readonly key: string;
		readonly label: string;
		readonly text: string;
	}

	interface RepeatOffendersSectionProps {
		heading: string;
		ladder: OffenderLadderResult;
		tray: readonly TrayRow[];
		recurrence: readonly RecurrenceLine[];
		windowCaption: string;
		info: MetricInfoVM;
		locale: Locale;
		copy: RepeatOffendersCopy;
	}
	let {
		heading,
		ladder,
		tray,
		recurrence,
		windowCaption,
		info,
		locale,
		copy,
	}: RepeatOffendersSectionProps = $props();

	const headingText = $derived(
		ladder.total > ladder.shown
			? `${heading} ${copy.shownOfTotal(ladder.shown, ladder.total)}`
			: heading,
	);
</script>

<section class="offender-section" data-slot="offender-section">
	{#if ladder.shown > 0}
		<div class="offender-section-head">
			<SectionHeading level={3} overline={headingText}>
				{#snippet explainer()}
					<MetricInfo
						class="offender-info"
						tip={info.tip}
						href={info.href}
						label={info.label}
						linkLabel={info.linkLabel}
						side="bottom"
					/>
				{/snippet}
			</SectionHeading>
		</div>
		<p class="caption" data-slot="offender-window">{windowCaption}</p>
		<div data-slot="offender-ladder" data-card-interactive>
			<Chart spec={ladder.spec} />
		</div>
		{#if recurrence.length > 0}
			<ul class="offender-recurrence" data-slot="offender-recurrence">
				{#each recurrence as line (line.key)}
					<li class="offender-recurrence-item">
						<span class="offender-recurrence-label">{line.label}</span>
						<span class="offender-recurrence-text">{line.text}</span>
					</li>
				{/each}
			</ul>
		{/if}
	{:else}
		<div class="offender-section-head">
			<SectionHeading level={3} overline={heading} />
		</div>
		<div data-slot="offender-ladder-empty">
			<AbsentValue variant="block" reason="no-observations" {locale} />
		</div>
	{/if}

	{#if tray.length > 0}
		<div class="offender-tray" data-slot="offender-tray">
			<SectionHeading level={3} overline={copy.tray.heading} />
			<p class="caption" data-slot="offender-tray-reason">{copy.tray.reason}</p>
			<ul class="offender-tray-list" aria-label={copy.tray.listLabel}>
				{#each tray as row (row.key)}
					<li class="offender-tray-item">
						{#if row.href}
							<a
								class="offender-tray-link"
								href={row.href}
								data-sveltekit-preload-data="hover"
								aria-label={row.ariaLabel}
								data-testid="offender-tray-link"
							>
								<span class="offender-tray-title">{row.title}</span>
								<span class="offender-tray-subtitle">{row.subtitle}</span>
							</a>
						{:else}
							<span class="offender-tray-title">{row.title}</span>
							<span class="offender-tray-subtitle">{row.subtitle}</span>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</section>

<style>
	.offender-section {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		min-width: 0;
	}
	.offender-section-head {
		display: flex;
		align-items: center;
		min-width: 0;
	}
	.caption {
		margin: 0;
		max-width: 52ch;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.offender-recurrence {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.offender-recurrence-item {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.375rem;
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		line-height: 1.4;
		color: var(--muted-foreground);
	}
	.offender-recurrence-label {
		color: var(--foreground);
	}
	.offender-tray {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px dashed var(--border);
	}
	.offender-tray-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.offender-tray-item {
		display: block;
	}
	.offender-tray-link {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.375rem;
		border-radius: var(--radius-sm);
		text-decoration: none;
		color: inherit;
	}
	.offender-tray-link:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.offender-tray-title {
		font-size: var(--text-small);
		color: var(--muted-foreground);
	}
	.offender-tray-subtitle {
		font-family: var(--font-mono);
		font-size: var(--text-caption);
		color: var(--muted-foreground);
	}
</style>
