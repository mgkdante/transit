import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import MapSelectionControllerHarness from './__fixtures__/MapSelectionControllerHarness.svelte';
import { createMapSelectionController } from './mapSelectionController.svelte';

afterEach(() => cleanup());

describe('map selection controller', () => {
	it('retires the transition mirror by testing fresh-pick, drill-in, LIFO back, and close', () => {
		const controller = createMapSelectionController();
		const stop = { kind: 'stop', id: 'stop-1' } as const;
		const route = { kind: 'route', id: '24', direction: 0, variantKey: 'east' } as const;
		const otherVariant = { ...route, variantKey: 'west' } as const;

		controller.selectPicked(stop);
		expect(controller.selected).toEqual(stop);
		expect(controller.stack).toEqual([]);
		expect(controller.detailOpen).toBe(true);

		controller.selectFromDetail(route);
		controller.selectFromDetail(route);
		expect(controller.selected).toEqual(route);
		expect(controller.stack).toEqual([stop]);

		controller.selectFromDetail(otherVariant);
		expect(controller.stack).toEqual([stop, route]);
		expect(controller.goBack()).toBe(true);
		expect(controller.selected).toEqual(route);
		expect(controller.stack).toEqual([stop]);

		expect(controller.goBack()).toBe(true);
		expect(controller.selected).toEqual(stop);
		expect(controller.goBack()).toBe(false);

		controller.close();
		expect(controller.detailOpen).toBe(false);
		expect(controller.selected).toBeNull();
		expect(controller.stack).toEqual([]);
	});

	it('dedupes hover identity while keeping hover independent from committed selection', () => {
		const controller = createMapSelectionController();
		const vehicle = { kind: 'vehicle', id: 'bus-1' } as const;

		controller.selectPicked({ kind: 'stop', id: 'stop-1' });
		expect(controller.setHovered(vehicle)).toBe(true);
		expect(controller.setHovered({ ...vehicle })).toBe(false);
		expect(controller.hovered).toEqual(vehicle);
		expect(controller.selected).toEqual({ kind: 'stop', id: 'stop-1' });

		expect(controller.setHovered(null)).toBe(true);
		expect(controller.hovered).toBeNull();
	});

	it('keeps every transition rune reactive through the controller member surface', async () => {
		const controller = createMapSelectionController();
		render(MapSelectionControllerHarness, { props: { controller } });

		await fireEvent.click(screen.getByRole('button', { name: 'pick stop' }));
		await waitFor(() => {
			expect(screen.getByTestId('selected')).toHaveTextContent('stop-1');
			expect(screen.getByRole('checkbox', { name: 'detail open' })).toBeChecked();
		});

		await fireEvent.click(screen.getByRole('button', { name: 'hover bus' }));
		await waitFor(() => expect(screen.getByTestId('hovered')).toHaveTextContent('bus-1'));

		await fireEvent.click(screen.getByRole('button', { name: 'drill route' }));
		await waitFor(() => {
			expect(screen.getByTestId('selected')).toHaveTextContent('24');
			expect(screen.getByTestId('stack-size')).toHaveTextContent('1');
		});

		await fireEvent.click(screen.getByRole('button', { name: 'back' }));
		expect(screen.getByTestId('selected')).toHaveTextContent('stop-1');

		await fireEvent.click(screen.getByRole('checkbox', { name: 'detail open' }));
		await waitFor(() => {
			expect(screen.getByTestId('selected')).toHaveTextContent('');
			expect(screen.getByTestId('stack-size')).toHaveTextContent('0');
		});
	});
});
