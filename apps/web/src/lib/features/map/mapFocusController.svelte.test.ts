import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MapFocus } from '$lib/search/mapFocus';
import MapFocusControllerHarness from './__fixtures__/MapFocusControllerHarness.svelte';
import { createMapFocusController } from './mapFocusController.svelte';

const stopFocus: MapFocus = { kind: 'stop', id: 'STOP1' };

afterEach(() => cleanup());

describe('map focus controller', () => {
	it('retains an unresolved focus, then consumes and clears it exactly once', () => {
		const readFocus = vi.fn(() => stopFocus);
		const clearFocus = vi.fn();
		const controller = createMapFocusController({ readFocus, clearFocus });
		const resolver = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);

		controller.syncFromUrl(new URLSearchParams('focus=stop:STOP1'));
		expect(controller.pending).toEqual(stopFocus);
		expect(controller.consume(resolver)).toBe(false);
		expect(controller.pending).toEqual(stopFocus);
		expect(clearFocus).not.toHaveBeenCalled();

		expect(controller.consume(resolver)).toBe(true);
		expect(controller.pending).toBeNull();
		expect(clearFocus).toHaveBeenCalledOnce();

		expect(controller.consume(resolver)).toBe(false);
		expect(resolver).toHaveBeenCalledTimes(2);
		expect(clearFocus).toHaveBeenCalledOnce();
	});

	it('retains focus until the mounted ready rune wakes the resolver effect', async () => {
		const readFocus = vi.fn(() => stopFocus);
		const clearFocus = vi.fn();
		const resolveFocus = vi.fn(() => true);
		render(MapFocusControllerHarness, {
			props: { readFocus, clearFocus, resolveFocus },
		});

		expect(resolveFocus).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole('button', { name: 'ingest focus' }));

		await waitFor(() => expect(screen.getByTestId('pending-focus')).toHaveTextContent('STOP1'));
		expect(resolveFocus).not.toHaveBeenCalled();
		expect(clearFocus).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('button', { name: 'mark map ready' }));

		await waitFor(() => expect(resolveFocus).toHaveBeenCalledOnce());
		expect(clearFocus).toHaveBeenCalledOnce();
		expect(screen.getByTestId('pending-focus')).toHaveTextContent('');

		await fireEvent.click(screen.getByRole('button', { name: 'mark map ready' }));
		expect(resolveFocus).toHaveBeenCalledOnce();
		expect(clearFocus).toHaveBeenCalledOnce();
	});
});
