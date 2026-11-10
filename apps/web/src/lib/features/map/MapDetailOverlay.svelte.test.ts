import { fireEvent, render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MapDetailOverlayHarness from './__fixtures__/MapDetailOverlayHarness.svelte';
import MapDetailOverlay from './MapDetailOverlay.svelte';
const detailPanel = createRawSnippet(() => ({
	render: () =>
		'<aside><button data-slot="right-panel-close">Close</button><input aria-label="Search" /></aside>',
}));
beforeEach(() => localStorage.clear());
describe('desktop detail sizes', () => {
	it.each(['en', 'fr'] as const)(
		'names every snap in %s and retains the separator in rail',
		async (locale) => {
			const view = render(MapDetailOverlay, {
				props: {
					locale,
					widthPx: 400,
					collapsed: false,
					dragging: false,
					resizeAria: locale === 'en' ? 'Resize detail panel' : 'Redimensionner le panneau',
					detailPanel,
				},
			});
			const handle = view.getByRole('separator');
			expect(handle).toHaveAttribute('aria-orientation', 'vertical');
			expect(handle).toHaveAttribute('aria-valuemin', '56');
			expect(handle).toHaveAttribute('aria-valuemax', '560');
			expect(handle).toHaveAttribute(
				'aria-valuetext',
				locale === 'en' ? 'Panel size: standard' : 'Taille du panneau : standard',
			);
			await fireEvent.keyDown(handle, { key: 'Home' });
			expect(handle).toHaveAttribute('aria-valuenow', '56');
			expect(handle).toHaveAttribute(
				'aria-valuetext',
				locale === 'en' ? 'Panel size: rail' : 'Taille du panneau : replié',
			);
			for (const width of [320, 400, 560]) {
				await fireEvent.keyDown(handle, { key: 'ArrowLeft' });
				expect(handle).toHaveAttribute('aria-valuenow', String(width));
			}
			await fireEvent.keyDown(handle, { key: 'ArrowRight' });
			expect(handle).toHaveAttribute('aria-valuenow', '400');
			await fireEvent.keyDown(handle, { key: 'End' });
			expect(handle).toHaveAttribute('aria-valuenow', '560');
			expect(localStorage.getItem('transit:detail-panel-width')).toBe('560');
		},
	);
	it.each([
		[100, 320],
		[-125, 560],
		[350, 56],
	])('snaps a %s px drag to %s on release', async (delta, width) => {
		const view = render(MapDetailOverlayHarness);
		const handle = view.getByRole('separator');
		handle.setPointerCapture = vi.fn();
		await fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 });
		await fireEvent.pointerMove(handle, { clientX: 500 + delta, pointerId: 1 });
		expect(handle).toHaveAttribute('aria-valuenow', '400');
		await fireEvent.pointerUp(handle, { clientX: 500 + delta, pointerId: 1 });
		expect(handle).toHaveAttribute('aria-valuenow', String(width));
	});
	it('shows the rail while a drag will snap to it, instead of a clipped strip of content', async () => {
		const view = render(MapDetailOverlayHarness);
		const handle = view.getByRole('separator');
		const overlay = view.container.querySelector<HTMLElement>('[data-slot="map-detail-overlay"]')!;
		handle.setPointerCapture = vi.fn();
		await fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 });
		await fireEvent.pointerMove(handle, { clientX: 700, pointerId: 1 });
		expect(overlay).not.toHaveAttribute('data-detail-rail-preview');
		await fireEvent.pointerMove(handle, { clientX: 800, pointerId: 1 });
		expect(overlay).toHaveAttribute('data-detail-rail-preview', 'true');
		await fireEvent.pointerMove(handle, { clientX: 650, pointerId: 1 });
		expect(overlay).not.toHaveAttribute('data-detail-rail-preview');
		await fireEvent.pointerUp(handle, { clientX: 850, pointerId: 1 });
		expect(handle).toHaveAttribute('aria-valuenow', '56');
		expect(overlay).not.toHaveAttribute('data-detail-rail-preview');
	});
	it('rolls back a cancelled drag and keeps keyboard input usable with blocked storage', async () => {
		const view = render(MapDetailOverlayHarness);
		const handle = view.getByRole('separator');
		handle.setPointerCapture = vi.fn();
		await fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 });
		await fireEvent.pointerMove(handle, { clientX: 100, pointerId: 1 });
		await fireEvent.pointerCancel(handle);
		expect(handle).toHaveAttribute('aria-valuenow', '400');
		const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw Error('blocked');
		});
		await fireEvent.keyDown(handle, { key: 'End' });
		expect(handle).toHaveAttribute('aria-valuenow', '560');
		spy.mockRestore();
	});
	it('yields Escape to editable controls and restores its invoker on teardown', async () => {
		const invoker = document.createElement('button');
		document.body.append(invoker);
		invoker.focus();
		const view = render(MapDetailOverlay, {
			props: { widthPx: 400, collapsed: false, dragging: false, resizeAria: 'Resize', detailPanel },
		});
		const close = vi.fn();
		view.getByRole('button', { name: 'Close' }).addEventListener('click', close);
		await fireEvent.keyDown(view.getByRole('textbox'), { key: 'Escape' });
		expect(close).not.toHaveBeenCalled();
		await fireEvent.keyDown(document, { key: 'Escape' });
		expect(close).toHaveBeenCalledOnce();
		view.unmount();
		expect(document.activeElement).toBe(invoker);
		invoker.remove();
	});
});
