import { describe, expect, it } from 'vitest';
import { createFilterStore, emptyFilterState, type Chip } from '$lib/filters';

// B3 — clicking a bus must PROMOTE its route to the filter spine: a route= URL
// param lands and a removable route chip appears; discarding that chip clears the
// route filter (which also un-highlights the line in MapHero). This exercises the
// real filter store with the same promotion logic MapHero.promoteVehicleRoute
// runs (resolve route via the live byVehicleId index, then store.addRoute), and
// asserts the URL side-channel + the chip list + the discard path.

/** Minimal stand-in for live.index.byVehicleId — the seam MapHero resolves from. */
function fakeIndex(map: Record<string, { route?: string }>) {
	return {
		byVehicleId: new Map(Object.entries(map)),
	};
}

/** Mirror of MapHero.promoteVehicleRoute (resolve via index, then addRoute). */
function promoteVehicleRoute(
	store: ReturnType<typeof createFilterStore>,
	index: ReturnType<typeof fakeIndex>,
	vehicleId: string,
): void {
	const route = index.byVehicleId.get(vehicleId)?.route;
	if (route) store.addRoute(route);
}

describe('click-a-bus route promotion (B3)', () => {
	it('promotes the clicked bus route to the store and emits a route= URL param', () => {
		let lastSearch = '';
		const store = createFilterStore(emptyFilterState(), (s) => (lastSearch = s));
		const index = fakeIndex({ 'bus-1': { route: '165' } });

		// Click selects the vehicle then promotes its route (MapHero.addSelectionFilter).
		store.addVehicle('bus-1');
		promoteVehicleRoute(store, index, 'bus-1');

		// The route is in the store…
		expect(store.routes.has('165')).toBe(true);
		// …a removable route chip renders…
		expect(store.chips).toContainEqual<Chip>({ kind: 'route', value: '165' });
		// …and the canonical URL carries the route= param (the deep-link).
		expect(new URLSearchParams(lastSearch).get('route')).toBe('165');
		expect(new URLSearchParams(lastSearch).get('vehicle')).toBe('bus-1');
	});

	it('discarding the route chip at the filter level clears the route filter and param', () => {
		let lastSearch = '';
		const store = createFilterStore(emptyFilterState(), (s) => (lastSearch = s));
		const index = fakeIndex({ 'bus-1': { route: '165' } });

		store.addVehicle('bus-1');
		promoteVehicleRoute(store, index, 'bus-1');
		expect(store.routes.has('165')).toBe(true);

		// Discard the chip (MapFilters.removeRoute → store.removeRoute).
		const routeChip = store.chips.find(
			(c): c is Extract<Chip, { kind: 'route' }> => c.kind === 'route',
		);
		expect(routeChip).toBeDefined();
		store.removeChip(routeChip!);

		// The route filter (and its param) are gone; the vehicle selection persists.
		expect(store.routes.has('165')).toBe(false);
		expect(store.chips).not.toContainEqual<Chip>({ kind: 'route', value: '165' });
		expect(new URLSearchParams(lastSearch).get('route')).toBeNull();
		expect(new URLSearchParams(lastSearch).get('vehicle')).toBe('bus-1');
	});

	it('adds no route chip for a bus with no route id (honest, no fabricated filter)', () => {
		let lastSearch = '';
		const store = createFilterStore(emptyFilterState(), (s) => (lastSearch = s));
		const index = fakeIndex({ 'bus-9': {} });

		store.addVehicle('bus-9');
		promoteVehicleRoute(store, index, 'bus-9');

		expect(store.routes.size).toBe(0);
		expect(store.chips.some((c) => c.kind === 'route')).toBe(false);
		expect(new URLSearchParams(lastSearch).get('route')).toBeNull();
	});
});
