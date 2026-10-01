import {
	clearNearTargetSearchParams,
	setNearTargetSearchParams,
	type MapNearTarget,
} from '$lib/search/mapNear';
import { clearMapFocusSearchParams } from '$lib/search/mapFocus';

function toGotoPath(searchParams: URLSearchParams, pathname: string): string {
	const next = searchParams.toString();
	return next ? `?${next}` : pathname;
}

export function buildNearTargetSearch(
	current: URLSearchParams,
	pathname: string,
	target: MapNearTarget,
): string {
	const nextSearchParams = new URLSearchParams(current);
	setNearTargetSearchParams(nextSearchParams, target);
	return toGotoPath(nextSearchParams, pathname);
}

export function clearNearTargetSearch(current: URLSearchParams, pathname: string): string {
	const nextSearchParams = new URLSearchParams(current);
	clearNearTargetSearchParams(nextSearchParams);
	return toGotoPath(nextSearchParams, pathname);
}

export function buildFocusClearSearch(current: URLSearchParams, pathname: string): string {
	const nextSearchParams = new URLSearchParams(current);
	clearMapFocusSearchParams(nextSearchParams);
	return toGotoPath(nextSearchParams, pathname);
}
