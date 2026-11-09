<script lang="ts">
	import { intl } from '#lib/i18n/index.ts';
	import type { Locale } from '#lib/i18n/index.ts';
	import type { ReliabilitySnapshot } from '#lib/v1/reliabilitySnapshot.svelte.ts';

	export interface ReliabilityBadgeProps {
		snapshot: ReliabilitySnapshot;
		locale: Locale;
		class?: string;
	}

	let { snapshot, locale, class: className }: ReliabilityBadgeProps = $props();

	const labels = {
		en: (pct: string) => `${pct} on time in the latest summary`,
		fr: (pct: string) => `${pct} à l’heure dans le dernier bilan`,
	} as const;
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
	const label = $derived(pctText ? labels[locale](pctText) : '');
	const hedgeLabel = $derived(snapshot.hedge ?? hedges[locale]);
</script>

{#if show && hedged}
	<span
		data-slot="reliability-hedge"
		data-status={snapshot.verdict}
		class={['reliability-badge reliability-hedge', className].filter(Boolean).join(' ')}
		role="img"
		aria-label={hedgeLabel}
		title={hedgeLabel}
	>
		<span aria-hidden="true"
			>{compactHedges[locale][snapshot.verdict === 'tentative' ? 'tentative' : 'absent']}</span
		>
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
	</span>
{/if}

<style>
	.reliability-badge {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.reliability-badge-pct {
		font-weight: 600;
	}
</style>
