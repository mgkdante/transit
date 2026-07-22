import { labelsPort, manifestPort } from './r2.core';
import type { ContentAdapter } from './types';

function deferredPort<Module, Port extends object>(
	load: () => Promise<Module>,
	select: (module: Module) => Port,
	keys: { readonly [Key in keyof Port]: true },
): Port {
	const port = {} as Record<keyof Port, unknown>;
	for (const key of Object.keys(keys) as (keyof Port)[]) {
		port[key] = (...args: unknown[]) =>
			load().then((module) => {
				const method = select(module)[key] as (...methodArgs: unknown[]) => Promise<unknown>;
				return method(...args);
			});
	}
	return port as Port;
}

const loadLive = () => import('./r2.live');
const loadStatic = () => import('./r2.static');
const loadHistoric = () => import('./r2.historic');

/**
 * Stable R2 adapter facade. Manifest and labels stay in the boot closure; each
 * data tier crosses one literal dynamic-import boundary on first use.
 */
export const r2Adapter: ContentAdapter = {
	manifest: manifestPort,
	labels: labelsPort,
	live: deferredPort(loadLive, (module) => module.livePort, {
		vehicles: true,
		trips: true,
		stopDepartures: true,
		alerts: true,
		network: true,
	}),
	static: deferredPort(loadStatic, (module) => module.staticPort, {
		routesIndex: true,
		route: true,
		stopsIndex: true,
		stop: true,
	}),
	historic: deferredPort(loadHistoric, (module) => module.historicPort, {
		historyIndex: true,
		networkHistoryIndex: true,
		hotspotsHistoryIndex: true,
		repeatOffendersHistoryIndex: true,
		lineHistoryDirectory: true,
		stopHistoryDirectory: true,
		lineHistoryIndex: true,
		stopHistoryIndex: true,
		networkHistoryPartition: true,
		lineHistoryPartition: true,
		stopHistoryPartition: true,
		hotspotsHistoryDay: true,
		repeatOffendersHistoryDay: true,
		alertArchiveIndex: true,
		alertArchivePage: true,
		networkTrend: true,
		hotspots: true,
		repeatOffenders: true,
		alertHistory: true,
		receiptsIndex: true,
		routeReliabilityIndex: true,
		receipt: true,
		routeReliability: true,
		stopReliability: true,
	}),
	basemap: deferredPort(loadStatic, (module) => module.basemapPort, { get: true }),
	provenance: deferredPort(loadHistoric, (module) => module.provenancePort, { get: true }),
	dataHealth: deferredPort(loadLive, (module) => module.dataHealthPort, { get: true }),
};
