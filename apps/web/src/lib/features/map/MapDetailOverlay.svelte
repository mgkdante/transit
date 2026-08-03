<!--
  MapDetailOverlay — the desktop right-panel absolute OVERLAY box + the left-edge
  drag/resize handle + collapse-to-the-right logic.

  The ONLY child that owns logic: the self-contained drag/keyboard handlers live here
  WITH their markup because they touch nothing but the panel width, a CSS-var, and
  localStorage — never the map. THE LAW: the map canvas is full-bleed and the only
  size driver is MapStage's own ResizeObserver, so NONE of these handlers may call
  map.resize()/fitBounds/easeTo — they don't (this component has no map reference at
  all). The overlay anchors flush to the map's right edge, its width the live
  --app-right-detail-offset var; collapsing slides it OFF the right edge (collapses
  to the RIGHT, never to the left). The {#if layout.isDesktop && detailOpen} gate +
  the --app-right-detail-offset/--map-detail-offset seeding effect stay in MapHero;
  this is the BODY. Two-way binds widthPx/collapsed/dragging back to the orchestrator.
-->
<script module lang="ts">
	export function focusDetail(): void {
		document
			.querySelector<HTMLElement>('.map-detail-overlay [aria-labelledby][tabindex="-1"]')
			?.focus();
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import {
		clearStoredDetailRail,
		clampDetailPanelWidth,
		readStoredDetailRail,
		writeStoredDetailRail,
		writeStoredDetailPanelWidth,
		MIN_DETAIL_PANEL_WIDTH,
		MAX_DETAIL_PANEL_WIDTH,
	} from './mapDetailPanes';
	import { mapOwnerBoundary } from '$lib/components/map/mapOwnerBoundary';

	interface Props {
		/** The overlay's live width in px (= MapHero's detailWidthPx). Two-way. */
		widthPx: number;
		/** Collapsed-to-the-right flag (= MapHero's detailCollapsed). Two-way. */
		collapsed: boolean;
		/** Drag-in-progress flag (= MapHero's detailDragging). Two-way. */
		dragging: boolean;
		/** a11y label for the resize separator (= t.detailResizeLabel). */
		resizeAria: string;
		/** The orchestrator's detailPanel render contract (RightPanel + MapSelectionDetail). */
		detailPanel: Snippet;
	}

	let {
		widthPx = $bindable(),
		collapsed = $bindable(),
		dragging = $bindable(),
		resizeAria,
		detailPanel,
	}: Props = $props();

	let detailDragStartX = 0;
	let detailDragStartWidth = 0;
	let detailDragMoved = false;
	let dragWidthPx = $state(clampDetailPanelWidth(widthPx));
	let overlayElement: HTMLDivElement;
	let surfaceKey = $state<string | null>(null);
	let railReady = $state(false);
	let lastCollapsed = $state(collapsed);
	let snapping = $state(false);
	let snapTimer: ReturnType<typeof setTimeout> | undefined;
	let focusWasInsidePanelBody = false;

	const RAIL_WIDTH_PX = 60;
	const COLLAPSE_THRESHOLD_PX = 240;

	function clampDragWidth(width: number): number {
		if (!Number.isFinite(width)) return clampDetailPanelWidth(widthPx);
		return Math.min(Math.max(Math.round(width), RAIL_WIDTH_PX), MAX_DETAIL_PANEL_WIDTH);
	}

	function focusRailControl(): void {
		queueMicrotask(() => {
			overlayElement?.querySelector<HTMLElement>('[data-slot="right-panel-toggle"]')?.focus();
		});
	}

	function collapseDetail(): void {
		if (collapsed) return;
		collapsed = true;
		if (surfaceKey) writeStoredDetailRail(surfaceKey);
		lastCollapsed = true;
		focusRailControl();
	}

	function expandDetail(): void {
		if (!collapsed) return;
		collapsed = false;
		dragWidthPx = clampDetailPanelWidth(widthPx);
		clearStoredDetailRail();
		lastCollapsed = false;
	}

	function syncSurfaceKey(): void {
		const nextSurfaceKey = overlayElement?.querySelector<HTMLElement>(
			'[data-slot="right-panel"][data-surface-key]',
		)?.dataset.surfaceKey;
		if (!nextSurfaceKey) return;

		if (surfaceKey == null) {
			surfaceKey = nextSurfaceKey;
			if (readStoredDetailRail() === nextSurfaceKey) {
				collapsed = true;
			} else {
				clearStoredDetailRail();
				collapsed = false;
			}
			lastCollapsed = collapsed;
			railReady = true;
			return;
		}

		if (nextSurfaceKey !== surfaceKey) {
			const shouldFocusDetail = focusWasInsidePanelBody;
			surfaceKey = nextSurfaceKey;
			collapsed = false;
			clearStoredDetailRail();
			lastCollapsed = false;
			if (shouldFocusDetail) queueMicrotask(focusDetail);
		}
	}

	$effect(() => {
		if (!dragging && !collapsed) dragWidthPx = clampDetailPanelWidth(widthPx);
	});

	$effect(() => {
		const isCollapsed = collapsed;
		if (!railReady || isCollapsed === lastCollapsed) return;
		lastCollapsed = isCollapsed;
		if (isCollapsed) {
			if (surfaceKey) writeStoredDetailRail(surfaceKey);
			focusRailControl();
		} else {
			clearStoredDetailRail();
		}
	});

	onMount(() => {
		const invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const observer = new MutationObserver(syncSurfaceKey);
		observer.observe(overlayElement, {
			attributes: true,
			attributeFilter: ['data-surface-key'],
			childList: true,
			subtree: true,
		});
		syncSurfaceKey();

		function onDocumentFocusIn(event: FocusEvent): void {
			const target = event.target;
			focusWasInsidePanelBody =
				target instanceof Element &&
				overlayElement.contains(target) &&
				target.closest('[data-slot="right-panel-body"]') != null;
		}

		function onDocumentKeyDown(event: KeyboardEvent): void {
			if (event.key !== 'Escape' || event.defaultPrevented || escapeBelongsToTarget(event.target)) {
				return;
			}
			const closeControl = overlayElement?.querySelector<HTMLElement>(
				'[data-slot="right-panel-close"]',
			);
			if (!closeControl) return;
			event.preventDefault();
			clearStoredDetailRail();
			lastCollapsed = false;
			closeControl.click();
		}

		document.addEventListener('focusin', onDocumentFocusIn);
		document.addEventListener('keydown', onDocumentKeyDown);
		return mapOwnerBoundary('MapDetailOverlay', [
			() => document.removeEventListener('focusin', onDocumentFocusIn),
			() => document.removeEventListener('keydown', onDocumentKeyDown),
			() => observer.disconnect(),
			() => {
				if (snapTimer) clearTimeout(snapTimer);
				snapTimer = undefined;
				snapping = false;
			},
			clearStoredDetailRail,
			() => {
				if (invoker?.isConnected) invoker.focus();
				else document.querySelector<HTMLElement>('.maplibregl-canvas')?.focus();
			},
		]);
	});

	// Pointer drag owns only the live width. The committed width persists exactly once
	// on a valid release; the map canvas never reads either value.
	function onDetailHandlePointerDown(event: PointerEvent): void {
		if (event.button !== 0) return;
		if (snapTimer) clearTimeout(snapTimer);
		snapping = false;
		dragging = true;
		detailDragStartX = event.clientX;
		detailDragStartWidth = dragWidthPx;
		detailDragMoved = false;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		event.preventDefault();
	}

	function onDetailHandlePointerMove(event: PointerEvent): void {
		if (!dragging) return;
		// Left-edge handle: moving the pointer left (negative delta) widens the panel.
		const nextDragWidth = clampDragWidth(detailDragStartWidth - (event.clientX - detailDragStartX));
		if (nextDragWidth !== detailDragStartWidth) detailDragMoved = true;
		dragWidthPx = nextDragWidth;
	}

	function startSnapBack(): void {
		snapping = true;
		if (snapTimer) clearTimeout(snapTimer);
		snapTimer = setTimeout(() => {
			snapping = false;
		}, 200);
	}

	function onDetailHandlePointerUp(event: PointerEvent): void {
		if (!dragging) return;
		dragging = false;
		(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
		if (!detailDragMoved) return;
		detailDragMoved = false;
		if (dragWidthPx < COLLAPSE_THRESHOLD_PX) {
			collapseDetail();
			return;
		}

		if (dragWidthPx < MIN_DETAIL_PANEL_WIDTH) {
			startSnapBack();
		}
		const committedWidthPx = clampDetailPanelWidth(dragWidthPx);
		dragWidthPx = committedWidthPx;
		widthPx = committedWidthPx;
		writeStoredDetailPanelWidth(committedWidthPx);
	}

	function rollbackDetailDrag(): void {
		if (!dragging) return;
		const committedWidthPx = clampDetailPanelWidth(widthPx);
		dragging = false;
		detailDragMoved = false;
		if (dragWidthPx !== committedWidthPx) startSnapBack();
		dragWidthPx = committedWidthPx;
	}

	function escapeBelongsToTarget(target: EventTarget | null): boolean {
		if (!(target instanceof Element)) return false;
		return (
			target.closest(
				'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .map-near',
			) != null
		);
	}

	// Keyboard resize for the separator (a11y parity with the left-rail handle): arrows
	// nudge the width, Home/End jump to the floor/ceiling. Left-edge handle, so Left
	// grows and Right shrinks. Persists on each commit.
	function onDetailHandleKeyDown(event: KeyboardEvent): void {
		const STEP = 16;
		let next: number;
		switch (event.key) {
			case 'Enter':
				event.preventDefault();
				collapseDetail();
				return;
			case 'ArrowLeft':
				next = widthPx + STEP;
				break;
			case 'ArrowRight':
				next = widthPx - STEP;
				break;
			case 'Home':
				next = MAX_DETAIL_PANEL_WIDTH;
				break;
			case 'End':
				next = MIN_DETAIL_PANEL_WIDTH;
				break;
			default:
				return;
		}
		event.preventDefault();
		widthPx = clampDetailPanelWidth(next);
		dragWidthPx = widthPx;
		writeStoredDetailPanelWidth(widthPx);
	}
</script>

<div
	class="map-detail-overlay"
	bind:this={overlayElement}
	style:width={collapsed ? 'var(--size-detail-rail)' : `${dragWidthPx}px`}
	data-slot="map-detail-overlay"
	data-detail-collapsed={collapsed ? 'true' : 'false'}
	data-detail-dragging={dragging ? 'true' : 'false'}
	data-detail-snapping={snapping ? 'true' : 'false'}
>
	{#if !collapsed}
		<div class="map-detail-content-frame" data-slot="map-detail-content-frame">
			{@render detailPanel()}
		</div>
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="map-detail-handle"
			data-ripple-exempt
			data-slot="map-detail-handle"
			role="separator"
			aria-orientation="vertical"
			aria-label={resizeAria}
			aria-valuemin={MIN_DETAIL_PANEL_WIDTH}
			aria-valuemax={MAX_DETAIL_PANEL_WIDTH}
			aria-valuenow={clampDetailPanelWidth(dragWidthPx)}
			tabindex="0"
			onpointerdown={onDetailHandlePointerDown}
			onpointermove={onDetailHandlePointerMove}
			onpointerup={onDetailHandlePointerUp}
			onpointercancel={rollbackDetailDrag}
			onlostpointercapture={rollbackDetailDrag}
			ondblclick={collapseDetail}
			onkeydown={onDetailHandleKeyDown}
		></div>
	{:else}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div class="map-detail-rail" data-slot="map-detail-rail" onclick={expandDetail}>
			{@render detailPanel()}
		</div>
	{/if}
</div>

<style>
	/* RIGHT DETAIL overlay — absolutely positioned, anchored FLUSH to the map's right
	   edge, its width the live --app-right-detail-offset CSS var. It floats OVER the
	   map; only the overlay itself takes pointer events, so the map underneath stays
	   interactive. Its box-shadow lives here so the lift vanishes WITH the overlay when
	   the detail closes (the overlay only exists while detailOpen). COLLAPSED slides it
	   OFF the right edge by translating the leftover strip beyond 100% width. */
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
		transition-duration: var(--duration-slow);
		transition-timing-function: var(--ease-out);
	}
	/* Suppress the width transition WHILE dragging so the panel tracks the pointer 1:1;
	   it re-applies for the collapse/expand snap. */
	.map-detail-overlay[data-detail-dragging='true'] {
		transition: none;
	}
	.map-detail-overlay[data-detail-collapsed='true'] {
		transition-property: width;
		transition-duration: var(--duration-normal);
		transition-timing-function: var(--ease-out);
	}
	.map-detail-overlay[data-detail-collapsed='false'][data-detail-snapping='true'] {
		transition-duration: var(--duration-normal);
	}
	/* COLLAPSED to the RIGHT: the RightPanel inside shrinks to its 3.7rem icon strip
	   (data-open='false'), so the overlay box narrows to that strip flush at the right
	   edge — collapsed to the right edge, never to the left / mid-air. The strip stays
	   on-screen so the expand toggle is reachable. */
	.map-detail-overlay[data-detail-collapsed='false'] .map-detail-content-frame {
		position: relative;
		flex: none;
		width: max(100%, 300px);
		opacity: 1;
		transition-property: opacity;
		transition-duration: var(--duration-fast);
		transition-timing-function: var(--ease-out);
		transition-delay: calc(var(--duration-normal) / 2);
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

	/* The detail panel's left-edge resize handle — a thin col-resize strip flush to the
	   overlay's leading edge, matching the left-rail handle tone (idle --border,
	   hover/active --primary). Mirrors .app-shell-rail-handle. */
	.map-detail-overlay[data-detail-collapsed='false'] .map-detail-handle {
		position: absolute;
		inset-block: 0;
		left: 0;
		width: 10px;
		z-index: var(--z-map-canvas, 1);
		cursor: col-resize;
		background: transparent;
		touch-action: none;
	}
	.map-detail-overlay[data-detail-collapsed='false'] .map-detail-handle::after {
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
	.map-detail-overlay[data-detail-collapsed='false']:hover .map-detail-handle::after,
	.map-detail-overlay[data-detail-collapsed='false'] .map-detail-handle:hover::after,
	.map-detail-overlay[data-detail-collapsed='false'] .map-detail-handle:focus-visible::after,
	.map-detail-overlay[data-detail-dragging='true'] .map-detail-handle::after {
		opacity: 1;
	}
	.map-detail-overlay[data-detail-collapsed='false'] .map-detail-handle:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}

	@media (pointer: coarse) {
		.map-detail-overlay[data-detail-collapsed='false'] .map-detail-handle {
			width: 20px;
		}
		.map-detail-overlay[data-detail-collapsed='false'] .map-detail-handle::after {
			left: 9px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.map-detail-overlay[data-detail-collapsed='false'],
		.map-detail-overlay[data-detail-collapsed='true'],
		.map-detail-overlay[data-detail-collapsed='false'][data-detail-snapping='true'],
		.map-detail-overlay[data-detail-dragging='true'],
		.map-detail-overlay[data-detail-collapsed='false'] .map-detail-content-frame,
		:global(.map-detail-overlay[data-detail-collapsed='true'] [data-slot='right-panel-toggle']),
		.map-detail-overlay[data-detail-collapsed='false'] .map-detail-handle::after,
		.map-detail-overlay[data-detail-dragging='true'] .map-detail-handle::after {
			animation: none;
			transition: none;
		}
	}
</style>
