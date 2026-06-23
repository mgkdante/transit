import { fireEvent, render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DETAIL_PANEL_WIDTH_STORAGE_KEY,
	MIN_DETAIL_PANEL_WIDTH,
	MAX_DETAIL_PANEL_WIDTH,
} from './mapDetailPanes';
import MapDetailOverlay from './MapDetailOverlay.svelte';
import MapDetailOverlayHarness from './MapDetailOverlayHarness.svelte';

interface LiveState {
	widthPx: number;
	collapsed: boolean;
	dragging: boolean;
}

// Stand-in for the orchestrator's detailPanel snippet (RightPanel + MapSelectionDetail).
const detailPanel = createRawSnippet(() => ({
	render: () => `<div data-testid="detail-panel-body">detail</div>`,
}));

beforeEach(() => {
	localStorage.clear();
});

afterEach(() => {
	localStorage.clear();
});

describe('MapDetailOverlay', () => {
	it('anchors an absolute right overlay that renders the orchestrator detail panel', () => {
		const { container } = render(MapDetailOverlay, {
			props: {
				widthPx: 400,
				collapsed: false,
				dragging: false,
				resizeAria: 'Resize detail panel',
				detailPanel,
			},
		});

		const overlay = container.querySelector('.map-detail-overlay')!;
		expect(overlay).toBeInTheDocument();
		expect(overlay).toHaveAttribute('data-slot', 'map-detail-overlay');
		expect(overlay.querySelector('[data-testid="detail-panel-body"]')).toBeInTheDocument();
	});

	it('shows the resize separator only while expanded, with separator a11y', async () => {
		const { container, rerender } = render(MapDetailOverlay, {
			props: {
				widthPx: 400,
				collapsed: false,
				dragging: false,
				resizeAria: 'Resize detail panel',
				detailPanel,
			},
		});

		const handle = container.querySelector('.map-detail-handle')!;
		expect(handle).toBeInTheDocument();
		expect(handle).toHaveAttribute('role', 'separator');
		expect(handle).toHaveAttribute('aria-orientation', 'vertical');
		expect(handle).toHaveAttribute('aria-label', 'Resize detail panel');
		expect(handle).toHaveAttribute('aria-valuemin', String(MIN_DETAIL_PANEL_WIDTH));
		expect(handle).toHaveAttribute('aria-valuemax', String(MAX_DETAIL_PANEL_WIDTH));
		expect(handle).toHaveAttribute('aria-valuenow', '400');

		// Collapsed → the icon strip is fixed-width, so the handle is gone.
		await rerender({
			widthPx: 400,
			collapsed: true,
			dragging: false,
			resizeAria: 'Resize detail panel',
			detailPanel,
		});
		expect(container.querySelector('.map-detail-handle')).not.toBeInTheDocument();
	});

	it('reflects the collapsed-to-the-right state via a data attribute', async () => {
		const { container, rerender } = render(MapDetailOverlay, {
			props: {
				widthPx: 400,
				collapsed: false,
				dragging: false,
				resizeAria: 'Resize detail panel',
				detailPanel,
			},
		});

		expect(container.querySelector('.map-detail-overlay')).not.toHaveAttribute(
			'data-detail-collapsed',
		);
		await rerender({
			widthPx: 400,
			collapsed: true,
			dragging: false,
			resizeAria: 'Resize detail panel',
			detailPanel,
		});
		expect(container.querySelector('.map-detail-overlay')).toHaveAttribute(
			'data-detail-collapsed',
			'true',
		);
	});

	it('keyboard-resizes the panel: ArrowLeft GROWS, ArrowRight SHRINKS, persisting each commit', async () => {
		let live: LiveState = { widthPx: 400, collapsed: false, dragging: false };
		const { container } = render(MapDetailOverlayHarness, {
			props: { widthPx: 400, onstate: (s) => (live = s) },
		});
		const handle = container.querySelector('.map-detail-handle')!;

		// Left-edge handle: ArrowLeft grows (+16), ArrowRight shrinks (-16).
		await fireEvent.keyDown(handle, { key: 'ArrowLeft' });
		expect(live.widthPx).toBe(416);
		expect(localStorage.getItem(DETAIL_PANEL_WIDTH_STORAGE_KEY)).toBe('416');

		await fireEvent.keyDown(handle, { key: 'ArrowRight' });
		expect(live.widthPx).toBe(400);
		expect(localStorage.getItem(DETAIL_PANEL_WIDTH_STORAGE_KEY)).toBe('400');
	});

	it('Home/End jump to the ceiling/floor and clamp out-of-band widths', async () => {
		let live: LiveState = { widthPx: 400, collapsed: false, dragging: false };
		const { container } = render(MapDetailOverlayHarness, {
			props: { widthPx: 400, onstate: (s) => (live = s) },
		});
		const handle = container.querySelector('.map-detail-handle')!;

		await fireEvent.keyDown(handle, { key: 'Home' });
		expect(live.widthPx).toBe(MAX_DETAIL_PANEL_WIDTH);

		await fireEvent.keyDown(handle, { key: 'End' });
		expect(live.widthPx).toBe(MIN_DETAIL_PANEL_WIDTH);
	});

	// THE LAW: the drag/keyboard handlers resize ONLY the overlay (its width var) +
	// persist — this component has NO map reference at all, so they can NEVER call
	// map.resize()/fitBounds/easeTo. A pointer drag grows the panel as the cursor
	// moves left (left-edge handle), clamped to the band, with the var tracked live.
	it('drags the overlay width without any map camera reference (no jump)', async () => {
		let live: LiveState = { widthPx: 400, collapsed: false, dragging: false };
		const { container } = render(MapDetailOverlayHarness, {
			props: { widthPx: 400, onstate: (s) => (live = s) },
		});
		const handle = container.querySelector<HTMLElement>('.map-detail-handle')!;
		// happy-dom lacks pointer capture; stub so the handlers run unimpeded.
		handle.setPointerCapture = vi.fn();
		handle.releasePointerCapture = vi.fn();

		await fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 });
		expect(live.dragging).toBe(true);

		// Move the pointer LEFT by 60px → the left-edge handle GROWS the panel by 60.
		await fireEvent.pointerMove(handle, { clientX: 440, pointerId: 1 });
		expect(live.widthPx).toBe(460);

		await fireEvent.pointerUp(handle, { pointerId: 1 });
		expect(live.dragging).toBe(false);
		// The chosen width persists across reloads.
		expect(localStorage.getItem(DETAIL_PANEL_WIDTH_STORAGE_KEY)).toBe('460');
	});

	it('clamps a drag beyond the max band to the ceiling', async () => {
		let live: LiveState = { widthPx: 540, collapsed: false, dragging: false };
		const { container } = render(MapDetailOverlayHarness, {
			props: { widthPx: 540, onstate: (s) => (live = s) },
		});
		const handle = container.querySelector<HTMLElement>('.map-detail-handle')!;
		handle.setPointerCapture = vi.fn();
		handle.releasePointerCapture = vi.fn();

		await fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 });
		// Drag far left → would exceed MAX; clamps to MAX_DETAIL_PANEL_WIDTH.
		await fireEvent.pointerMove(handle, { clientX: 300, pointerId: 1 });
		expect(live.widthPx).toBe(MAX_DETAIL_PANEL_WIDTH);
	});
});
