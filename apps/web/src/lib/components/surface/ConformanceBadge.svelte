<!--
  ConformanceBadge — the per-provider GTFS feed-conformance chip.

  The data-quality half of the honesty layer: provenance.json carries a
  `conformance` verdict for the active provider's latest static load (the same
  signal /health surfaces DB-side). status='conformant' when the feed only
  shipped members the pipeline natively models; 'out_of_norm' when it shipped
  extra members — which we CAPTURE VERBATIM and never drop, then flag here.

  GRACEFUL BY CONTRACT: `conformance` is null when the provider has no current
  static dataset (a fresh agency that only ships realtime), so this renders
  NOTHING in that case — never a broken or alarming empty chip. An unknown
  future status string falls back to a neutral verdict, never an error.

  DOCTRINE (shared with FreshnessStamp): the dot encodes a DATA verdict on the
  dataviz status scale (on_time = conformant, caution = out-of-norm), never
  --primary. a11y: the dot carries an sr-only label and the verdict is also
  text + an explanatory title. Intrinsic bilingual vocabulary lives local.
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import { type Locale } from '$lib/i18n';
	import type { ProvenanceConformance } from '$lib/v1/schemas';
	import StatusDot from '$lib/components/brand/StatusDot.svelte';

	interface ConformanceBadgeProps {
		/** The provenance conformance verdict, or null/undefined when unchecked. */
		conformance: ProvenanceConformance | null | undefined;
		/** UI language for the intrinsic labels. */
		locale: Locale;
		/** Optional extra classes on the chip. */
		class?: string;
	}

	let { conformance, locale, class: className }: ConformanceBadgeProps = $props();

	type Labels = {
		readonly conformant: string;
		readonly outOfNorm: string;
		/** Compact under-chip line: {n} = unknown_members.length, members = preview. */
		readonly detail: (n: number, members: string) => string;
		readonly conformantTitle: string;
		/** Full hover detail: {rows} extra rows across the named fields. */
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

	// Tone: conformant → calm green; out_of_norm → caution amber; any unknown
	// future status string falls back to neutral (never an error). Keeps the chip
	// honest about a verdict it does not recognize rather than mislabelling it.
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

	// Detail line — only when out-of-norm AND the feed named the unexpected fields.
	// We show up to three member names, then a "+N" overflow, so the chip stays a
	// chip; the full count lives in the title.
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
