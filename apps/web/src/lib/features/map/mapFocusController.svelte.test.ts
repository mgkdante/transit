import { describe, expect, it, vi } from 'vitest';

import { parseMapFocus } from '$lib/search/mapFocus';
import { createMapFocusController } from './mapFocusController.svelte';

function setup() {
	const clearFocus = vi.fn();
	const controller = createMapFocusController({ readFocus: parseMapFocus, clearFocus });
	return { controller, clearFocus };
}

describe('map focus controller', () => {
	it('latches the latest valid request and treats the same unsettled raw URL as idempotent', () => {
		const { controller } = setup();
		controller.syncFromUrl(new URLSearchParams('focus=stop:S1'));
		const first = controller.pending;

		controller.syncFromUrl(new URLSearchParams('focus=stop:S1'));
		expect(controller.pending).toBe(first);

		controller.syncFromUrl(new URLSearchParams('focus=vehicle:V2'));
		expect(controller.pending).toEqual({ kind: 'vehicle', id: 'V2' });
	});

	it('cancels an unconsumed request on absence', () => {
		const { controller, clearFocus } = setup();
		controller.syncFromUrl(new URLSearchParams('focus=stop:S1'));

		controller.syncFromUrl(new URLSearchParams());

		expect(controller.pending).toBeNull();
		expect(controller.consumeOnce(vi.fn())).toBe(false);
		expect(clearFocus).not.toHaveBeenCalled();
	});

	it('strips each malformed-but-present raw value once and never queues it', () => {
		const { controller, clearFocus } = setup();
		const malformed = new URLSearchParams('focus=bogus');

		controller.syncFromUrl(malformed);
		controller.syncFromUrl(malformed);
		expect(controller.pending).toBeNull();
		expect(clearFocus).toHaveBeenCalledOnce();

		controller.syncFromUrl(new URLSearchParams());
		controller.syncFromUrl(malformed);
		expect(clearFocus).toHaveBeenCalledTimes(2);
	});

	it('marks and strips before invoking the handler, and consumes a terminal miss', () => {
		const { controller, clearFocus } = setup();
		controller.syncFromUrl(new URLSearchParams('focus=stop:missing'));
		const handler = vi.fn(() => {
			expect(controller.pending).toBeNull();
			expect(clearFocus).toHaveBeenCalledOnce();
		});

		expect(controller.consumeOnce(handler)).toBe(true);
		expect(handler).toHaveBeenCalledWith({ kind: 'stop', id: 'missing' });
		expect(controller.consumeOnce(handler)).toBe(false);
		expect(clearFocus).toHaveBeenCalledOnce();
	});

	it('ignores the consumed raw value until an absent URL rearms it', () => {
		const { controller, clearFocus } = setup();
		const request = new URLSearchParams('focus=route:24');
		controller.syncFromUrl(request);
		expect(controller.consumeOnce(vi.fn())).toBe(true);

		controller.syncFromUrl(request);
		expect(controller.pending).toBeNull();
		expect(clearFocus).toHaveBeenCalledOnce();

		controller.syncFromUrl(new URLSearchParams());
		controller.syncFromUrl(request);
		expect(controller.pending).toEqual({ kind: 'route', id: '24' });
	});
});
