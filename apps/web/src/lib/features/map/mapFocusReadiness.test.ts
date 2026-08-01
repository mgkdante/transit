import { describe, expect, it } from 'vitest';

import type { MapFocus } from '$lib/search/mapFocus';
import { isMapFocusReady, type MapFocusReadinessSources } from './mapFocusReadiness';

const base: MapFocusReadinessSources = {
	stopsSettled: false,
	vehiclesPhase: 'idle',
	selectedRouteIds: [],
	selectedRoutesSettled: false,
	focusedRouteId: null,
	focusedRouteSettled: false,
};

function ready(focus: MapFocus, overrides: Partial<MapFocusReadinessSources>): boolean {
	return isMapFocusReady(focus, { ...base, ...overrides });
}

describe('map focus readiness', () => {
	it('waits for the stops index before consuming a stop focus', () => {
		expect(ready({ kind: 'stop', id: 'S' }, { stopsSettled: false })).toBe(false);
		expect(ready({ kind: 'stop', id: 'S' }, { stopsSettled: true })).toBe(true);
	});

	it('waits for a ready or failed live-vehicles snapshot before consuming a vehicle focus', () => {
		expect(ready({ kind: 'vehicle', id: 'V' }, { vehiclesPhase: 'idle' })).toBe(false);
		expect(ready({ kind: 'vehicle', id: 'V' }, { vehiclesPhase: 'loading' })).toBe(false);
		expect(ready({ kind: 'vehicle', id: 'V' }, { vehiclesPhase: 'ready' })).toBe(true);
		expect(ready({ kind: 'vehicle', id: 'V' }, { vehiclesPhase: 'failed' })).toBe(true);
	});

	it('waits for the identity-owning selected route resource', () => {
		const focus = { kind: 'route', id: '24' } as const;
		expect(
			ready(focus, {
				selectedRouteIds: ['24'],
				selectedRoutesSettled: false,
				focusedRouteId: '24',
				focusedRouteSettled: true,
			}),
		).toBe(false);
		expect(ready(focus, { selectedRouteIds: ['24'], selectedRoutesSettled: true })).toBe(true);
	});

	it('uses the matching focused route resource when no selected route owns the id', () => {
		const focus = { kind: 'route', id: '24' } as const;
		expect(ready(focus, { focusedRouteId: '24', focusedRouteSettled: false })).toBe(false);
		expect(ready(focus, { focusedRouteId: '24', focusedRouteSettled: true })).toBe(true);
	});

	it('treats a route with no matching resource as an immediate terminal miss', () => {
		expect(
			ready(
				{ kind: 'route', id: '24' },
				{
					selectedRouteIds: ['55'],
					selectedRoutesSettled: true,
					focusedRouteId: '55',
					focusedRouteSettled: true,
				},
			),
		).toBe(true);
	});
});
