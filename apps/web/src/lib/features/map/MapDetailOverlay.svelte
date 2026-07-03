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
<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		clampDetailPanelWidth,
		writeStoredDetailPanelWidth,
		MIN_DETAIL_PANEL_WIDTH,
		MAX_DETAIL_PANEL_WIDTH,
	} from './mapDetailPanes';

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

	// Pointer-drag the detail panel's LEFT edge to resize its width. Capturing the
	// pointer keeps the drag tracking even if the cursor leaves the handle; each move
	// writes a CLAMPED width into the CSS var (so the overlay follows live), and we
	// persist on release. Dragging the LEFT edge GROWS the panel as the pointer moves
	// left, so the delta is negated. The map canvas is untouched throughout — it never
	// reads the panel width. Mirrors the AppShell left-rail drag exactly.
	function onDetailHandlePointerDown(event: PointerEvent): void {
		if (event.button !== 0) return;
		dragging = true;
		detailDragStartX = event.clientX;
		detailDragStartWidth = widthPx;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		event.preventDefault();
	}

	function onDetailHandlePointerMove(event: PointerEvent): void {
		if (!dragging) return;
		// Left-edge handle: moving the pointer left (negative delta) widens the panel.
		widthPx = clampDetailPanelWidth(detailDragStartWidth - (event.clientX - detailDragStartX));
	}

	function onDetailHandlePointerUp(event: PointerEvent): void {
		if (!dragging) return;
		dragging = false;
		(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
		writeStoredDetailPanelWidth(widthPx);
	}

	// Keyboard resize for the separator (a11y parity with the left-rail handle): arrows
	// nudge the width, Home/End jump to the floor/ceiling. Left-edge handle, so Left
	// grows and Right shrinks. Persists on each commit.
	function onDetailHandleKeyDown(event: KeyboardEvent): void {
		const STEP = 16;
		let next: number;
		switch (event.key) {
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
		writeStoredDetailPanelWidth(widthPx);
	}
</script>

<div
	class="map-detail-overlay"
	data-slot="map-detail-overlay"
	data-detail-collapsed={collapsed ? 'true' : undefined}
	data-detail-dragging={dragging ? 'true' : undefined}
>
	<!-- Left-edge resize handle — a thin col-resize strip that DRAGS the panel's
	     width into the CSS var (overlay follows; the map canvas never reads it, so
	     it is never resized). role="separator" + keyboard nudges match the left-rail
	     handle's a11y. Absent while collapsed (the icon strip is fixed-width). -->
	{#if !collapsed}
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="map-detail-handle"
			data-slot="map-detail-handle"
			role="separator"
			aria-orientation="vertical"
			aria-label={resizeAria}
			aria-valuemin={MIN_DETAIL_PANEL_WIDTH}
			aria-valuemax={MAX_DETAIL_PANEL_WIDTH}
			aria-valuenow={widthPx}
			tabindex="0"
			onpointerdown={onDetailHandlePointerDown}
			onpointermove={onDetailHandlePointerMove}
			onpointerup={onDetailHandlePointerUp}
			onpointercancel={onDetailHandlePointerUp}
			onkeydown={onDetailHandleKeyDown}
		></div>
	{/if}
	{@render detailPanel()}
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
		width: var(--app-right-detail-offset);
		max-width: 100%;
		box-shadow: var(--shadow-section);
		pointer-events: auto;
		transition: width var(--duration-normal) var(--ease-out);
	}
	/* Suppress the width transition WHILE dragging so the panel tracks the pointer 1:1;
	   it re-applies for the collapse/expand snap. */
	.map-detail-overlay[data-detail-dragging='true'] {
		transition: none;
	}
	/* COLLAPSED to the RIGHT: the RightPanel inside shrinks to its 3.7rem icon strip
	   (data-open='false'), so the overlay box narrows to that strip flush at the right
	   edge — collapsed to the right edge, never to the left / mid-air. The strip stays
	   on-screen so the expand toggle is reachable. */
	.map-detail-overlay[data-detail-collapsed='true'] {
		width: 3.7rem;
	}

	/* The detail panel's left-edge resize handle — a thin col-resize strip flush to the
	   overlay's leading edge, matching the left-rail handle tone (idle --border,
	   hover/active --primary). Mirrors .app-shell-rail-handle. */
	.map-detail-handle {
		position: absolute;
		inset-block: 0;
		left: 0;
		width: 6px;
		z-index: var(--z-map-canvas, 1);
		cursor: col-resize;
		background: var(--border);
		opacity: 0;
		transition:
			opacity var(--duration-fast) var(--ease-default),
			background var(--duration-fast) var(--ease-default);
		touch-action: none;
	}
	.map-detail-overlay:hover .map-detail-handle,
	.map-detail-handle:hover,
	.map-detail-handle:focus-visible,
	.map-detail-overlay[data-detail-dragging='true'] .map-detail-handle {
		opacity: 1;
	}
	.map-detail-handle:hover,
	.map-detail-handle:focus-visible,
	.map-detail-overlay[data-detail-dragging='true'] .map-detail-handle {
		background: var(--primary);
	}
	.map-detail-handle:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
	}

	@media (prefers-reduced-motion: reduce) {
		.map-detail-overlay,
		.map-detail-handle {
			transition: none;
		}
	}
</style>
