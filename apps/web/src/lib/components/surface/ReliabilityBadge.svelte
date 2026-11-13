<script lang="ts">
	import { intl } from '#lib/i18n/index.ts';
	import type { Locale } from '#lib/i18n/index.ts';
	import type { ReliabilitySnapshot } from '#lib/v1/reliabilitySnapshot.svelte.ts';
	import { reliabilityBadgeCopy } from '#lib/v1/verdict.copy.ts';
	import { stopBadgeCopy } from '#lib/features/stops/reliability/stops-reliability.copy.ts';

	export interface ReliabilityBadgeProps {
		snapshot: ReliabilitySnapshot;
		locale: Locale;
		class?: string;
	}

	let { snapshot, locale, class: className }: ReliabilityBadgeProps = $props();

	const copy = $derived((snapshot.kind === 'stop' ? stopBadgeCopy : reliabilityBadgeCopy)[locale]);
	const windowLabel = $derived(
		snapshot.closedThrough
			? copy.weekTo(
					new Intl.DateTimeFormat(locale, {
						month: 'short',
						day: 'numeric',
						timeZone: 'UTC',
					}).format(new Date(`${snapshot.closedThrough}T00:00:00Z`)),
				)
			: copy.week,
	);
	const hedges = {
		en: 'Not enough data to judge reliability',
		fr: 'Données insuffisantes pour juger la fiabilité',
	} as const;
	const compactHedges = {
		en: { tentative: 'Uncertain', absent: 'Not enough data' },
		fr: { tentative: 'Incertaine', absent: 'Données insuffisantes' },
	} as const;
	const pctText = $derived(
		snapshot.otpPct == null
			? null
			: intl.number(locale, { style: 'unit', unit: 'percent' }).format(snapshot.otpPct),
	);
	const show = $derived(snapshot.phase === 'ready' && pctText != null);
	const hedged = $derived(snapshot.verdict === 'absent' || snapshot.verdict === 'tentative');
	const label = $derived(pctText ? `${pctText} ${copy.share}, ${windowLabel}` : '');
	const hedgeLabel = $derived(snapshot.hedge ?? hedges[locale]);
</script>

<span class="reliability-slot">
	{#if show && hedged}
		<span
			data-slot="reliability-hedge"
			data-status={snapshot.verdict}
			class={['reliability-badge reliability-hedge', className].filter(Boolean).join(' ')}
			role="img"
			aria-label={`${hedgeLabel}, ${windowLabel}`}
			title={`${hedgeLabel}, ${windowLabel}`}
		>
			<span aria-hidden="true"
				>{compactHedges[locale][snapshot.verdict === 'tentative' ? 'tentative' : 'absent']}</span
			>
			<span aria-hidden="true">{windowLabel}</span>
		</span>
	{:else if show}
		<span
			class={['reliability-badge', className].filter(Boolean).join(' ')}
			data-slot="reliability-badge"
			data-status={snapshot.verdict}
			role="img"
			aria-label={label}
			title={label}
		>
			<span class="reliability-badge-pct" aria-hidden="true">{pctText}</span>
			<span aria-hidden="true">{windowLabel}</span>
		</span>
	{/if}
</span>

<style>
	.reliability-slot {
		display: block;
		min-block-size: 3lh;
		max-inline-size: 100%;
	}
	.reliability-badge {
		display: flex;
		flex-direction: column;
		overflow-wrap: anywhere;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
		font-variant-numeric: tabular-nums;
		white-space: normal;
	}
	.reliability-badge-pct {
		font-weight: 600;
	}
</style>
