<script lang="ts">
	import { cn } from '$lib/utils';
	import { type Locale } from '$lib/i18n';
	import type { ProvenanceConformance } from '$lib/v1/schemas';
	import StatusDot from '$lib/components/brand/StatusDot.svelte';

	export interface ConformanceBadgeProps {
		conformance: ProvenanceConformance | null | undefined;
		locale: Locale;
		class?: string;
	}

	let { conformance, locale, class: className }: ConformanceBadgeProps = $props();

	type Labels = {
		readonly conformant: string;
		readonly outOfNorm: string;
		readonly detail: (n: number, members: string) => string;
		readonly conformantTitle: string;
		readonly outOfNormTitle: (rows: number, members: string) => string;
	};
	const L: Record<Locale, Labels> = {
		fr: {
			conformant: 'Flux conforme',
			outOfNorm: 'Flux hors-norme',
			detail: (n, members) =>
				`${n} champ${n > 1 ? 's' : ''} non modélisé${n > 1 ? 's' : ''} (${members})`,
			conformantTitle:
				'Le flux GTFS le plus récent ne contient que des champs que le pipeline modélise.',
			outOfNormTitle: (rows, members) =>
				`Le flux contient des champs hors du modèle standard (${members}) : ${rows.toLocaleString('fr-CA')} ligne(s) conservée(s) telles quelles, jamais supprimées.`,
		},
		en: {
			conformant: 'Feed compliant',
			outOfNorm: 'Feed out-of-norm',
			detail: (n, members) => `${n} unmodelled field${n > 1 ? 's' : ''} (${members})`,
			conformantTitle: 'The latest GTFS feed only carries fields the pipeline models.',
			outOfNormTitle: (rows, members) =>
				`The feed carries fields beyond the standard model (${members}): ${rows.toLocaleString('en-CA')} row(s) captured verbatim, never dropped.`,
		},
	};
	const t = $derived(L[locale]);

	const verdict = $derived.by<'conformant' | 'out_of_norm' | 'unknown'>(() => {
		const s = conformance?.status;
		if (s === 'conformant') return 'conformant';
		if (s === 'out_of_norm') return 'out_of_norm';
		return 'unknown';
	});

	const label = $derived(
		verdict === 'conformant'
			? t.conformant
			: verdict === 'out_of_norm'
				? t.outOfNorm
				: (conformance?.status ?? ''),
	);

	const members = $derived(conformance?.unknown_members ?? []);
	const memberPreview = $derived.by(() => {
		if (members.length === 0) return '';
		const head = members.slice(0, 3).join(', ');
		const rest = members.length - 3;
		return rest > 0 ? `${head}, +${rest}` : head;
	});
	const showDetail = $derived(verdict === 'out_of_norm' && members.length > 0);

	const title = $derived(
		verdict === 'out_of_norm'
			? t.outOfNormTitle(conformance?.extra_row_count ?? 0, members.join(', '))
			: t.conformantTitle,
	);
</script>

{#if conformance}
	<span
		class={cn('conformance-badge', className)}
		data-slot="conformance-badge"
		data-verdict={verdict}
		{title}
	>
		<StatusDot
			color={verdict === 'out_of_norm'
				? 'caution'
				: verdict === 'conformant'
					? 'on_time'
					: 'unknown'}
			{label}
		/>
		<span class="conformance-badge-label">{label}</span>
		{#if showDetail}
			<span class="conformance-badge-detail">· {t.detail(members.length, memberPreview)}</span>
		{/if}
	</span>
{/if}

<style>
	.conformance-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--foreground);
	}
	.conformance-badge-label {
		letter-spacing: 0.5px;
		text-transform: uppercase;
		color: var(--accent-text);
	}
	.conformance-badge[data-verdict='out_of_norm'] .conformance-badge-label {
		color: var(--dataviz-status-late);
	}
	.conformance-badge-detail {
		color: var(--muted-foreground);
		text-transform: none;
		letter-spacing: normal;
	}
</style>
