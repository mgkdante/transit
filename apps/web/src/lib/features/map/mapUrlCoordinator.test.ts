import { describe, expect, it, vi } from 'vitest';

import { createMapUrlCoordinator, MAP_URL_REWRITE, type MapUrlNavigate } from './mapUrlCoordinator';

function setup(href = 'https://transit.example/map') {
	const navigate = vi.fn<MapUrlNavigate>();
	const coordinator = createMapUrlCoordinator(new URL(href), navigate);
	return { coordinator, navigate };
}

describe('map URL coordinator', () => {
	it('replaces every filter family while preserving unknown duplicates, empties, order, and raw near values', () => {
		const { coordinator, navigate } = setup(
			'https://transit.example/fr/map?x=1&route=old&x=&near=45.5000000%2C-73.5000000&empty=&status=late&x=2',
		);

		coordinator.writeFilters(
			'route=24&stop=S&trip=T&vehicle=V&status=early&occupancy=seated&entity=route&alert=has_alert&grain=day&from=2026-07-01&to=2026-07-31&date=2026-07-15&n=10&affects=lines&severity=high',
		);

		expect(navigate).toHaveBeenCalledOnce();
		expect(navigate).toHaveBeenCalledWith(
			'/fr/map?x=1&x=&near=45.5000000%2C-73.5000000&empty=&x=2&route=24&stop=S&trip=T&vehicle=V&status=early&occupancy=seated&entity=route&alert=has_alert&grain=day&from=2026-07-01&to=2026-07-31&date=2026-07-15&n=10&affects=lines&severity=high',
			expect.objectContaining(MAP_URL_REWRITE),
		);
	});

	it('composes a filter write against a requested near-clear instead of resurrecting settled state', () => {
		const { coordinator, navigate } = setup(
			'https://transit.example/map?near=45.5%2C-73.5&nearLabel=Old',
		);

		coordinator.goto('/map', MAP_URL_REWRITE);
		coordinator.writeFilters('route=24');

		expect(navigate.mock.calls.map(([target]) => target)).toEqual(['/map', '/map?route=24']);
	});

	it('stamps byte-identical rewrites with distinct causal receipts while preserving page state', () => {
		const navigate = vi.fn<MapUrlNavigate>();
		const coordinator = createMapUrlCoordinator(
			new URL('https://transit.example/map'),
			navigate,
			() => ({ retained: 'page-state' }),
		);

		coordinator.goto('/map?route=24', MAP_URL_REWRITE);
		coordinator.goto('/map?route=24', MAP_URL_REWRITE);

		const firstState = navigate.mock.calls[0]?.[1].state;
		const secondState = navigate.mock.calls[1]?.[1].state;
		expect(firstState).toMatchObject({
			retained: 'page-state',
			__transitMapUrlRewrite: { revision: 1 },
		});
		expect(secondState).toMatchObject({
			retained: 'page-state',
			__transitMapUrlRewrite: { revision: 2 },
		});
		expect(
			(firstState?.__transitMapUrlRewrite as { ownerId?: string } | undefined)?.ownerId,
		).toBeTypeOf('string');
		expect((secondState?.__transitMapUrlRewrite as { ownerId?: string } | undefined)?.ownerId).toBe(
			(firstState?.__transitMapUrlRewrite as { ownerId?: string } | undefined)?.ownerId,
		);
	});

	it('matches normalized relative requests and consumes each settled echo only once', () => {
		const { coordinator } = setup('https://transit.example/fr/map');
		coordinator.goto('?route=24', MAP_URL_REWRITE);

		expect(coordinator.settle(new URL('https://elsewhere.example/fr/map?route=24'))).toBe('echo');
		expect(coordinator.settle(new URL('https://transit.example/fr/map?route=24'))).toBe('adopt');
	});

	it('retires superseded FIFO tokens when the latest request settles', () => {
		const { coordinator } = setup('https://transit.example/map?near=1%2C2');
		coordinator.goto('/map', MAP_URL_REWRITE);
		coordinator.goto('/map?route=24', MAP_URL_REWRITE);

		expect(coordinator.settle(new URL('https://transit.example/map?route=24'))).toBe('echo');
		expect(coordinator.settle(new URL('https://transit.example/map'))).toBe('adopt');
	});

	it('consumes duplicate requested identities one token at a time in FIFO order', () => {
		const { coordinator } = setup('https://transit.example/map');
		coordinator.goto('?route=24', MAP_URL_REWRITE);
		coordinator.goto('?route=24', MAP_URL_REWRITE);
		const settled = new URL('https://transit.example/map?route=24');

		expect(coordinator.settle(settled)).toBe('echo');
		expect(coordinator.settle(settled)).toBe('echo');
		expect(coordinator.settle(settled)).toBe('adopt');
	});

	it('resets the latest-intent base on idle adoption after an aborted request', () => {
		const { coordinator, navigate } = setup('https://transit.example/map?near=1%2C2');
		coordinator.goto('/map?near=3%2C4', MAP_URL_REWRITE);

		expect(coordinator.settle(new URL('https://transit.example/fr/map?x='))).toBe('adopt');
		coordinator.writeFilters('stop=S');

		expect(navigate).toHaveBeenLastCalledWith(
			'/fr/map?x=&stop=S',
			expect.objectContaining(MAP_URL_REWRITE),
		);
		expect(coordinator.currentUrl().pathname).toBe('/fr/map');
	});

	it('clears every queued URL token idempotently when its map owner is disposed', () => {
		const { coordinator } = setup();
		coordinator.goto('/map?route=24', MAP_URL_REWRITE);
		coordinator.goto('/map?route=55', MAP_URL_REWRITE);

		expect(coordinator).toMatchObject({
			dispose: expect.any(Function),
			pendingRequestCount: expect.any(Function),
		});
		expect(coordinator.pendingRequestCount()).toBe(2);
		coordinator.dispose();
		coordinator.dispose();
		expect(coordinator.pendingRequestCount()).toBe(0);
		expect(coordinator.settle(new URL('https://transit.example/map?route=55'))).toBe('adopt');
	});
});
