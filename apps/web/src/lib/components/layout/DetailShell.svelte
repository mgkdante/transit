<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import { Separator } from '@yesid/ui/separator';
	import TocPill from '$lib/components/shared/TocPill.svelte';
	import { observeActiveToc, type TocEntry } from '$lib/components/shared/toc';
	import SurfaceRail, { type SurfaceRailContext } from '$lib/components/surface/SurfaceRail.svelte';
	import ArticleSummaryLane from './ArticleSummaryLane.svelte';

	export interface DetailShellCombinedRailConfig {
		label: string;
		summary?: string;
		openAria: string;
		closeAria: string;
		class?: string;
	}
	interface DetailShellBaseProps {
		header?: Snippet;
		articleHeader?: Snippet;
		toolbar?: Snippet;
		summary?: Snippet;
		center: Snippet;
		right?: Snippet;
		mobileSummary?: Snippet;
		tocEntries: TocEntry[];
		activeId?: string;
		cta?: Snippet;
		class?: string;
		leftMobile?: boolean;
		paneOwnedRail?: boolean;
	}
	type DetailShellLegacyRailProps = {
		left?: Snippet;
		combinedRail?: never;
		combinedRailConfig?: never;
		mobileTocEntries?: TocEntry[];
		onNavigate?: (id: string) => void;
		tocOpenAria?: string;
		tocCloseAria?: string;
	};
	type DetailShellCombinedRailProps = {
		left?: never;
		combinedRail: Snippet<[SurfaceRailContext]>;
		combinedRailConfig: DetailShellCombinedRailConfig | undefined;
		mobileTocEntries?: never;
		onNavigate?: never;
		tocOpenAria?: never;
		tocCloseAria?: never;
	};
	export type DetailShellProps = DetailShellBaseProps &
		(DetailShellLegacyRailProps | DetailShellCombinedRailProps);

	let {
		header,
		articleHeader,
		toolbar,
		summary,
		left,
		combinedRail,
		combinedRailConfig,
		center,
		right,
		mobileSummary,
		tocEntries,
		mobileTocEntries,
		activeId = $bindable(''),
		onNavigate,
		tocOpenAria,
		tocCloseAria,
		cta,
		leftMobile = false,
		paneOwnedRail = false,
		class: className,
	}: DetailShellProps = $props();

	$effect(() => {
		const signature = tocEntries.map((entry) => entry.id).join('|');
		let cancelled = false;
		let stop: (() => void) | undefined;

		void (async () => {
			void signature;
			await tick();
			if (!cancelled) stop = observeActiveToc((id) => (activeId = id));
		})();

		return () => {
			cancelled = true;
			stop?.();
		};
	});

	const pillEntries = $derived(mobileTocEntries ?? tocEntries);
	const rendersLeftRail = $derived(Boolean(left || (combinedRail && combinedRailConfig)));
</script>

<article data-slot="detail-shell" class={cn('detail-shell', className)}>
	{#if articleHeader}
		{@render articleHeader()}
	{:else if header}
		<div class="detail-shell-header detail-header-grid" data-slot="detail-shell-header">
			<div class="detail-shell-header__inner">
				{@render header()}
			</div>
		</div>
	{/if}

	<Separator variant="hazard" hazardSize="sm" maxWidth="100%" class="detail-shell-tape" />

	{#if toolbar}
		<div class="detail-shell-toolbar" data-slot="detail-shell-toolbar">
			<div class="detail-shell-toolbar__inner">{@render toolbar()}</div>
		</div>
	{/if}

	{#if mobileSummary}
		<div class="detail-shell-mobile-summary" data-slot="detail-shell-mobile-summary">
			{@render mobileSummary()}
		</div>
	{/if}

	<div
		class="detail-shell-grid"
		class:detail-shell-grid--three={rendersLeftRail && Boolean(right)}
		class:detail-shell-grid--two={rendersLeftRail && !right}
		class:detail-shell-grid--single={!rendersLeftRail && !right}
		class:detail-shell-grid--pane-owned={paneOwnedRail}
	>
		{#if combinedRail && combinedRailConfig}
			<SurfaceRail
				rail={combinedRail}
				label={combinedRailConfig.label}
				summary={combinedRailConfig.summary}
				openAria={combinedRailConfig.openAria}
				closeAria={combinedRailConfig.closeAria}
				class={combinedRailConfig.class}
			/>
		{:else if left}
			<aside
				class="detail-shell-rail detail-shell-rail--left"
				class:detail-shell-rail--mobile={leftMobile}
				data-slot="detail-shell-left"
			>
				{@render left()}
			</aside>
		{/if}

		<div class="detail-shell-center" data-slot="detail-shell-center">
			{#if summary}
				<ArticleSummaryLane data-slot="detail-shell-summary">
					{@render summary()}
				</ArticleSummaryLane>
			{/if}
			{@render center()}
		</div>

		{#if right}
			<aside class="detail-shell-rail detail-shell-rail--right" data-slot="detail-shell-right">
				{@render right()}
			</aside>
		{/if}
	</div>

	{#if cta}
		<div class="detail-shell-cta" data-slot="detail-shell-cta">{@render cta()}</div>
	{/if}
</article>

{#if !combinedRail && pillEntries.length > 0 && onNavigate && tocOpenAria && tocCloseAria}
	<TocPill
		entries={pillEntries}
		{activeId}
		openAria={tocOpenAria}
		closeAria={tocCloseAria}
		{onNavigate}
	/>
{/if}

<style>
	.detail-shell {
		display: block;
		--detail-rail-width: var(--layout-control-rail-width);
		--detail-support-rail-width: var(--layout-support-rail-width);
		--detail-center-min: var(--layout-article-main-min);
		--detail-center-max: var(--container-content);
		--detail-column-gap: 2rem;
	}

	.detail-shell-header {
		position: relative;
		overflow: hidden;
		padding-block: clamp(1.75rem, 4vw, 3rem);
		padding-inline: var(--space-page-x);
		background: var(--manifesto);
	}
	.detail-shell-header__inner {
		position: relative;
		z-index: 1;
		max-width: var(--container-content);
		margin-inline: auto;
	}

	.detail-shell-toolbar {
		width: 100%;
		padding: 0;
		background: var(--primary);
	}
	.detail-shell-toolbar__inner {
		width: 100%;
	}

	.detail-shell-mobile-summary {
		display: block;
		padding-inline: var(--space-page-x);
		margin-block-start: 1.5rem;
	}

	.detail-shell-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-card-gap);
		padding-inline: var(--space-page-x);
		padding-block: var(--layout-article-top-space);
		min-width: 0;
		overflow-x: clip;
	}

	.detail-shell-center {
		min-width: 0;
		width: 100%;
		max-width: var(--detail-center-max);
	}

	.detail-shell-rail {
		display: none;
	}
	.detail-shell-rail--mobile {
		display: block;
		min-width: 0;
	}

	@media (min-width: 1024px) {
		.detail-shell-grid {
			grid-template-columns: var(--detail-rail-width) minmax(0, var(--detail-center-max));
			gap: var(--detail-column-gap);
			padding-block: var(--layout-article-top-space);
			align-items: stretch;
			justify-content: center;
		}
		.detail-shell-grid--two {
			grid-template-columns: var(--detail-rail-width) minmax(0, var(--detail-center-max));
			justify-content: center;
		}
		.detail-shell-grid--single {
			grid-template-columns: minmax(0, 1fr);
		}
		.detail-shell-grid--pane-owned {
			grid-template-columns: minmax(0, 1fr);
		}
		.detail-shell-mobile-summary {
			display: none;
		}
		.detail-shell-rail {
			display: block;
			position: sticky;
			top: var(--chrome-offset);
			align-self: start;
			max-height: calc(100dvh - var(--chrome-offset));
			overflow-y: auto;
		}
		.detail-shell-rail--left {
			grid-column: 1;
			justify-self: stretch;
			width: 100%;
		}
		.detail-shell-grid > :global([data-slot='surface-rail']) {
			grid-column: 1;
			justify-self: stretch;
			width: 100%;
		}
		.detail-shell-center {
			grid-column: 2;
			justify-self: stretch;
			max-width: var(--detail-center-max);
		}
		.detail-shell-grid--three .detail-shell-rail--right {
			position: static;
			grid-column: 2;
			grid-row: 2;
			justify-self: stretch;
			width: 100%;
			max-height: none;
			overflow: visible;
		}
		.detail-shell-grid--two .detail-shell-rail--left,
		.detail-shell-grid--two > :global([data-slot='surface-rail']) {
			justify-self: stretch;
			width: 100%;
		}
		.detail-shell-grid--two .detail-shell-center {
			justify-self: stretch;
			max-width: var(--detail-center-max);
		}
		.detail-shell-grid--single .detail-shell-center {
			grid-column: 1;
		}
		.detail-shell-grid--pane-owned .detail-shell-rail--left {
			position: static;
			grid-column: 1;
			width: 100%;
			max-height: none;
			overflow: visible;
			justify-self: stretch;
		}
		.detail-shell-grid--pane-owned .detail-shell-center {
			grid-column: 1;
			max-width: none;
			justify-self: stretch;
		}
	}

	@media (min-width: 1440px) {
		.detail-shell-grid--three {
			grid-template-columns:
				var(--detail-rail-width)
				minmax(var(--detail-center-min), var(--detail-center-max))
				var(--detail-support-rail-width);
			justify-content: center;
		}
		.detail-shell-grid--three .detail-shell-rail--right {
			position: sticky;
			grid-column: 3;
			grid-row: 1;
			justify-self: stretch;
			width: 100%;
			max-height: calc(100dvh - var(--chrome-offset));
			overflow-y: auto;
		}
	}

	@media (min-width: 1024px) and (max-width: 1279px) {
		.detail-shell-grid {
			gap: var(--detail-column-gap);
		}
		.detail-shell-rail--left,
		.detail-shell-rail--right,
		.detail-shell-center {
			width: 100%;
			justify-self: stretch;
		}
	}

	.detail-shell-cta {
		margin-block-start: 1rem;
	}
</style>
