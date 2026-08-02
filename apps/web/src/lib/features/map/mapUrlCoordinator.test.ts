import { describe, expect, it, vi } from 'vitest';

import { createMapUrlCoordinator, MAP_URL_REWRITE, type MapUrlNavigate } from './mapUrlCoordinator';

function setup(href = 'https://transit.example/map') {
	const navigate = vi.fn<MapUrlNavigate>();
	const coordinator = createMapUrlCoordinator(new URL(href), navigate);
	return { coordinator, navigate };
}

describe('map URL coordinator', () => {
	it('exposes only the latest-intent composition surface needed by the map owners', () => {
		const { coordinator } = setup();

		expect(Object.keys(coordinator).sort()).toEqual([
			'currentUrl',
			'dispose',
			'goto',
			'settle',
			'writeFilters',
		]);
	});

	it.each(['/fr/map?route=24', '/fr/map?route=55'])(
		'retires every queued token and resets to the settled base before adopting %s',
		(formerTarget) => {
			const { coordinator } = setup('https://transit.example/map?near=1%2C2');
			const settledBase = new URL('https://transit.example/fr/map?settled=1');
			expect(coordinator.settle(settledBase)).toBe('adopt');
			coordinator.goto('/fr/map?route=24', MAP_URL_REWRITE);
			coordinator.goto('/fr/map?route=55', MAP_URL_REWRITE);

			coordinator.dispose();
			coordinator.dispose();

			expect(coordinator.currentUrl().href).toBe(settledBase.href);
			expect(coordinator.settle(new URL(formerTarget, settledBase))).toBe('adopt');
		},
	);

	it('makes every outbound writer inert after disposal', () => {
		const { coordinator, navigate } = setup('https://transit.example/map?settled=1');
		coordinator.dispose();

		coordinator.goto('/map?route=24', MAP_URL_REWRITE);
		coordinator.writeFilters('route=55');

		expect(navigate).not.toHaveBeenCalled();
		expect(coordinator.currentUrl().href).toBe('https://transit.example/map?settled=1');
	});

	it('reports a pending rejection after disposal without restoring its retired intent', async () => {
		let rejectNavigation!: (error: Error) => void;
		const navigation = new Promise<void>((_resolve, reject) => {
			rejectNavigation = reject;
		});
		const reportNavigationFailure = vi.fn();
		const coordinator = createMapUrlCoordinator(
			new URL('https://transit.example/map?settled=1'),
			() => navigation,
			{ reportNavigationFailure },
		);
		const error = new Error('late navigation rejection');
		coordinator.goto('/map?route=24', MAP_URL_REWRITE);
		coordinator.dispose();

		rejectNavigation(error);
		await expect(navigation).rejects.toBe(error);
		await Promise.resolve();

		expect(reportNavigationFailure).toHaveBeenCalledExactlyOnceWith(error);
		expect(coordinator.currentUrl().href).toBe('https://transit.example/map?settled=1');
		expect(coordinator.settle(new URL('https://transit.example/map?route=24'))).toBe('adopt');
	});

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

	it('drops a requested hash from the actual navigation target like the base coordinator', () => {
		const { coordinator, navigate } = setup('https://transit.example/map#detail');

		coordinator.goto('/map?route=24#detail', MAP_URL_REWRITE);

		expect(navigate).toHaveBeenCalledWith(
			'/map?route=24',
			expect.objectContaining(MAP_URL_REWRITE),
		);
		expect(coordinator.settle(new URL('https://transit.example/map?route=24#detail'))).toBe('echo');
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

	it('observes and reports a rejected navigation while retiring its token and latest intent', async () => {
		const navigationError = new Error('map URL navigation failed');
		const navigate = vi.fn<MapUrlNavigate>(() => Promise.reject(navigationError));
		const reportNavigationFailure = vi.fn();
		const initial = new URL('https://transit.example/map?near=1%2C2');
		const coordinator = createMapUrlCoordinator(initial, navigate, { reportNavigationFailure });

		const navigation = coordinator.goto('/map?route=24', MAP_URL_REWRITE) as Promise<void>;
		await expect(navigation).rejects.toBe(navigationError);
		await Promise.resolve();

		expect(reportNavigationFailure).toHaveBeenCalledExactlyOnceWith(navigationError);
		expect(coordinator.currentUrl().href).toBe(initial.href);
		expect(coordinator.settle(new URL('https://transit.example/map?route=24'))).toBe('adopt');
	});
});
