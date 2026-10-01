<script lang="ts">
	import { cn } from '$lib/utils';
	import { formatRelative } from '$lib/utils/time';
	import { sharedClock } from '$lib/stores/clock.svelte';
	import type { Locale } from '$lib/i18n';
	import { describeAbsence, type AbsenceReason } from '$lib/site/absence';
	import { Skeleton } from '@yesid/ui/skeleton';
	import { DEFAULT_LOADING_SKELETON_DELAY_MS } from './loading';
	import StateNotice, {
		type StateNoticePresentation,
		type StateNoticeTone,
	} from './StateNotice.svelte';

	type EdgeVariant =
		| 'stale-offline'
		| 'skeleton'
		| 'no-results'
		| 'empty'
		| 'empty-avis'
		| 'error-v1';

	type EdgeLayout = 'mobile' | 'desktop';

	interface EdgeStateProps {
		variant: EdgeVariant;
		lang: Locale;
		layout?: EdgeLayout;
		lastUpdated?: string;
		onRetry?: () => void;
		emptyReason?: AbsenceReason | null;
		class?: string;
		skeletonDelayMs?: number;
		presentation?: Exclude<StateNoticePresentation, 'pill'>;
	}

	let {
		variant,
		lang,
		layout = 'mobile',
		lastUpdated,
		onRetry,
		emptyReason,
		class: className,
		skeletonDelayMs = DEFAULT_LOADING_SKELETON_DELAY_MS,
		presentation = 'responsive',
	}: EdgeStateProps = $props();

	type CopyBlock = {
		readonly glyph: string;
		readonly title: string;
		readonly body: string;
	};

	const COPY: Record<Exclude<EdgeVariant, 'skeleton'>, Record<Locale, CopyBlock>> = {
		'stale-offline': {
			fr: {
				glyph: '▲',
				title: 'Données en retard',
				body: 'Le flux temps réel est momentanément en retard. Les dernières valeurs connues sont affichées.',
			},
			en: {
				glyph: '▲',
				title: 'Data is behind',
				body: 'The realtime feed is briefly behind. Showing the last values we received.',
			},
		},
		'no-results': {
			fr: {
				glyph: '○',
				title: 'Aucun résultat',
				body: 'Aucune donnée ne correspond à ce filtre. Essayez d’élargir la recherche.',
			},
			en: {
				glyph: '○',
				title: 'No results',
				body: 'Nothing matches this filter. Try widening your search.',
			},
		},
		empty: {
			fr: {
				glyph: '○',
				title: 'Rien à afficher',
				body: 'Aucune donnée publiée pour cette vue pour le moment.',
			},
			en: {
				glyph: '○',
				title: 'Nothing to show',
				body: 'No data has been published for this view yet.',
			},
		},
		'empty-avis': {
			fr: {
				glyph: '○',
				title: 'Aucun avis',
				body: 'Aucun avis n’est signalé dans cette fenêtre.',
			},
			en: {
				glyph: '○',
				title: 'No alerts',
				body: 'No alerts are reported in this window.',
			},
		},
		'error-v1': {
			fr: {
				glyph: '◆',
				title: 'Données indisponibles',
				body: 'Ces données n’ont pas pu être chargées. Veuillez réessayer.',
			},
			en: {
				glyph: '◆',
				title: 'Data unavailable',
				body: 'We couldn’t load this data. Please try again.',
			},
		},
	};

	const RETRY_LABEL: Record<Locale, string> = {
		fr: 'Réessayer',
		en: 'Retry',
	};

	const MAJ_PREFIX: Record<Locale, string> = {
		fr: 'MAJ',
		en: 'Updated',
	};

	const LOADING_LABEL: Record<Locale, string> = {
		fr: 'Chargement…',
		en: 'Loading…',
	};

	const TONE: Record<Exclude<EdgeVariant, 'skeleton'>, StateNoticeTone> = {
		'stale-offline': 'warning',
		'no-results': 'neutral',
		empty: 'neutral',
		'empty-avis': 'neutral',
		'error-v1': 'error',
	};

	$effect(() => sharedClock.subscribe());

	const isSkeleton = $derived(variant === 'skeleton');
	let skeletonRevealed = $state(false);

	$effect(() => {
		const active = isSkeleton;
		const delay = Math.max(0, skeletonDelayMs);

		skeletonRevealed = false;
		if (!active) return;
		if (delay === 0) {
			skeletonRevealed = true;
			return;
		}

		const timeout = setTimeout(() => {
			skeletonRevealed = true;
		}, delay);
		return () => clearTimeout(timeout);
	});

	const activeReason = $derived(variant === 'empty' ? (emptyReason ?? null) : null);

	const copy = $derived.by((): CopyBlock | null => {
		if (isSkeleton) return null;
		if (activeReason) {
			const absence = describeAbsence(activeReason.key, lang, {
				first: activeReason.firstDeparture ?? '',
				age: activeReason.lastSeenIso
					? formatRelative(activeReason.lastSeenIso, lang, new Date(sharedClock.serverNow))
					: '',
			});
			return { glyph: '○', title: absence.label, body: absence.why };
		}
		return COPY[variant as Exclude<EdgeVariant, 'skeleton'>][lang];
	});
	const tone = $derived(isSkeleton ? null : TONE[variant as Exclude<EdgeVariant, 'skeleton'>]);

	const staleDelta = $derived(
		variant === 'stale-offline' && lastUpdated
			? `${MAJ_PREFIX[lang]} ${formatRelative(lastUpdated, lang, new Date(sharedClock.serverNow))}`
			: null,
	);

	const liveRole = $derived(variant === 'error-v1' ? 'alert' : 'status');

	const skeletonColumns = $derived(layout === 'desktop' ? [0, 1, 2] : [0]);
</script>

{#snippet staleMeta()}
	{#if staleDelta}
		<span data-slot="edge-stale-delta">{staleDelta}</span>
	{/if}
{/snippet}

{#snippet retryAction()}
	{#if variant === 'error-v1' && onRetry}
		<button type="button" class="edge-retry" onclick={onRetry} data-slot="edge-retry">
			{RETRY_LABEL[lang]}
		</button>
	{/if}
{/snippet}

{#if isSkeleton}
	<div
		class={cn(
			'rounded-lg border border-border bg-card p-4',
			layout === 'desktop' ? 'grid grid-cols-3 gap-4' : 'flex flex-col gap-3',
			!skeletonRevealed && 'edge-skeleton-pending',
			className,
		)}
		data-slot="edge-state"
		data-variant="skeleton"
		data-layout={layout}
		data-loading-state={skeletonRevealed ? 'visible' : 'pending'}
		role={skeletonRevealed ? 'status' : undefined}
		aria-busy={skeletonRevealed ? 'true' : undefined}
		aria-live={skeletonRevealed ? 'polite' : undefined}
		aria-hidden={skeletonRevealed ? undefined : 'true'}
	>
		{#if skeletonRevealed}
			<span class="sr-only">{LOADING_LABEL[lang]}</span>
		{/if}
		{#each skeletonColumns as col (col)}
			<div class="flex flex-col gap-3" aria-hidden="true">
				<div class="flex items-center gap-2">
					<Skeleton class="size-2.5 rounded-full" />
					<Skeleton class="h-3 w-24" />
				</div>
				<div class="flex flex-col gap-2">
					<Skeleton class="h-4 w-full" />
					<Skeleton class="h-4 w-5/6" />
					<Skeleton class="h-4 w-2/3" />
					{#if layout === 'mobile'}
						<Skeleton class="h-4 w-3/4" />
						<Skeleton class="h-4 w-1/2" />
					{/if}
				</div>
			</div>
		{/each}
	</div>
{:else if copy && tone}
	<StateNotice
		title={copy.title}
		body={copy.body}
		glyph={copy.glyph}
		{tone}
		{presentation}
		role={liveRole}
		ariaLive={variant === 'error-v1' ? 'assertive' : 'polite'}
		meta={staleDelta ? staleMeta : undefined}
		action={variant === 'error-v1' && onRetry ? retryAction : undefined}
		class={className}
		data-slot="edge-state"
		data-variant={variant}
		data-layout={layout}
	/>
{/if}

<style>
	.edge-skeleton-pending {
		visibility: hidden;
	}

	.edge-retry {
		min-height: var(--size-tap-min);
		font-family: var(--font-body);
		font-size: var(--text-small);
		font-weight: 600;
		color: var(--primary-foreground);
		background: var(--primary);
		border: none;
		border-radius: var(--radius-md);
		padding: 0.5rem 1.25rem;
		cursor: pointer;
		transition: background var(--duration-fast) var(--ease-default);
	}
	.edge-retry:hover {
		background: var(--primary-hover);
	}

	@media (prefers-reduced-motion: reduce) {
		.edge-retry {
			transition: none;
		}
	}
</style>
