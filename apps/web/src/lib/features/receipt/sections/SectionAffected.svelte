<!--
  SectionAffected — the receipt's affected-count cells (S13).

  Pure presenter of the affectedCounts VMs: the lines / stops / alerts touched on the
  day, each a MaybeValue (null → the styled 'no-observations' chip, a real 0 stays 0).
  The always-null `vehicles` cell is dropped upstream by the selector. A receipt
  line-group inside the TerminalPanel (WEB4 metaphor preserved).
-->
<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import { MaybeValue } from '$lib/components/edge';
	import SectionHeading from '$lib/components/brand/SectionHeading.svelte';
	import MetricInfo from '$lib/features/metrics/MetricInfo.svelte';
	import type { MetricKey, SupplementalMetricKey } from '$lib/features/metrics/metrics.content';
	import type { AffectedCountVM } from '../selectors/affectedCounts';

	interface SectionAffectedProps {
		counts: readonly AffectedCountVM[];
		heading: string;
		info: (
			key: MetricKey | SupplementalMetricKey,
			name: string,
		) => { tip: string; href: string; label: string; linkLabel: string };
		locale: Locale;
		headingLevel?: 2 | 3;
	}
	let { counts, heading, info, locale, headingLevel = 2 }: SectionAffectedProps = $props();

	const headingInfo = $derived(info('affectedCounts', heading));
</script>

<section class="receipt-panel receipt-affected" data-slot="receipt-affected">
	<SectionHeading level={headingLevel} overline={heading}>
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
	<dl class="receipt-counts">
		{#each counts as cell (cell.key)}
			<div class="receipt-count">
				<dt>{cell.label}</dt>
				<dd>
					<MaybeValue value={cell.value} reason="no-observations" {locale} />
				</dd>
			</div>
		{/each}
	</dl>
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
	.receipt-affected {
		container-type: inline-size;
		container-name: receipt-affected;
	}
	.receipt-counts {
		margin: 0;
		display: grid;
		gap: 0.8rem 1.5rem;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
	@container receipt-affected (min-width: 30rem) {
		.receipt-counts {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}
	.receipt-count {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.receipt-count dt {
		font-family: var(--font-mono);
		font-size: var(--text-micro);
		letter-spacing: 0.5px;
		text-transform: uppercase;
		color: var(--muted-foreground);
	}
	.receipt-count dd {
		margin: 0;
		font-family: var(--font-mono);
		font-size: var(--text-subheading);
		font-variant-numeric: tabular-nums;
		color: var(--foreground);
	}
</style>
