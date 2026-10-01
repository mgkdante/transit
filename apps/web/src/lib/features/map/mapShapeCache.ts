import type { RouteFile } from '$lib/v1';
import type { Vehicle } from '$lib/v1/schemas';
import {
	bestShapeForPoint,
	routeShapes,
	type Coord,
	type RouteShapes,
	type ShapeResolver,
} from '$lib/components/map';

export const MAX_CACHED_ROUTE_SHAPES = 200;

export interface ShapeCacheManager {
	remember(route: RouteFile): void;
	prefetch(vehicles: readonly Vehicle[]): void;
	shapeFor: ShapeResolver & { revision?: () => number };
}

export function createShapeCacheManager(
	getRoute: (routeId: string) => Promise<RouteFile | null>,
): ShapeCacheManager {
	const routeShapeCache = new Map<string, { generatedUtc: string; shapes: RouteShapes }>();
	const routeShapeRequested = new Map<string, symbol>();
	const rememberedRoutes = new WeakSet<RouteFile>();
	let revision = 0;

	function cacheRoute(id: string, route: RouteFile): void {
		const cached = routeShapeCache.get(id);
		if (
			cached &&
			((cached.generatedUtc === route.generated_utc && rememberedRoutes.has(route)) ||
				Date.parse(route.generated_utc) < Date.parse(cached.generatedUtc))
		)
			return;
		const shapes = routeShapes(route);
		rememberedRoutes.add(route);
		routeShapeRequested.set(id, Symbol());
		if (!cached && routeShapeCache.size >= MAX_CACHED_ROUTE_SHAPES) {
			const oldest = routeShapeCache.keys().next().value;
			if (oldest != null) {
				routeShapeCache.delete(oldest);
				routeShapeRequested.delete(oldest);
				revision += 1;
			}
		}
		routeShapeCache.set(id, { generatedUtc: route.generated_utc, shapes });
		if (shapes.length > 0 || (cached?.shapes.length ?? 0) > 0) revision += 1;
	}

	function prefetch(vehicles: readonly Vehicle[]): void {
		for (const v of vehicles) {
			const id = v.route;
			if (id == null || id === '') continue;
			if (routeShapeRequested.has(id)) continue;
			const request = Symbol();
			routeShapeRequested.set(id, request);
			void getRoute(id)
				.then((route) => {
					if (routeShapeRequested.get(id) !== request) return;
					if (route) cacheRoute(id, route);
				})
				.catch(() => {
					if (routeShapeRequested.get(id) !== request) return;
					routeShapeRequested.delete(id);
					revision += 1;
				});
		}
	}

	const shapeFor: ShapeCacheManager['shapeFor'] = (feature) => {
		const routeId = feature.properties.route;
		if (!routeId) return null;
		const shapes = routeShapeCache.get(routeId)?.shapes;
		if (!shapes || shapes.length === 0) return null;
		return bestShapeForPoint(shapes, feature.geometry.coordinates as Coord);
	};
	shapeFor.revision = () => revision;

	return { prefetch, remember: (route) => cacheRoute(route.id, route), shapeFor };
}
