<!--
  EdgeState, the 6-variant edge-condition primitive (slice-9.2).

  One component for every "the data isn't the happy path" surface: loading,
  empty, stale, network-down, error. Layout-aware (desktop 3-volet vs mobile
  schedule-fallback card) and fully bilingual (FR/EN copy object below).

  Variants
    stale-offline  amber , feed is behind; shows the last-MAJ delta so the
                            rider knows HOW stale ("MAJ il y a 4 min").
    skeleton             , loading placeholder; layout-aware (desktop = 3-volet
                            shimmer columns, mobile = a single schedule-fallback
                            card of shimmer rows).
    no-results           , a filter/search returned nothing for THIS query.
    empty               , a surface has no data yet (never populated).
    empty-avis           , no alerts reported in this window, without inferring
                            whether service is running normally.
    error-v1      red    , this data could not load; offers retry when supplied.

  DOCTRINE
    Edge-condition glyphs and non-error verdict rules ride the dataviz status
    scale, NEVER --primary/--success/--destructive:
      stale  -> --dataviz-status-late   (amber)
      empty-avis -> neutral (absence of reports is not a service verdict)
      error  -> --dataviz-status-severe glyph (red), normal card border
    The lone --primary touch is the retry BUTTON (an interactive affordance,
    not a data mark). Surfaces stay solid (no alpha on the card bg).

  a11y
    Status is glyph + colour + text, never colour alone. The container is a
    polite live region (role=status) so screen readers announce the verdict;
    error-v1 escalates to role=alert. The icon-only nuance carries aria-hidden.
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import { formatRelative } from '$lib/utils/time';
	// Import the leaf store directly, NOT via the `$lib/stores` barrel: the barrel
	// re-exports theme.svelte (which reads `document` at module load), so pulling it
	// would drag a browser-only read into pure-node consumers of the edge barrel
	// (e.g. dataviz → MetricDisplay in node tests). EdgeState only needs the clock.
	import { sharedClock } from '$lib/stores/clock.svelte';
	import type { Locale } from '$lib/i18n';
	import { describeAbsence, type AbsenceReason } from '$lib/site/absence';
	import { Skeleton } from '@yesid/ui/skeleton';
	import { DEFAULT_LOADING_SKELETON_DELAY_MS } from './loading';
	import StateNotice, {
		type StateNoticePresentation,
		type StateNoticeTone,
	} from './StateNotice.svelte';

	/** The edge condition this instance renders. */
	type EdgeVariant =
		| 'stale-offline'
		| 'skeleton'
		| 'no-results'
		| 'empty'
		| 'empty-avis'
		| 'error-v1';

	/** Which layout the host surface is in (drives the skeleton shape + density). */
	type EdgeLayout = 'mobile' | 'desktop';

	interface EdgeStateProps {
		/** Edge condition to render. */
		variant: EdgeVariant;
		/** UI language for the copy object. */
		lang: Locale;
		/**
		 * Host layout. Drives the skeleton shape (desktop 3-volet vs mobile
		 * schedule card) and the message-block density. Defaults to 'mobile'.
		 */
		layout?: EdgeLayout;
		/**
		 * ISO 8601 (UTC) timestamp of the last successful data build. Rendered as
		 * a relative "last MAJ" delta on the stale-offline variant. Ignored by the
		 * other variants.
		 */
		lastUpdated?: string;
		/**
		 * Retry handler. When provided on error-v1, renders the retry button.
		 * (Interactive affordance, the only --primary touch in this component.)
		 */
		onRetry?: () => void;
		/**
		 * HONEST ABSENCE — an inferred, specific reason live data is absent (from
		 * $lib/site/serviceWindow.inferAbsenceReason). When set on the `empty`
		 * variant, it REPLACES the generic empty copy with the precise reason
		 * ("Service closed — opens at 06:00", "metro has no realtime", …) using the
		 * data we already hold. null/undefined ⇒ the generic empty copy stands (a
		 * plain honest no-data message, never fabricated). Ignored by other variants.
		 */
		emptyReason?: AbsenceReason | null;
		/** Optional extra classes on the root. */
		class?: string;
		/**
		 * Grace period before a loading skeleton becomes visible. The default avoids
		 * flashing a placeholder for fast cached reads; pass 0 for static specimens.
		 */
		skeletonDelayMs?: number;
		/** Message geometry. Skeleton composition continues to use `layout`. */
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

	/* ── Bilingual copy ──────────────────────────────────────────────────────
	   Every string both languages. `staleDelta` is a function so the relative
	   time slots in; the FR voice is the canonical product voice (matches the
	   raw-FR v1 headers), EN is the parallel translation. */
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

	/** Retry button label. */
	const RETRY_LABEL: Record<Locale, string> = {
		fr: 'Réessayer',
		en: 'Retry',
	};

	/** "Last updated" prefix for the stale delta. */
	const MAJ_PREFIX: Record<Locale, string> = {
		fr: 'MAJ',
		en: 'Updated',
	};

	/** Skeleton accessible label (announced while loading). */
	const LOADING_LABEL: Record<Locale, string> = {
		fr: 'Chargement…',
		en: 'Loading…',
	};

	/* Semantic colour belongs to the notice glyph/meta, never its frame. */
	const TONE: Record<Exclude<EdgeVariant, 'skeleton'>, StateNoticeTone> = {
		'stale-offline': 'warning',
		'no-results': 'neutral',
		empty: 'neutral',
		'empty-avis': 'neutral',
		'error-v1': 'error',
	};

	// Keep the ONE shared clock alive while this edge state is on screen so the
	// last-seen / stale "MAJ N ago" relative readouts tick in lockstep with the
	// rest of the chrome (and re-derive off the shared SERVER tick below).
	$effect(() => sharedClock.subscribe());

	const isSkeleton = $derived(variant === 'skeleton');
	let skeletonRevealed = $state(false);

	// Keep the skeleton mounted from the first render so it reserves its final
	// geometry during SSR/hydration, but reveal and announce it only when the load
	// outlives the shared grace period. Effect cleanup prevents a fast resource
	// from revealing a stale skeleton after its loaded content has replaced it.
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

	/**
	 * The inferred reason, applied ONLY on the empty variant. Other variants
	 * (error / stale / skeleton) ignore it — an error must never be mislabeled as
	 * "closed", and a reason has no meaning on the loading skeleton.
	 */
	const activeReason = $derived(variant === 'empty' ? (emptyReason ?? null) : null);

	/**
	 * Resolved copy for the active message variant (skeleton excluded). When an
	 * inferred reason is active, its specific copy REPLACES the generic empty copy.
	 * The opens-at variants interpolate the FIRST departure; last-seen interpolates
	 * the relative age of the vehicle's last report (never a fabricated time).
	 */
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

	/** Relative "MAJ il y a 4 min" string for the stale variant. */
	const staleDelta = $derived(
		variant === 'stale-offline' && lastUpdated
			? // lastUpdated is the SERVER build timestamp → anchor the age to the shared
				// SERVER clock so a skewed client can't mis-report how stale the feed is;
				// re-derives off the shared tick.
				`${MAJ_PREFIX[lang]} ${formatRelative(lastUpdated, lang, new Date(sharedClock.serverNow))}`
			: null,
	);

	/** error-v1 escalates to role=alert; the rest are polite status regions. */
	const liveRole = $derived(variant === 'error-v1' ? 'alert' : 'status');

	/** Desktop renders three skeleton volets; mobile renders one schedule card. */
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
	<!--
	  Skeleton, layout-aware loading scaffold.
	  Desktop: a 3-volet grid of shimmer columns (mirrors the desktop 3-panel
	  shell). Mobile: a single "schedule-fallback" card, header row + a stack of
	  departure-row placeholders. aria-busy + an sr-only label so AT announces the
	  load instead of an empty region.
	-->
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
				<!-- Volet / card header -->
				<div class="flex items-center gap-2">
					<Skeleton class="size-2.5 rounded-full" />
					<Skeleton class="h-3 w-24" />
				</div>
				<!-- Schedule-fallback rows -->
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
	/* Reserve the eventual skeleton geometry without flashing it during fast,
	   cache-hit loads. `visibility` keeps the box in layout and is SSR-safe. */
	.edge-skeleton-pending {
		visibility: hidden;
	}

	/* Retry button, interactive affordance, so --primary is doctrine-clean here.
	   Solid orange fill, brand pill, visible focus inherited from the base ring. */
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
