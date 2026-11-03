import type { MapFocus } from '$lib/search/mapFocus';

export interface MapFocusReadinessSources {
	readonly stopsSettled: boolean;
	readonly vehiclesPhase: 'idle' | 'loading' | 'ready' | 'failed';
	readonly selectedRouteIds: readonly string[];
	readonly selectedRoutesSettled: boolean;
	readonly focusedRouteId: string | null;
	readonly focusedRouteSettled: boolean;
}

export function isMapFocusReady(focus: MapFocus, sources: MapFocusReadinessSources): boolean {
	if (focus.kind === 'stop') return sources.stopsSettled;
	if (focus.kind === 'vehicle')
		return sources.vehiclesPhase === 'ready' || sources.vehiclesPhase === 'failed';
	if (sources.selectedRouteIds.includes(focus.id)) return sources.selectedRoutesSettled;
	if (sources.focusedRouteId === focus.id) return sources.focusedRouteSettled;
	return true;
}
