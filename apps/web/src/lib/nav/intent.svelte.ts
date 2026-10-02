import { goto } from '$app/navigation';
import { getLocale, localizeHref, type Locale } from '$lib/i18n';
import { mapSearchFor, type MapFilterTarget } from '$lib/filters';

export type SurfaceKind =
	| 'vehicle'
	| 'trip'
	| 'stop'
	| 'line'
	| 'search'
	| 'network-health'
	| 'map'
	| 'home';

export interface SurfaceTarget {
	kind: SurfaceKind;
	id?: string;
	search?: string;
}

const SURFACE_ROOT: Record<SurfaceKind, string> = {
	home: '/',
	'network-health': '/network',
	map: '/map',
	search: '/search',
	line: '/lines',
	stop: '/stops',
	vehicle: '/map',
	trip: '/map',
};

const ENTITY_DETAIL_ROOT: Partial<Record<SurfaceKind, string>> = {
	line: '/lines',
	stop: '/stop',
	trip: '/trip',
};

function isEntityKind(kind: SurfaceKind): boolean {
	return kind === 'vehicle' || kind === 'stop' || kind === 'line' || kind === 'trip';
}

export function routeFor(target: SurfaceTarget): string {
	const id = target.id?.trim();
	const search = target.search?.replace(/^\?+/, '').trim();
	const withSearch = (path: string): string => (search ? `${path}?${search}` : path);
	if (target.kind === 'vehicle') {
		if (!id) return withSearch(SURFACE_ROOT.vehicle);
		const vehicleSearch = `vehicle=${encodeURIComponent(id)}`;
		return `${SURFACE_ROOT.vehicle}?${search ? `${search}&${vehicleSearch}` : vehicleSearch}`;
	}
	if (isEntityKind(target.kind) && id) {
		const detailRoot = ENTITY_DETAIL_ROOT[target.kind];
		if (detailRoot) return withSearch(`${detailRoot}/${encodeURIComponent(id)}`);
	}
	return withSearch(SURFACE_ROOT[target.kind]);
}

export function mapHrefFor(target: MapFilterTarget, locale: Locale): string {
	return localizeHref(routeFor({ kind: 'map', search: mapSearchFor(target) }), locale);
}

export function openSurface(target: SurfaceTarget): void {
	void goto(localizeHref(routeFor(target), getLocale()));
}
