import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DETAIL_PANEL_WIDTH_STORAGE_KEY,
	DETAIL_RAIL_STORAGE_KEY,
	MIN_DETAIL_PANEL_WIDTH,
	MAX_DETAIL_PANEL_WIDTH,
} from './mapDetailPanes';
import MapDetailOverlay, * as mapDetailOverlayModule from './MapDetailOverlay.svelte';
import MapDetailOverlayHarness from './__fixtures__/MapDetailOverlayHarness.svelte';

interface LiveState {
	widthPx: number;
	collapsed: boolean;
	dragging: boolean;
}

function cssBlock(source: string, marker: string): string {
	const markerIndex = source.indexOf(marker);
	if (markerIndex < 0) return '';
	const open = source.indexOf('{', markerIndex + marker.length);
	if (open < 0) return '';
	let depth = 1;
	let cursor = open + 1;
	while (depth > 0 && cursor < source.length) {
		if (source[cursor] === '{') depth += 1;
		if (source[cursor] === '}') depth -= 1;
		cursor += 1;
	}
	return source.slice(open + 1, cursor - 1);
}

function compactCss(value: string): string {
	return value
		.replace(/\/\*[^]*?\*\//g, '')
		.replace(/\s+/g, ' ')
		.replace(/\s*([{},:;])\s*/g, '$1')
		.trim();
}

// Stand-in for the orchestrator's detailPanel snippet (RightPanel + MapSelectionDetail).
const detailPanel = createRawSnippet(() => ({
	render: () => `<div data-testid="detail-panel-body">detail</div>`,
}));

function detailPanelFor(surfaceKey: string) {
	return createRawSnippet(() => ({
		render: () => `
				<aside data-slot="right-panel" data-surface-key="${surfaceKey}" aria-labelledby="detail-heading" tabindex="-1">
					<button type="button" data-slot="right-panel-toggle">Toggle</button>
					<button type="button" data-slot="right-panel-close">Close</button>
					<div data-slot="right-panel-body"><button type="button" data-slot="detail-drill-in">Drill in</button></div>
				</aside>`,
	}));
}

beforeEach(() => {
	localStorage.clear();
	document.body.innerHTML = '';
});

afterEach(() => {
	localStorage.clear();
	vi.restoreAllMocks();
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

	it('keeps the APG separator as the named full-height 10px/20px target exception', () => {
		const componentSource = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapDetailOverlay.svelte'),
			'utf8',
		);
		const handleRule =
			componentSource.match(
				/\.map-detail-overlay\[data-detail-collapsed='false'\] \.map-detail-handle\s*\{[^}]*\}/,
			)?.[0] ?? '';
		const coarseRule =
			componentSource.match(
				/@media \(pointer: coarse\)\s*\{[\s\S]*?\.map-detail-overlay\[data-detail-collapsed='false'\] \.map-detail-handle\s*\{[^}]*\}/,
			)?.[0] ?? '';

		expect(handleRule).toMatch(/inset-block:\s*0;/);
		expect(handleRule).toMatch(/width:\s*10px;/);
		expect(coarseRule).toMatch(/width:\s*20px;/);
		expect(handleRule).not.toMatch(
			/(?:min-(?:block-size|height|inline-size|width)|--size-tap-min)/,
		);
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

		expect(container.querySelector('.map-detail-overlay')).toHaveAttribute(
			'data-detail-collapsed',
			'false',
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

	it('uses mutually exclusive expanded-frame and collapsed-rail layers', async () => {
		const { container, rerender } = render(MapDetailOverlay, {
			props: {
				widthPx: 400,
				collapsed: false,
				dragging: false,
				resizeAria: 'Resize detail panel',
				detailPanel: detailPanelFor('vehicle:123'),
			},
		});
		expect(container.querySelector('.map-detail-content-frame')).toBeInTheDocument();
		expect(container.querySelector('.map-detail-rail')).not.toBeInTheDocument();

		await rerender({
			widthPx: 400,
			collapsed: true,
			dragging: false,
			resizeAria: 'Resize detail panel',
			detailPanel: detailPanelFor('vehicle:123'),
		});
		expect(container.querySelector('.map-detail-content-frame')).not.toBeInTheDocument();
		expect(container.querySelector<HTMLElement>('.map-detail-rail')?.tagName).toBe('DIV');
		expect(
			container.querySelector('.map-detail-rail [data-slot="right-panel"]'),
		).toBeInTheDocument();
	});

	it('keyboard-resizes the committed panel width once per keypress', async () => {
		let live: LiveState = { widthPx: 400, collapsed: false, dragging: false };
		const { container } = render(MapDetailOverlayHarness, {
			props: { widthPx: 400, onstate: (s) => (live = s) },
		});
		const handle = container.querySelector('.map-detail-handle')!;
		const setItem = vi.spyOn(Storage.prototype, 'setItem');

		// Left-edge handle: ArrowLeft grows (+16), ArrowRight shrinks (-16).
		await fireEvent.keyDown(handle, { key: 'ArrowLeft' });
		expect(live.widthPx).toBe(416);
		expect(localStorage.getItem(DETAIL_PANEL_WIDTH_STORAGE_KEY)).toBe('416');
		expect(setItem).toHaveBeenCalledTimes(1);

		await fireEvent.keyDown(handle, { key: 'ArrowRight' });
		expect(live.widthPx).toBe(400);
		expect(localStorage.getItem(DETAIL_PANEL_WIDTH_STORAGE_KEY)).toBe('400');
		expect(setItem).toHaveBeenCalledTimes(2);
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

	it('keeps drag width transient and commits once only after a valid release', async () => {
		const setItem = vi.spyOn(Storage.prototype, 'setItem');
		const { container } = render(MapDetailOverlay, {
			props: {
				widthPx: 400,
				collapsed: false,
				dragging: false,
				resizeAria: 'Resize detail panel',
				detailPanel: detailPanelFor('vehicle:123'),
			},
		});
		const handle = container.querySelector<HTMLElement>('.map-detail-handle')!;
		handle.setPointerCapture = vi.fn();
		handle.releasePointerCapture = vi.fn();

		await fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 });
		await fireEvent.pointerMove(handle, { clientX: 550, pointerId: 1 });
		expect(handle).toHaveAttribute('aria-valuenow', '350');
		expect(setItem).not.toHaveBeenCalled();

		await fireEvent.pointerUp(handle, { pointerId: 1 });
		expect(localStorage.getItem(DETAIL_PANEL_WIDTH_STORAGE_KEY)).toBe('350');
		expect(setItem).toHaveBeenCalledTimes(1);
	});

	it('clamps aria-valuenow to the separator minimum while the visual shell enters the dead zone', async () => {
		const { container } = render(MapDetailOverlay, {
			props: {
				widthPx: 400,
				collapsed: false,
				dragging: false,
				resizeAria: 'Resize detail panel',
				detailPanel: detailPanelFor('vehicle:123'),
			},
		});
		const overlay = container.querySelector<HTMLElement>('.map-detail-overlay')!;
		const handle = container.querySelector<HTMLElement>('.map-detail-handle')!;
		handle.setPointerCapture = vi.fn();

		await fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 });
		await fireEvent.pointerMove(handle, { clientX: 650, pointerId: 1 });

		expect(overlay).toHaveStyle({ width: '250px' });
		expect(handle).toHaveAttribute('aria-valuemin', '300');
		expect(handle).toHaveAttribute('aria-valuenow', '300');
	});

	it.each([
		{ dragWidth: 61, expectedKey: DETAIL_RAIL_STORAGE_KEY, expectedValue: 'stop:52618' },
		{ dragWidth: 239, expectedKey: DETAIL_RAIL_STORAGE_KEY, expectedValue: 'stop:52618' },
		{ dragWidth: 240, expectedKey: DETAIL_PANEL_WIDTH_STORAGE_KEY, expectedValue: '300' },
		{ dragWidth: 299, expectedKey: DETAIL_PANEL_WIDTH_STORAGE_KEY, expectedValue: '300' },
		{ dragWidth: 300, expectedKey: DETAIL_PANEL_WIDTH_STORAGE_KEY, expectedValue: '300' },
		{ dragWidth: 350, expectedKey: DETAIL_PANEL_WIDTH_STORAGE_KEY, expectedValue: '350' },
	])(
		'commits exactly once for the $dragWidthpx release class',
		async ({ dragWidth, expectedKey, expectedValue }) => {
			localStorage.setItem(DETAIL_PANEL_WIDTH_STORAGE_KEY, '440');
			const { container } = render(MapDetailOverlay, {
				props: {
					widthPx: 400,
					collapsed: false,
					dragging: false,
					resizeAria: 'Resize detail panel',
					detailPanel: detailPanelFor('stop:52618'),
				},
			});
			const handle = container.querySelector<HTMLElement>('.map-detail-handle')!;
			handle.setPointerCapture = vi.fn();
			handle.releasePointerCapture = vi.fn();
			const setItem = vi.spyOn(Storage.prototype, 'setItem');

			await fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 });
			await fireEvent.pointerMove(handle, { clientX: 900 - dragWidth, pointerId: 1 });
			expect(setItem).not.toHaveBeenCalled();
			await fireEvent.pointerUp(handle, { pointerId: 1 });

			if (dragWidth >= 240) {
				expect(localStorage.getItem(DETAIL_PANEL_WIDTH_STORAGE_KEY)).toBe(expectedValue);
				expect(container.querySelector('.map-detail-handle')).toBeInTheDocument();
				if (dragWidth < 300) {
					expect(container.querySelector('.map-detail-overlay')).toHaveAttribute(
						'data-detail-snapping',
						'true',
					);
				}
			} else {
				expect(localStorage.getItem(DETAIL_PANEL_WIDTH_STORAGE_KEY)).toBe('440');
				expect(localStorage.getItem(DETAIL_RAIL_STORAGE_KEY)).toBe('stop:52618');
				expect(container.querySelector('.map-detail-handle')).not.toBeInTheDocument();
			}
			expect(setItem).toHaveBeenCalledTimes(1);
			expect(setItem).toHaveBeenCalledWith(expectedKey, expectedValue);
		},
	);

	it.each(['pointercancel', 'lostpointercapture'] as const)(
		'rolls back over the 200ms snap-back class without persistence on %s',
		async (eventName) => {
			const setItem = vi.spyOn(Storage.prototype, 'setItem');
			const { container } = render(MapDetailOverlay, {
				props: {
					widthPx: 400,
					collapsed: false,
					dragging: false,
					resizeAria: 'Resize detail panel',
					detailPanel: detailPanelFor('route:24'),
				},
			});
			const handle = container.querySelector<HTMLElement>('.map-detail-handle')!;
			handle.setPointerCapture = vi.fn();

			await fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 });
			await fireEvent.pointerMove(handle, { clientX: 650, pointerId: 1 });
			await fireEvent(handle, new Event(eventName));

			expect(handle).toHaveAttribute('aria-valuenow', '400');
			expect(container.querySelector('.map-detail-overlay')).toHaveAttribute(
				'data-detail-snapping',
				'true',
			);
			expect(setItem).not.toHaveBeenCalled();
		},
	);

	it('restores matching rail state, expands a new surface, and clears stale persistence', async () => {
		localStorage.setItem(DETAIL_RAIL_STORAGE_KEY, 'stop:52618');
		const { container, rerender } = render(MapDetailOverlay, {
			props: {
				widthPx: 400,
				collapsed: false,
				dragging: false,
				resizeAria: 'Resize detail panel',
				detailPanel: detailPanelFor('stop:52618'),
			},
		});

		await waitFor(() => {
			expect(container.querySelector('.map-detail-overlay')).toHaveAttribute(
				'data-detail-collapsed',
				'true',
			);
		});

		await rerender({
			widthPx: 400,
			collapsed: true,
			dragging: false,
			resizeAria: 'Resize detail panel',
			detailPanel: detailPanelFor('route:24'),
		});
		await waitFor(() => {
			expect(container.querySelector('.map-detail-overlay')).toHaveAttribute(
				'data-detail-collapsed',
				'false',
			);
		});
		expect(localStorage.getItem(DETAIL_RAIL_STORAGE_KEY)).toBeNull();
	});

	it('clears matching rail persistence when the parent force-expands the same surface', async () => {
		localStorage.setItem(DETAIL_RAIL_STORAGE_KEY, 'stop:52618');
		const { container, rerender } = render(MapDetailOverlay, {
			props: {
				widthPx: 400,
				collapsed: false,
				dragging: false,
				resizeAria: 'Resize detail panel',
				detailPanel: detailPanelFor('stop:52618'),
			},
		});
		await waitFor(() => expect(container.querySelector('.map-detail-rail')).toBeInTheDocument());

		await rerender({
			widthPx: 400,
			collapsed: false,
			dragging: false,
			resizeAria: 'Resize detail panel',
			detailPanel: detailPanelFor('stop:52618'),
		});
		await waitFor(() =>
			expect(container.querySelector('.map-detail-content-frame')).toBeInTheDocument(),
		);
		expect(localStorage.getItem(DETAIL_RAIL_STORAGE_KEY)).toBeNull();
	});

	it('toggles on Enter and transfers focus to the retained rail control', async () => {
		const { container } = render(MapDetailOverlay, {
			props: {
				widthPx: 400,
				collapsed: false,
				dragging: false,
				resizeAria: 'Resize detail panel',
				detailPanel: detailPanelFor('vehicle:123'),
			},
		});
		const handle = container.querySelector<HTMLElement>('.map-detail-handle')!;
		await fireEvent.keyDown(handle, { key: 'Enter' });

		await waitFor(() => {
			expect(container.querySelector('.map-detail-handle')).not.toBeInTheDocument();
		});
		expect(document.activeElement).toBe(
			container.querySelector('[data-slot="right-panel-toggle"]'),
		);
	});

	it.each([61, 239, 240, 299])(
		'keeps the 300px content frame right-anchored through the %spx dead-zone sample',
		async (dragWidth) => {
			const source = readFileSync(
				resolve(process.cwd(), 'src/lib/features/map/MapDetailOverlay.svelte'),
				'utf-8',
			);
			const overlayRule = source.match(/\.map-detail-overlay\s*\{[\s\S]*?\}/)?.[0] ?? '';
			const frameRule =
				source.match(
					/\.map-detail-overlay\[data-detail-collapsed='false'\] \.map-detail-content-frame\s*\{[\s\S]*?\}/,
				)?.[0] ?? '';
			const { container } = render(MapDetailOverlay, {
				props: {
					widthPx: 400,
					collapsed: false,
					dragging: false,
					resizeAria: 'Resize detail panel',
					detailPanel: detailPanelFor('vehicle:123'),
				},
			});
			const overlay = container.querySelector<HTMLElement>('.map-detail-overlay')!;
			const frame = container.querySelector<HTMLElement>('.map-detail-content-frame')!;
			const handle = container.querySelector<HTMLElement>('.map-detail-handle')!;
			const anchorStyle = document.createElement('style');
			anchorStyle.textContent = `${overlayRule}\n${frameRule}`;
			container.prepend(anchorStyle);
			const screenRight = 900;
			vi.spyOn(overlay, 'getBoundingClientRect').mockImplementation(() => {
				const width = Number.parseFloat(overlay.style.width);
				return DOMRect.fromRect({ x: screenRight - width, width, height: 720 });
			});
			vi.spyOn(frame, 'getBoundingClientRect').mockImplementation(() => {
				const overlayRect = overlay.getBoundingClientRect();
				const width = Math.max(overlayRect.width, MIN_DETAIL_PANEL_WIDTH);
				const anchoredRight = getComputedStyle(overlay).justifyContent === 'flex-end';
				return DOMRect.fromRect({
					x: anchoredRight ? overlayRect.right - width : overlayRect.left,
					width,
					height: 720,
				});
			});
			handle.setPointerCapture = vi.fn();

			await fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 });
			await fireEvent.pointerMove(handle, { clientX: 900 - dragWidth, pointerId: 1 });

			expect(overlay).toHaveStyle({ width: `${dragWidth}px` });
			const overlayRect = overlay.getBoundingClientRect();
			const frameRect = frame.getBoundingClientRect();
			expect(frameRect.width).toBe(MIN_DETAIL_PANEL_WIDTH);
			expect(frameRect.right).toBeCloseTo(overlayRect.right, 4);
			expect(frameRect.left).toBeLessThan(overlayRect.left);
			expect(getComputedStyle(overlay).justifyContent).toBe('flex-end');
			expect(overlayRule).toContain('justify-content: flex-end');
			expect(frameRule).not.toContain('margin-left: auto');
			expect(frameRule).toContain('width: max(100%, 300px)');
		},
	);

	it('collapses on double-click and expands when any part of the rail is clicked', async () => {
		const { container } = render(MapDetailOverlay, {
			props: {
				widthPx: 400,
				collapsed: false,
				dragging: false,
				resizeAria: 'Resize detail panel',
				detailPanel: detailPanelFor('vehicle:123'),
			},
		});
		await fireEvent.doubleClick(container.querySelector('.map-detail-handle')!);
		const rail = await waitFor(() => {
			const element = container.querySelector<HTMLElement>('.map-detail-rail');
			expect(element).toBeInTheDocument();
			return element!;
		});
		await fireEvent.click(rail);
		expect(container.querySelector('.map-detail-content-frame')).toBeInTheDocument();
	});

	it('commits only the rail state for a real double-click sequence with two degenerate releases', async () => {
		const { container } = render(MapDetailOverlay, {
			props: {
				widthPx: 400,
				collapsed: false,
				dragging: false,
				resizeAria: 'Resize detail panel',
				detailPanel: detailPanelFor('vehicle:123'),
			},
		});
		const handle = container.querySelector<HTMLElement>('.map-detail-handle')!;
		handle.setPointerCapture = vi.fn();
		handle.releasePointerCapture = vi.fn();
		await waitFor(() =>
			expect(container.querySelector('[data-surface-key="vehicle:123"]')).toBeInTheDocument(),
		);
		const setItem = vi.spyOn(Storage.prototype, 'setItem');

		for (const pointerId of [1, 2]) {
			await fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId });
			await fireEvent.pointerUp(handle, { clientX: 500, pointerId });
		}
		await fireEvent.doubleClick(handle);

		await waitFor(() => expect(container.querySelector('.map-detail-rail')).toBeInTheDocument());
		expect(setItem).toHaveBeenCalledOnce();
		expect(setItem).toHaveBeenCalledWith(DETAIL_RAIL_STORAGE_KEY, 'vehicle:123');
	});

	it('exports focusDetail and closes on Escape from map focus before restoring the recorded invoker', async () => {
		const invoker = document.createElement('button');
		document.body.append(invoker);
		invoker.focus();
		const { container, unmount } = render(MapDetailOverlay, {
			props: {
				widthPx: 400,
				collapsed: false,
				dragging: false,
				resizeAria: 'Resize detail panel',
				detailPanel: detailPanelFor('vehicle:123'),
			},
		});
		const close = container.querySelector<HTMLElement>('[data-slot="right-panel-close"]')!;
		const onclose = vi.fn();
		close.addEventListener('click', onclose);

		const focusDetail = (mapDetailOverlayModule as { focusDetail?: () => void }).focusDetail;
		expect(focusDetail).toBeTypeOf('function');
		focusDetail?.();
		expect(document.activeElement).toBe(container.querySelector('[data-slot="right-panel"]'));

		const mapCanvas = document.createElement('button');
		mapCanvas.className = 'maplibregl-canvas';
		document.body.append(mapCanvas);
		mapCanvas.focus();
		const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		document.dispatchEvent(escape);
		expect(onclose).toHaveBeenCalledOnce();
		expect(escape.defaultPrevented).toBe(true);
		unmount();
		expect(document.activeElement).toBe(invoker);
	});

	it('moves drill-in focus to the labelled panel when surfaceKey changes', async () => {
		const { container, rerender } = render(MapDetailOverlay, {
			props: {
				widthPx: 400,
				collapsed: false,
				dragging: false,
				resizeAria: 'Resize detail panel',
				detailPanel: detailPanelFor('stop:52618'),
			},
		});
		const drillIn = container.querySelector<HTMLElement>('[data-slot="detail-drill-in"]')!;
		drillIn.focus();
		expect(document.activeElement).toBe(drillIn);

		await rerender({
			widthPx: 400,
			collapsed: false,
			dragging: false,
			resizeAria: 'Resize detail panel',
			detailPanel: detailPanelFor('route:24'),
		});

		await waitFor(() => {
			expect(container.querySelector('[data-slot="right-panel"]')).toHaveAttribute(
				'data-surface-key',
				'route:24',
			);
			expect(document.activeElement).toBe(container.querySelector('[data-slot="right-panel"]'));
		});
		expect(document.activeElement).not.toBe(
			container.querySelector('[data-slot="right-panel-body"]'),
		);
	});

	it('does not steal outside focus when surfaceKey changes', async () => {
		const outside = document.createElement('button');
		document.body.append(outside);
		const { container, rerender } = render(MapDetailOverlay, {
			props: {
				widthPx: 400,
				collapsed: false,
				dragging: false,
				resizeAria: 'Resize detail panel',
				detailPanel: detailPanelFor('stop:52618'),
			},
		});
		outside.focus();

		await rerender({
			widthPx: 400,
			collapsed: false,
			dragging: false,
			resizeAria: 'Resize detail panel',
			detailPanel: detailPanelFor('route:24'),
		});

		await waitFor(() => {
			expect(container.querySelector('[data-slot="right-panel"]')).toHaveAttribute(
				'data-surface-key',
				'route:24',
			);
		});
		expect(document.activeElement).toBe(outside);
	});

	it.each(['input', 'textarea', 'select', 'contenteditable', 'map-near'] as const)(
		'yields Escape owned by the %s target',
		async (targetKind) => {
			const { container } = render(MapDetailOverlay, {
				props: {
					widthPx: 400,
					collapsed: false,
					dragging: false,
					resizeAria: 'Resize detail panel',
					detailPanel: detailPanelFor('vehicle:123'),
				},
			});
			const close = container.querySelector<HTMLElement>('[data-slot="right-panel-close"]')!;
			const onclose = vi.fn();
			close.addEventListener('click', onclose);
			localStorage.setItem(DETAIL_RAIL_STORAGE_KEY, 'vehicle:123');

			const owner =
				targetKind === 'map-near'
					? Object.assign(document.createElement('div'), { className: 'map-near' })
					: targetKind === 'contenteditable'
						? document.createElement('div')
						: document.createElement(targetKind);
			if (targetKind === 'contenteditable') owner.setAttribute('contenteditable', 'true');
			const target =
				targetKind === 'contenteditable' || targetKind === 'map-near'
					? document.createElement('span')
					: owner;
			if (target !== owner) owner.append(target);
			document.body.append(owner);
			const escape = new KeyboardEvent('keydown', {
				key: 'Escape',
				bubbles: true,
				cancelable: true,
			});

			target.dispatchEvent(escape);

			expect(onclose).not.toHaveBeenCalled();
			expect(escape.defaultPrevented).toBe(false);
			expect(localStorage.getItem(DETAIL_RAIL_STORAGE_KEY)).toBe('vehicle:123');
		},
	);

	it('yields an already-prevented Escape without clearing rail persistence', () => {
		const { container } = render(MapDetailOverlay, {
			props: {
				widthPx: 400,
				collapsed: false,
				dragging: false,
				resizeAria: 'Resize detail panel',
				detailPanel: detailPanelFor('vehicle:123'),
			},
		});
		const close = container.querySelector<HTMLElement>('[data-slot="right-panel-close"]')!;
		const onclose = vi.fn();
		close.addEventListener('click', onclose);
		localStorage.setItem(DETAIL_RAIL_STORAGE_KEY, 'vehicle:123');
		const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
		escape.preventDefault();

		document.dispatchEvent(escape);

		expect(onclose).not.toHaveBeenCalled();
		expect(localStorage.getItem(DETAIL_RAIL_STORAGE_KEY)).toBe('vehicle:123');
	});

	it('does not consume Escape when there is no close seam', () => {
		render(MapDetailOverlay, {
			props: {
				widthPx: 400,
				collapsed: false,
				dragging: false,
				resizeAria: 'Resize detail panel',
				detailPanel,
			},
		});
		localStorage.setItem(DETAIL_RAIL_STORAGE_KEY, 'vehicle:123');
		const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

		document.dispatchEvent(escape);

		expect(escape.defaultPrevented).toBe(false);
		expect(localStorage.getItem(DETAIL_RAIL_STORAGE_KEY)).toBe('vehicle:123');
	});

	it('clears the collapsed rail before Escape invokes the hidden close seam', async () => {
		localStorage.setItem(DETAIL_RAIL_STORAGE_KEY, 'vehicle:123');
		const { container } = render(MapDetailOverlay, {
			props: {
				widthPx: 400,
				collapsed: false,
				dragging: false,
				resizeAria: 'Resize detail panel',
				detailPanel: detailPanelFor('vehicle:123'),
			},
		});
		await waitFor(() => expect(container.querySelector('.map-detail-rail')).toBeInTheDocument());
		const close = container.querySelector<HTMLElement>('[data-slot="right-panel-close"]')!;
		const onclose = vi.fn();
		close.addEventListener('click', onclose);

		await fireEvent.keyDown(document, { key: 'Escape' });
		expect(onclose).toHaveBeenCalledOnce();
		expect(localStorage.getItem(DETAIL_RAIL_STORAGE_KEY)).toBeNull();
	});

	it('falls back to the map canvas when the recorded invoker disconnects', () => {
		const invoker = document.createElement('button');
		const mapCanvas = document.createElement('button');
		mapCanvas.className = 'maplibregl-canvas';
		document.body.append(invoker, mapCanvas);
		invoker.focus();
		const { unmount } = render(MapDetailOverlay, {
			props: {
				widthPx: 400,
				collapsed: false,
				dragging: false,
				resizeAria: 'Resize detail panel',
				detailPanel: detailPanelFor('vehicle:123'),
			},
		});
		invoker.remove();
		unmount();
		expect(document.activeElement).toBe(mapCanvas);
	});

	it('clears rail persistence on teardown regardless of the close path', async () => {
		localStorage.setItem(DETAIL_RAIL_STORAGE_KEY, 'vehicle:123');
		const { container, unmount } = render(MapDetailOverlay, {
			props: {
				widthPx: 400,
				collapsed: false,
				dragging: false,
				resizeAria: 'Resize detail panel',
				detailPanel: detailPanelFor('vehicle:123'),
			},
		});
		await waitFor(() => expect(container.querySelector('.map-detail-rail')).toBeInTheDocument());

		unmount();

		expect(localStorage.getItem(DETAIL_RAIL_STORAGE_KEY)).toBeNull();
	});

	it('evolves the snapping PRM pin to collapsed=false + snapping=true and kills every overlay layer', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapDetailOverlay.svelte'),
			'utf-8',
		);
		expect(source).toContain("data-detail-collapsed={collapsed ? 'true' : 'false'}");
		expect(source).toMatch(
			/\.map-detail-overlay\[data-detail-collapsed='false'\]\s*\{[^}]*transition-property:\s*width;/,
		);
		expect(source).toMatch(
			/\.map-detail-overlay\[data-detail-collapsed='false'\] \.map-detail-content-frame\s*\{[\s\S]*?opacity:\s*1;[\s\S]*?var\(--duration-fast\)[\s\S]*?calc\(var\(--duration-normal\) \/ 2\)/,
		);
		expect(source).toMatch(
			/@starting-style\s*\{\s*\.map-detail-overlay\[data-detail-collapsed='false'\] \.map-detail-content-frame\s*\{\s*opacity:\s*0;/,
		);
		expect(source).toMatch(
			/\.map-detail-overlay\[data-detail-collapsed='false'\] \.map-detail-handle::after\s*\{[\s\S]*?calc\(var\(--duration-normal\) \/ 2\)/,
		);
		const reducedMotion = cssBlock(source, '@media (prefers-reduced-motion: reduce)');
		const ruleOpen = reducedMotion.indexOf('{');
		const selectors = reducedMotion
			.slice(0, ruleOpen)
			.split(',')
			.map((selector) => selector.trim());
		const declarations = reducedMotion.slice(ruleOpen + 1, reducedMotion.lastIndexOf('}'));
		expect(selectors).toEqual([
			".map-detail-overlay[data-detail-collapsed='false']",
			".map-detail-overlay[data-detail-collapsed='true']",
			".map-detail-overlay[data-detail-collapsed='false'][data-detail-snapping='true']",
			".map-detail-overlay[data-detail-dragging='true']",
			".map-detail-overlay[data-detail-collapsed='false'] .map-detail-content-frame",
			":global(.map-detail-overlay[data-detail-collapsed='true'] [data-slot='right-panel-toggle'])",
			".map-detail-overlay[data-detail-collapsed='false'] .map-detail-handle::after",
			".map-detail-overlay[data-detail-dragging='true'] .map-detail-handle::after",
		]);
		expect(compactCss(declarations)).toBe('animation:none;transition:none;');
	});

	it('pins width-only 300ms open and 200ms closed shell motion', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapDetailOverlay.svelte'),
			'utf-8',
		);
		const shellRule =
			source.match(/\.map-detail-overlay\[data-detail-collapsed='false'\]\s*\{[\s\S]*?\}/)?.[0] ??
			'';
		const closedRule =
			source.match(/\.map-detail-overlay\[data-detail-collapsed='true'\]\s*\{[\s\S]*?\}/)?.[0] ??
			'';
		const snapBackRule =
			source.match(
				/\.map-detail-overlay\[data-detail-collapsed='false'\]\[data-detail-snapping='true'\]\s*\{[\s\S]*?\}/,
			)?.[0] ?? '';

		expect(shellRule).toContain('transition-property: width');
		expect(shellRule).toContain('transition-duration: var(--duration-slow)');
		expect(closedRule).toContain('transition-duration: var(--duration-normal)');
		expect(snapBackRule).toContain('transition-duration: var(--duration-normal)');
		expect(snapBackRule).not.toContain('var(--duration-slow)');
	});

	it('uses the M6b 300ms transform-opacity vocabulary only on overlay insertion', () => {
		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/features/map/MapDetailOverlay.svelte'),
			'utf-8',
		);
		const overlayRule = source.match(/\.map-detail-overlay\s*\{[\s\S]*?\n\t\}/)?.[0] ?? '';
		const entrance = cssBlock(source, '@keyframes map-detail-overlay-in');

		expect(overlayRule).toContain(
			'animation: map-detail-overlay-in var(--duration-slow) var(--ease-out) both',
		);
		expect(overlayRule).not.toMatch(/animation[^;]*(?:width|inline-size)/);
		expect(compactCss(entrance)).toBe(
			'from{opacity:0;transform:translateY(0.75rem) scale(0.985);}to{opacity:1;transform:translateY(0) scale(1);}',
		);
		expect(overlayRule).not.toMatch(/transition\s*:/);
		expect(source).not.toContain('{#key surfaceKey}');
	});
});
