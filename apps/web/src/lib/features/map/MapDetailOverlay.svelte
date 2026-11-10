<script module lang="ts">
	export function focusDetail(): void {
		document
			.querySelector<HTMLElement>('.map-detail-overlay [aria-labelledby][tabindex="-1"]')
			?.focus();
	}
</script>

<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import type { Locale } from '#lib/i18n/index.ts';
	import { clampDetailPanelWidth, writeStoredDetailPanelWidth } from './mapDetailPanes';
	import { RIGHT_SIZES, snapSize, stepSize, sizeText } from './panelSizes';
	let {
		widthPx = $bindable(),
		collapsed = $bindable(),
		dragging = $bindable(),
		resizeAria,
		locale = 'en',
		detailPanel,
	}: {
		widthPx: number;
		collapsed: boolean;
		dragging: boolean;
		resizeAria: string;
		locale?: Locale;
		detailPanel: Snippet;
	} = $props();
	let overlayElement: HTMLDivElement;
	let preview = $state<number | null>(null);
	let start: { x: number; width: number } | null = null;
	const current = $derived(collapsed ? 56 : clampDetailPanelWidth(widthPx));
	// A drag that will snap to the rail shows the rail now, not a clipped strip of content.
	const railPreview = $derived(
		!collapsed && preview != null && snapSize(preview, RIGHT_SIZES, 400) === 56,
	);
	$effect(() => {
		// Collapse buttons and separator share one persisted device choice.
		writeStoredDetailPanelWidth(current);
	});
	function commit(width: number): void {
		widthPx = width;
		collapsed = width === 56;
		preview = null;
		dragging = false;
	}
	function down(event: PointerEvent): void {
		if (event.button !== 0) return;
		start = { x: event.clientX, width: current };
		preview = current;
		dragging = true;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		event.preventDefault();
	}
	function move(event: PointerEvent): void {
		if (!start) return;
		preview = Math.min(560, Math.max(56, start.width + start.x - event.clientX));
	}
	function up(event: PointerEvent): void {
		if (!start) return;
		const next = snapSize(start.width + start.x - event.clientX, RIGHT_SIZES, 400);
		start = null;
		commit(next);
	}
	function cancel(): void {
		start = null;
		preview = null;
		dragging = false;
	}
	function key(event: KeyboardEvent): void {
		const next = stepSize(current, event.key, RIGHT_SIZES, 'right');
		if (next === null) return;
		event.preventDefault();
		commit(next);
	}
	onMount(() => {
		const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		function escape(event: KeyboardEvent): void {
			if (event.key !== 'Escape' || event.defaultPrevented) return;
			if (
				event.target instanceof Element &&
				event.target.closest('input, textarea, select, [contenteditable], .map-near')
			)
				return;
			const close = overlayElement.querySelector<HTMLElement>('[data-slot="right-panel-close"]');
			if (close) {
				event.preventDefault();
				close.click();
			}
		}
		let surfaceKey: string | undefined;
		let bodyFocused = false;
		function trackFocus(event: FocusEvent): void {
			bodyFocused =
				event.target instanceof Element &&
				overlayElement.contains(event.target) &&
				!!event.target.closest('[data-slot="right-panel-body"]');
		}
		const observer = new MutationObserver(() => {
			const next =
				overlayElement.querySelector<HTMLElement>('[data-surface-key]')?.dataset.surfaceKey;
			if (surfaceKey !== undefined && next !== surfaceKey && bodyFocused)
				queueMicrotask(focusDetail);
			surfaceKey = next;
		});
		observer.observe(overlayElement, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ['data-surface-key'],
		});
		surfaceKey =
			overlayElement.querySelector<HTMLElement>('[data-surface-key]')?.dataset.surfaceKey;
		document.addEventListener('focusin', trackFocus);
		document.addEventListener('keydown', escape);
		return () => {
			observer.disconnect();
			document.removeEventListener('focusin', trackFocus);
			document.removeEventListener('keydown', escape);
			if (invoker?.isConnected) invoker.focus();
			else document.querySelector<HTMLElement>('.maplibregl-canvas')?.focus();
		};
	});
</script>

<div
	class="map-detail-overlay"
	bind:this={overlayElement}
	style:width={(preview ?? current) + 'px'}
	data-slot="map-detail-overlay"
	data-detail-collapsed={collapsed ? 'true' : 'false'}
	data-detail-dragging={dragging ? 'true' : 'false'}
	data-detail-rail-preview={railPreview ? 'true' : undefined}
>
	<div
		class={collapsed ? 'map-detail-rail' : 'map-detail-content-frame'}
		data-slot="map-detail-content-frame"
	>
		{@render detailPanel()}
	</div>
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="map-detail-handle"
		data-ripple-exempt
		data-slot="map-detail-handle"
		role="separator"
		tabindex="0"
		aria-orientation="vertical"
		aria-label={resizeAria}
		aria-valuemin={56}
		aria-valuemax={560}
		aria-valuenow={current}
		aria-valuetext={sizeText(current, locale, 'right')}
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={cancel}
		onlostpointercapture={cancel}
		onkeydown={key}
	></div>
</div>

<style>
	.map-detail-overlay {
		position: absolute;
		inset-block: 0;
		right: 0;
		z-index: var(--z-map-detail-panel, 32);
		display: flex;
		justify-content: flex-end;
		width: var(--app-right-detail-offset);
		max-width: 100%;
		overflow: clip;
		box-shadow: var(--shadow-section);
		pointer-events: auto;
		animation: map-detail-overlay-in var(--duration-slow) var(--ease-out) both;
	}
	@keyframes map-detail-overlay-in {
		from {
			opacity: 0;
			transform: translateY(0.75rem) scale(0.985);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}
	.map-detail-overlay[data-detail-collapsed='false'] {
		transition-property: width;
		transition-duration: var(--duration-normal);
		transition-timing-function: var(--ease-out);
	}
	.map-detail-overlay[data-detail-dragging='true'] {
		transition: none;
	}
	.map-detail-overlay[data-detail-collapsed='true'] {
		transition-property: width;
		transition-duration: var(--duration-normal);
		transition-timing-function: var(--ease-out);
	}
	.map-detail-overlay[data-detail-collapsed='false'] .map-detail-content-frame {
		position: relative;
		flex: none;
		/* Never narrower than the smallest open snap, so content keeps its layout while the width animates. */
		width: max(100%, 320px);
		opacity: 1;
		transition-property: opacity;
		transition-duration: var(--duration-fast);
		transition-timing-function: var(--ease-out);
		transition-delay: calc(var(--duration-normal) / 2);
	}
	.map-detail-overlay[data-detail-rail-preview='true'] .map-detail-content-frame {
		opacity: 0;
		transition-delay: 0ms;
	}
	.map-detail-overlay[data-detail-rail-preview='true'] {
		background: var(--card);
	}
	.map-detail-overlay[data-detail-collapsed='true'] .map-detail-rail {
		position: relative;
		flex: none;
		width: 100%;
		cursor: pointer;
	}
	:global(.map-detail-overlay[data-detail-collapsed='true'] [data-slot='right-panel-toggle']) {
		opacity: 1;
		transition-property: opacity;
		transition-duration: calc(var(--duration-normal) / 2);
		transition-timing-function: var(--ease-out);
		transition-delay: calc(var(--duration-normal) / 2);
	}
	@starting-style {
		.map-detail-overlay[data-detail-collapsed='false'] .map-detail-content-frame {
			opacity: 0;
		}
		:global(.map-detail-overlay[data-detail-collapsed='true'] [data-slot='right-panel-toggle']) {
			opacity: 0;
		}
	}

	.map-detail-overlay .map-detail-handle {
		position: absolute;
		inset-block: 0;
		left: 0;
		width: 10px;
		z-index: var(--z-map-canvas, 1);
		cursor: col-resize;
		background: transparent;
		touch-action: none;
	}
	.map-detail-overlay .map-detail-handle::after {
		position: absolute;
		inset-block: 0;
		left: 4px;
		width: 2px;
		background: var(--primary);
		content: '';
		opacity: 0;
		transition-property: opacity;
		transition-duration: calc(var(--duration-normal) / 2);
		transition-timing-function: var(--ease-default);
	}
	.map-detail-overlay:hover .map-detail-handle::after,
	.map-detail-overlay .map-detail-handle:hover::after,
	.map-detail-overlay .map-detail-handle:focus-visible::after,
	.map-detail-overlay[data-detail-dragging='true'] .map-detail-handle::after {
		opacity: 1;
	}
	.map-detail-overlay .map-detail-handle:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}

	@media (pointer: coarse) {
		.map-detail-overlay .map-detail-handle {
			width: 20px;
		}
		.map-detail-overlay .map-detail-handle::after {
			left: 9px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.map-detail-overlay[data-detail-collapsed='false'],
		.map-detail-overlay[data-detail-collapsed='true'],
		.map-detail-overlay[data-detail-dragging='true'],
		.map-detail-overlay[data-detail-collapsed='false'] .map-detail-content-frame,
		:global(.map-detail-overlay[data-detail-collapsed='true'] [data-slot='right-panel-toggle']),
		.map-detail-overlay .map-detail-handle::after,
		.map-detail-overlay[data-detail-dragging='true'] .map-detail-handle::after {
			animation: none;
			transition: none;
		}
	}
</style>
