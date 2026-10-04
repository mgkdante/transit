import { adapter, type AdapterCtx } from '$lib/v1/adapter';
import { providerOf } from '$lib/v1/adapter/r2.core';
import type { RouteFile, RoutesIndex, StopFile, StopsIndex } from '$lib/v1/schemas';
import { isSlimStopsIndex, toSlimStopsIndex, type SlimStopsIndex } from './stopsSlim';

export async function getRoutesIndex(ctx?: AdapterCtx): Promise<RoutesIndex> {
	return adapter.static.routesIndex(ctx);
}

export async function getRoute(routeId: string, ctx?: AdapterCtx): Promise<RouteFile | null> {
	return adapter.static.route(routeId, ctx);
}

export async function getStopsIndex(ctx?: AdapterCtx): Promise<StopsIndex> {
	return adapter.static.stopsIndex(ctx);
}

export async function getStopsIndexSlim(ctx?: AdapterCtx): Promise<SlimStopsIndex> {
	const fetchFn = ctx?.fetch ?? fetch;
	try {
		const res = await fetchFn(`/api/stops/slim?provider=${providerOf(ctx)}`, {
			signal: ctx?.signal,
		});
		if (res.ok) {
			const body: unknown = await res.json();
			if (isSlimStopsIndex(body)) return body;
		}
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
	}
	if (ctx?.signal?.aborted) {
		throw new DOMException('getStopsIndexSlim aborted', 'AbortError');
	}
	return toSlimStopsIndex(await adapter.static.stopsIndex(ctx));
}

export async function getStop(stopId: string, ctx?: AdapterCtx): Promise<StopFile | null> {
	return adapter.static.stop(stopId, ctx);
}
