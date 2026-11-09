import { r2Adapter } from './r2';

export const adapter = r2Adapter;

export type { AdapterCtx } from './types';

import type { LiveReader, LiveReadContext } from '#lib/v1/live/store.svelte.ts';
import { livePollDelayMs } from '#lib/v1/live/polling.ts';
import { DEFAULT_LIVE_TTL_S } from '#lib/v1/freshness.ts';

function liveContext(context: LiveReadContext) {
	const ttlMs = Math.max(1, context.manifest.files.live.ttl_s ?? DEFAULT_LIVE_TTL_S) * 1000;
	return {
		manifest: context.manifest,
		signal: context.signal,
		onResponseHeaders: (headers: Headers) =>
			context.onPollDelayMs?.(livePollDelayMs(headers, ttlMs)),
	};
}

export const liveReader: LiveReader = {
	vehicles: (context) => adapter.live.vehicles(liveContext(context)),
	trips: (context) => adapter.live.trips(liveContext(context)),
	stopDepartures: (context) => adapter.live.stopDepartures(liveContext(context)),
	alerts: (context) => adapter.live.alerts(liveContext(context)),
	network: (context) => adapter.live.network(liveContext(context)),
};
