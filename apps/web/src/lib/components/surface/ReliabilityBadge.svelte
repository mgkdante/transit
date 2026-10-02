<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import type { ReliabilitySnapshot } from '$lib/v1/reliabilitySnapshot.svelte';

	export interface ReliabilityBadgeProps {
		snapshot: ReliabilitySnapshot;
		locale: Locale;
		class?: string;
	}

	let { snapshot, locale, class: className }: ReliabilityBadgeProps = $props();

	const labels = {
		en: (pct: string) => `${pct} on time in the latest daily summary`,
		fr: (pct: string) => `${pct} à l’heure dans le dernier bilan quotidien`,
	} as const;
	const nf = $derived(locale === 'fr' ? 'fr-CA' : 'en-CA');
	const pctText = $derived(
		snapshot.otpPct == null
			? null
			: `${snapshot.otpPct.toLocaleString(nf)}${locale === 'fr' ? ' %' : '%'}`,
	);
	const show = $derived(snapshot.phase === 'ready' && pctText != null);
	const label = $derived(pctText ? labels[locale](pctText) : '');
</script>

{#if show}
	<span
		class={['reliability-badge', className].filter(Boolean).join(' ')}
		data-slot="reliability-badge"
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
