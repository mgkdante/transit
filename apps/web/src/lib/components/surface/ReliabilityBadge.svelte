<script lang="ts">
	import type { Locale } from '$lib/i18n';
	import type { StatusCode } from '$lib/v1/schemas';
	import type { ReliabilitySnapshot } from '$lib/v1/reliabilitySnapshot.svelte';
	import { StatusBadge } from '$lib/components/dataviz';

	export interface ReliabilityBadgeProps {
		snapshot: ReliabilitySnapshot;
		locale: Locale;
		class?: string;
	}

	let { snapshot, locale, class: className }: ReliabilityBadgeProps = $props();

	const L = {
		en: {
			onTime: (pct: string) => `${pct} on time`,
			verdict: { on_time: 'On time', late: 'Late', severe: 'Severe' } as Record<string, string>,
		},
		fr: {
			onTime: (pct: string) => `${pct} à l’heure`,
			verdict: {
				on_time: 'À l’heure',
				late: 'En retard',
				severe: 'Grave',
			} as Record<string, string>,
		},
	} as const;
	const t = $derived(L[locale]);

	const nf = $derived(locale === 'fr' ? 'fr-CA' : 'en-CA');
	const pctText = $derived(
		snapshot.otpPct == null
			? null
			: `${snapshot.otpPct.toLocaleString(nf)}${locale === 'fr' ? ' %' : '%'}`,
	);

	const show = $derived(snapshot.phase === 'ready' && snapshot.verdict != null && pctText != null);
	const verdict = $derived(snapshot.verdict as StatusCode);
	const verdictLabel = $derived(snapshot.verdict ? (t.verdict[snapshot.verdict] ?? '') : '');
	const a11y = $derived(pctText ? `${verdictLabel} · ${t.onTime(pctText)}` : verdictLabel);
</script>

{#if show}
	<span
		class={['reliability-badge', className].filter(Boolean).join(' ')}
		data-slot="reliability-badge"
		data-verdict={verdict}
		role="img"
		aria-label={a11y}
		title={a11y}
	>
		<span aria-hidden="true" class="reliability-badge-mark">
			<StatusBadge status={verdict} mode="dot" size="sm" label={verdictLabel} />
		</span>
		<span class="reliability-badge-pct" aria-hidden="true">{pctText}</span>
	</span>
{/if}

<style>
	.reliability-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.reliability-badge-mark {
		display: contents;
	}
	.reliability-badge-pct {
		font-weight: 600;
	}
</style>
