<script lang="ts">
	import { intl } from '$lib/i18n';
	import type { Locale } from '$lib/i18n';
	import type { ReliabilitySnapshot } from '$lib/v1/reliabilitySnapshot.svelte';

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
	const pctText = $derived(
		snapshot.otpPct == null
			? null
			: intl.number(locale, { style: 'unit', unit: 'percent' }).format(snapshot.otpPct),
	);
	const show = $derived(snapshot.phase === 'ready' && pctText != null);
	const hedged = $derived(snapshot.verdict === 'absent' || snapshot.verdict === 'tentative');
	const label = $derived(pctText ? labels[locale](pctText) : '');
</script>

{#if show && hedged}
	<span
		data-slot="reliability-hedge"
		data-status={snapshot.verdict}
		class={['reliability-hedge', className].filter(Boolean).join(' ')}
		>{snapshot.hedge ?? hedges[locale]}</span
	>
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
	.reliability-hedge {
		display: block;
		max-inline-size: var(--measure-display);
		font-size: var(--text-small);
		white-space: normal;
		overflow-wrap: anywhere;
	}

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
