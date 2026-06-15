<!--
  EdgeState — the 6-variant edge-condition primitive (slice-9.2).

  One component for every "the data isn't the happy path" surface: loading,
  empty, stale, network-down, error. Layout-aware (desktop 3-volet vs mobile
  schedule-fallback card) and fully bilingual (FR/EN copy object below).

  Variants
    stale-offline  amber  — feed is behind; shows the last-MAJ delta so the
                            rider knows HOW stale ("MAJ il y a 4 min").
    skeleton              — loading placeholder; layout-aware (desktop = 3-volet
                            shimmer columns, mobile = a single schedule-fallback
                            card of shimmer rows).
    no-results            — a filter/search returned nothing for THIS query.
    empty                — a surface has no data yet (never populated).
    empty-avis    green   — the GOOD empty: zero alerts ⇒ "le réseau roule
                            normalement". Green is a DATA verdict (network
                            healthy), so it rides the dataviz status scale.
    error-v1      red     — the /v1 contract is unreachable; offers retry and
                            states the honesty pledge ("on n'invente jamais de
                            données").

  DOCTRINE
    Edge conditions are DATA verdicts, so their colour rides the dataviz status
    scale — NEVER --primary/--success/--destructive:
      stale  -> --dataviz-status-late   (amber)
      empty-avis -> --dataviz-status-on-time (green)
      error  -> --dataviz-status-severe (red)
    The lone --primary touch is the retry BUTTON (an interactive affordance,
    not a data mark). Surfaces stay solid (no alpha on the card bg).

  a11y
    Status is glyph + colour + text — never colour alone. The container is a
    polite live region (role=status) so screen readers announce the verdict;
    error-v1 escalates to role=alert. The icon-only nuance carries aria-hidden.
-->
<script lang="ts">
	import { cn } from '$lib/utils';
	import { formatRelative } from '$lib/utils/time';
	import type { Locale } from '$lib/i18n';
	import { Skeleton } from '$lib/components/ui/skeleton';

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
		 * (Interactive affordance — the only --primary touch in this component.)
		 */
		onRetry?: () => void;
		/** Optional extra classes on the root. */
		class?: string;
	}

	let {
		variant,
		lang,
		layout = 'mobile',
		lastUpdated,
		onRetry,
		class: className,
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

	const COPY: Record<
		Exclude<EdgeVariant, 'skeleton'>,
		Record<Locale, CopyBlock>
	> = {
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
				glyph: '●',
				title: 'Aucun avis',
				body: 'Le réseau roule normalement — aucune perturbation signalée.',
			},
			en: {
				glyph: '●',
				title: 'No alerts',
				body: 'The network is running normally — no disruptions reported.',
			},
		},
		'error-v1': {
			fr: {
				glyph: '◆',
				title: 'Contrat /v1 injoignable',
				body: 'Impossible de joindre la source de données. On n’invente jamais de données : rien ne s’affiche tant que le contrat /v1 n’est pas rétabli.',
			},
			en: {
				glyph: '◆',
				title: '/v1 contract unreachable',
				body: 'We can’t reach the data source. We never invent data: nothing is shown until the /v1 contract is restored.',
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

	/* ── Per-variant doctrine accent ─────────────────────────────────────────
	   Edge verdict colours ride the dataviz status scale (DATA), never the
	   semantic affordance tokens. text-* gives the glyph its hue; the rule maps
	   the matching border-rule var for the accent bar. */
	const ACCENT: Record<Exclude<EdgeVariant, 'skeleton'>, { text: string; rule: string }> = {
		'stale-offline': {
			text: 'text-dataviz-status-late',
			rule: 'var(--dataviz-status-late)',
		},
		'no-results': {
			text: 'text-dataviz-status-unknown',
			rule: 'var(--dataviz-status-unknown)',
		},
		empty: {
			text: 'text-dataviz-status-unknown',
			rule: 'var(--dataviz-status-unknown)',
		},
		'empty-avis': {
			text: 'text-dataviz-status-on-time',
			rule: 'var(--dataviz-status-on-time)',
		},
		'error-v1': {
			text: 'text-dataviz-status-severe',
			rule: 'var(--dataviz-status-severe)',
		},
	};

	const isSkeleton = $derived(variant === 'skeleton');

	/** Resolved copy for the active message variant (skeleton excluded). */
	const copy = $derived(
		isSkeleton ? null : COPY[variant as Exclude<EdgeVariant, 'skeleton'>][lang],
	);
	const accent = $derived(
		isSkeleton ? null : ACCENT[variant as Exclude<EdgeVariant, 'skeleton'>],
	);

	/** Relative "MAJ il y a 4 min" string for the stale variant. */
	const staleDelta = $derived(
		variant === 'stale-offline' && lastUpdated
			? `${MAJ_PREFIX[lang]} ${formatRelative(lastUpdated, lang)}`
			: null,
	);

	/** error-v1 escalates to role=alert; the rest are polite status regions. */
	const liveRole = $derived(variant === 'error-v1' ? 'alert' : 'status');

	/** Desktop renders three skeleton volets; mobile renders one schedule card. */
	const skeletonColumns = $derived(layout === 'desktop' ? [0, 1, 2] : [0]);
</script>

{#if isSkeleton}
	<!--
	  Skeleton — layout-aware loading scaffold.
	  Desktop: a 3-volet grid of shimmer columns (mirrors the desktop 3-panel
	  shell). Mobile: a single "schedule-fallback" card — header row + a stack of
	  departure-row placeholders. aria-busy + an sr-only label so AT announces the
	  load instead of an empty region.
	-->
	<div
		class={cn(
			'rounded-lg border border-border bg-card p-4 shadow-card',
			layout === 'desktop' ? 'grid grid-cols-3 gap-4' : 'flex flex-col gap-3',
			className,
		)}
		data-slot="edge-state"
		data-variant="skeleton"
		data-layout={layout}
		role="status"
		aria-busy="true"
		aria-live="polite"
	>
		<span class="sr-only">{LOADING_LABEL[lang]}</span>
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
{:else if copy && accent}
	<!--
	  Message variants — glyph + title + body + (stale delta | retry).
	  role/aria-live escalate for error-v1. The accent bar + glyph carry the
	  doctrine colour; copy stays on the foreground/muted scale.
	-->
	<div
		class={cn(
			'flex flex-col items-center gap-3 rounded-lg border border-border bg-card text-center shadow-card edge-accent-bar',
			layout === 'desktop' ? 'p-8' : 'p-6',
			className,
		)}
		style="--edge-rule: {accent.rule};"
		data-slot="edge-state"
		data-variant={variant}
		data-layout={layout}
		role={liveRole}
		aria-live={variant === 'error-v1' ? 'assertive' : 'polite'}
	>
		<!-- Glyph: doctrine-coloured + text label, never colour alone. -->
		<span
			class={cn('font-mono leading-none', accent.text)}
			style="font-size: var(--text-heading);"
			aria-hidden="true">{copy.glyph}</span
		>

		<div class="flex flex-col gap-1.5">
			<span class="font-heading font-bold text-body text-[var(--foreground)]"
				>{copy.title}</span
			>
			<p
				class={cn(
					'font-body text-small text-[var(--muted-foreground)]',
					layout === 'desktop' ? 'max-w-md' : 'max-w-xs',
				)}
			>
				{copy.body}
			</p>
		</div>

		{#if staleDelta}
			<!-- Last-MAJ delta — amber mono caption, the proof of HOW stale. -->
			<span class={cn('font-mono text-caption', accent.text)} data-slot="edge-stale-delta">
				{staleDelta}
			</span>
		{/if}

		{#if variant === 'error-v1' && onRetry}
			<!-- Retry — the lone interactive affordance (the only --primary touch). -->
			<button type="button" class="edge-retry" onclick={onRetry} data-slot="edge-retry">
				{RETRY_LABEL[lang]}
			</button>
		{/if}
	</div>
{/if}

<style>
	/* Visually-hidden label — readable by AT, invisible on screen. */
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	/* Accent bar — a 3px top rule in the variant's doctrine colour. Pulled from
	   the --edge-rule custom prop set inline per variant. */
	.edge-accent-bar {
		border-top: 3px solid var(--edge-rule);
	}

	/* Retry button — interactive affordance, so --primary is doctrine-clean here.
	   Solid orange fill, brand pill, visible focus inherited from the base ring. */
	.edge-retry {
		font-family: var(--font-body);
		font-size: var(--text-small);
		font-weight: 600;
		color: var(--primary-foreground);
		background: var(--primary);
		border: none;
		border-radius: var(--radius-md);
		padding: 0.5rem 1.25rem;
		cursor: pointer;
		transition: background 150ms ease;
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
