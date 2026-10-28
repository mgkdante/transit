<!--
  Detail and article page frame: header, hazard rule, optional toolbar band, then a grid of an
  optional left rail, the center and an optional right rail, then `after`. Frame rails stick
  below the site chrome (`--detail-rail-top`, default `--chrome-offset`) and hide below 1024px
  unless `leftMobile`. `rail` replaces the left cell with the caller's own element, such as a rail
  that turns into a sheet on mobile. With `toc`, the frame tracks the active entry and shows
  TocPill below 1024px unless `rail` is set.
-->
<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { TocEntry } from '../brand/toc.js';

	export interface DetailFrameToc {
		entries: TocEntry[];
		/** Entries for the mobile pill, when they differ. */
		pillEntries?: TocEntry[];
		openAria: string;
		closeAria: string;
		onNavigate?: (id: string) => void;
		/** Targets observed for the active entry; defaults to `TOC_TARGET_SELECTOR`. */
		selector?: string;
		/** Correct same-page fragment landings with `landTocFragments`. */
		landFragments?: boolean;
	}

	export interface DetailFrameProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
		header?: Snippet;
		toolbar?: Snippet;
		/** Top of the center column. */
		summary?: Snippet;
		/** Below the toolbar, below 1024px only. */
		mobileSummary?: Snippet;
		left?: Snippet;
		rail?: Snippet;
		children: Snippet;
		right?: Snippet;
		after?: Snippet;
		leftMobile?: boolean;
		/** Stacks the left rail above the center at every width. */
		paneOwnedRail?: boolean;
		/** Center track maximum in the three-column layout, such as `46rem` for reading. */
		measure?: string;
		/** Caps rails to the viewport and scrolls them internally. */
		railScroll?: boolean;
		toc?: DetailFrameToc;
		activeId?: string;
	}
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import { scrollChain } from '@yesid/motion/actions';
	import { cn } from '../cn/index.js';
	import { Separator } from '../primitives/separator/index.js';
	import TocPill from '../brand/TocPill.svelte';
	import { landTocFragments, observeActiveToc } from '../brand/toc.js';

	let {
		header,
		toolbar,
		summary,
		mobileSummary,
		left,
		rail,
		children,
		right,
		after,
		leftMobile = false,
		paneOwnedRail = false,
		measure,
		railScroll = false,
		toc,
		activeId = $bindable(''),
		class: className,
		style,
		...rest
	}: DetailFrameProps = $props();

	$effect(() => {
		if (!toc) return;
		const signature = toc.entries.map((entry) => entry.id).join('|');
		const selector = toc.selector;
		let cancelled = false;
		let stop: (() => void) | undefined;

		void (async () => {
			void signature;
			await tick();
			if (!cancelled) stop = observeActiveToc((id) => (activeId = id), selector);
		})();

		return () => {
			cancelled = true;
			stop?.();
		};
	});

	$effect(() => {
		if (toc?.landFragments) return landTocFragments();
	});

	const hasLeft = $derived(Boolean(left || rail));
	const pillEntries = $derived(toc ? (toc.pillEntries ?? toc.entries) : []);
	const frameStyle = $derived(
		[measure ? `--detail-measure: ${measure}` : '', style ?? ''].filter(Boolean).join('; ') ||
			undefined,
	);
</script>

<article
	{...rest}
	data-slot="detail-shell"
	class={cn('detail-shell', className)}
	style={frameStyle}
>
	{@render header?.()}

	<Separator variant="hazard" class="detail-shell-tape" />

	{#if toolbar}
		<div class="detail-shell-toolbar" data-slot="detail-shell-toolbar">
			{@render toolbar()}
		</div>
	{/if}

	{#if mobileSummary}
		<div class="detail-shell-mobile-summary" data-slot="detail-shell-mobile-summary">
			{@render mobileSummary()}
		</div>
	{/if}

	<div
		class="detail-shell-grid"
		class:detail-shell-grid--three={hasLeft && Boolean(right)}
		class:detail-shell-grid--two={hasLeft && !right}
		class:detail-shell-grid--right={!hasLeft && Boolean(right)}
		class:detail-shell-grid--pane-owned={paneOwnedRail}
		class:detail-shell-grid--measured={Boolean(measure)}
		class:detail-shell-grid--scroll={railScroll}
	>
		{#if rail}
			{@render rail()}
		{:else if left}
			<aside
				use:scrollChain
				class="detail-shell-rail detail-shell-rail--left"
				class:detail-shell-rail--mobile={leftMobile}
				data-slot="detail-shell-left"
			>
				{@render left()}
			</aside>
		{/if}

		<div class="detail-shell-center" data-slot="detail-shell-center">
			{#if summary}
				<div data-slot="detail-shell-summary">{@render summary()}</div>
			{/if}
			{@render children()}
		</div>

		{#if right}
			<aside
				use:scrollChain
				class="detail-shell-rail detail-shell-rail--right"
				data-slot="detail-shell-right"
			>
				{@render right()}
			</aside>
		{/if}
	</div>

	{@render after?.()}
</article>

{#if toc && !rail && pillEntries.length > 0}
	<TocPill
		entries={pillEntries}
		{activeId}
		openAria={toc.openAria}
		closeAria={toc.closeAria}
		onNavigate={toc.onNavigate}
	/>
{/if}

<style>
	.detail-shell {
		--detail-rail-width: clamp(16rem, 24vw, 22rem);
		--detail-center-max: var(--container-content);
		--detail-rail-sticky-top: var(--detail-rail-top, var(--chrome-offset, 0px));
		display: block;
	}

	.detail-shell-toolbar {
		width: 100%;
		background: var(--primary);
	}

	.detail-shell-mobile-summary {
		margin-block-start: 1.5rem;
		padding-inline: var(--space-page-x);
	}

	.detail-shell-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-card-gap);
		min-width: 0;
		padding: var(--space-card-gap) var(--space-page-x);
		overflow-x: clip;
	}

	.detail-shell-center {
		width: 100%;
		min-width: 0;
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
		.detail-shell-mobile-summary {
			display: none;
		}

		.detail-shell-grid {
			gap: 2rem;
			align-items: stretch;
			justify-content: center;
		}

		.detail-shell-grid--two {
			grid-template-columns: var(--detail-rail-width) minmax(0, var(--detail-center-max));
		}

		.detail-shell-grid--three {
			grid-template-columns: 1fr 2fr 1fr;
			padding-block: 2.5rem;
		}

		.detail-shell-grid--three.detail-shell-grid--measured {
			grid-template-columns: minmax(12rem, 1fr) minmax(0, var(--detail-measure)) minmax(12rem, 1fr);
		}

		.detail-shell-grid--right {
			grid-template-columns: minmax(0, 2fr) minmax(12rem, 1fr);
			padding-block: 2.5rem;
		}

		.detail-shell-grid--three .detail-shell-center,
		.detail-shell-grid--right .detail-shell-center {
			max-width: none;
		}

		.detail-shell-rail {
			display: block;
			position: sticky;
			top: var(--detail-rail-sticky-top);
			align-self: start;
			min-width: 0;
		}

		.detail-shell-grid--scroll .detail-shell-rail {
			max-height: calc(100dvh - var(--detail-rail-sticky-top));
			overflow-y: auto;
		}

		.detail-shell-grid--pane-owned {
			grid-template-columns: minmax(0, 1fr);
		}

		.detail-shell-grid--pane-owned .detail-shell-rail--left {
			position: static;
			max-height: none;
			overflow: visible;
		}

		.detail-shell-grid--pane-owned .detail-shell-center {
			max-width: none;
		}
	}

	@media (min-width: 1024px) and (max-width: 1279.98px) {
		.detail-shell-grid--three {
			gap: 1.25rem;
		}
	}
</style>
