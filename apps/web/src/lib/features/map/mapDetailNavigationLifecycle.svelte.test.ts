import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMapDetailNavigationLifecycle } from './mapDetailNavigationLifecycle';
import type { MapUrlIntent, MapUrlSettlement } from './mapUrlCoordinator';

function mountFocusedDetail() {
	const surface = document.createElement('section');
	surface.dataset.slot = 'map-detail-overlay';
	const close = document.createElement('button');
	close.textContent = 'Close';
	surface.append(close);
	document.body.append(surface);
	close.focus();
	return { close, surface };
}

function setup(initialHref = 'https://transit.example/map?route=24') {
	let intent: MapUrlIntent = {
		url: new URL(initialHref),
		ownerId: 'map-owner',
		revision: 1,
	};
	const goto = vi.fn();
	const settleUrl = vi.fn((_url: URL): MapUrlSettlement => 'adopt');
	const lifecycle = createMapDetailNavigationLifecycle({
		currentIntent: () => intent,
		goto,
	});
	return {
		goto,
		lifecycle,
		setIntent(href: string, revision: number) {
			intent = { url: new URL(href), ownerId: 'map-owner', revision };
		},
		settleUrl,
	};
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('map detail accepted-navigation lifecycle', () => {
	it('records adjacent off-map and map publications without an effect flush', () => {
		const { close } = mountFocusedDetail();
		const { goto, lifecycle, settleUrl } = setup();

		lifecycle.recordAccepted(new URL('https://transit.example/lines'));
		lifecycle.recordAccepted(new URL('https://transit.example/map?redirected=1'));
		const result = lifecycle.settle(
			new URL('https://transit.example/map?redirected=1'),
			settleUrl,
			{},
		);

		expect(result).toBe('recovered');
		expect(settleUrl).toHaveBeenCalledOnce();
		expect(goto).toHaveBeenCalledWith(
			'/map?route=24',
			expect.objectContaining({ replaceState: true, keepFocus: true, noScroll: true }),
		);
		expect(document.activeElement).toBe(close);
	});

	it('restores the captured map hash with the full corrective target', () => {
		mountFocusedDetail();
		const { goto, lifecycle, settleUrl } = setup('https://transit.example/map?route=24#detail');

		lifecycle.recordAccepted(new URL('https://transit.example/lines'));
		lifecycle.recordAccepted(new URL('https://transit.example/map?redirected=1#detail'));
		lifecycle.settle(new URL('https://transit.example/map?redirected=1#detail'), settleUrl, {});

		expect(goto).toHaveBeenCalledWith(
			'/map?route=24#detail',
			expect.objectContaining({ replaceState: true, keepFocus: true, noScroll: true }),
		);
	});

	it('refreshes a repeated exit to the newest uncommitted same-owner intent', () => {
		mountFocusedDetail();
		const { goto, lifecycle, setIntent, settleUrl } = setup();

		lifecycle.recordAccepted(new URL('https://transit.example/lines'));
		setIntent('https://transit.example/map?route=24%2C55', 2);
		lifecycle.recordAccepted(new URL('https://transit.example/map?route=24%2C55'));
		lifecycle.recordAccepted(new URL('https://transit.example/network'));
		lifecycle.recordAccepted(new URL('https://transit.example/map?winner=1'));
		lifecycle.settle(new URL('https://transit.example/map?winner=1'), settleUrl, {});

		expect(goto).toHaveBeenCalledOnce();
		expect(goto.mock.lastCall?.[0]).toBe('/map?route=24%2C55');
	});

	it('preserves a final winner carrying a causally newer receipt', () => {
		mountFocusedDetail();
		const { goto, lifecycle, setIntent, settleUrl } = setup();

		lifecycle.recordAccepted(new URL('https://transit.example/lines'));
		setIntent('https://transit.example/map?route=55', 2);
		lifecycle.recordAccepted(new URL('https://transit.example/map?route=55'));
		const result = lifecycle.settle(new URL('https://transit.example/map?route=55'), settleUrl, {
			__transitMapUrlRewrite: { ownerId: 'map-owner', revision: 2 },
		});

		expect(result).toBe('adopt');
		expect(goto).not.toHaveBeenCalled();
	});

	it('does not let a hash-different map invalidation consume the exact final winner', () => {
		mountFocusedDetail();
		const { goto, lifecycle, settleUrl } = setup();

		lifecycle.recordAccepted(new URL('https://transit.example/lines'));
		lifecycle.recordAccepted(new URL('https://transit.example/map?winner=1#final'));
		const invalidation = lifecycle.settle(
			new URL('https://transit.example/map?winner=1#intermediate'),
			settleUrl,
			{},
		);

		expect(invalidation).toBe('adopt');
		expect(goto).not.toHaveBeenCalled();

		const winner = lifecycle.settle(
			new URL('https://transit.example/map?winner=1#final'),
			settleUrl,
			{},
		);
		expect(winner).toBe('recovered');
		expect(goto).toHaveBeenCalledOnce();
	});

	it('retires pending state on an off-map commit and on dispose', () => {
		mountFocusedDetail();
		const { goto, lifecycle, settleUrl } = setup();

		lifecycle.recordAccepted(new URL('https://transit.example/lines'));
		lifecycle.settle(new URL('https://transit.example/lines'), settleUrl, {});
		lifecycle.recordAccepted(new URL('https://transit.example/map?winner=1'));
		lifecycle.settle(new URL('https://transit.example/map?winner=1'), settleUrl, {});
		expect(goto).not.toHaveBeenCalled();

		lifecycle.recordAccepted(new URL('https://transit.example/network'));
		lifecycle.dispose();
		lifecycle.recordAccepted(new URL('https://transit.example/map?winner=2'));
		lifecycle.settle(new URL('https://transit.example/map?winner=2'), settleUrl, {});
		expect(goto).not.toHaveBeenCalled();
	});

	it('does not steal focus after the exact captured node loses ownership', () => {
		const { close } = mountFocusedDetail();
		const outside = document.createElement('button');
		document.body.append(outside);
		const { goto, lifecycle, settleUrl } = setup();

		lifecycle.recordAccepted(new URL('https://transit.example/lines'));
		outside.focus();
		lifecycle.recordAccepted(new URL('https://transit.example/map?winner=1'));
		lifecycle.settle(new URL('https://transit.example/map?winner=1'), settleUrl, {});

		expect(goto).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(outside);
		expect(document.activeElement).not.toBe(close);
	});
});
