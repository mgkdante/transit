import { vi } from 'vitest';
import type { LiveReader } from '../store.svelte';

// Each reader owns its responses and call history. Unconfigured reads fail closed.
export function createMemoryLiveReader() {
	const missing = async (): Promise<never> => {
		throw new Error('No in-memory live response configured');
	};
	return {
		vehicles: vi.fn<LiveReader['vehicles']>(missing),
		trips: vi.fn<LiveReader['trips']>(missing),
		stopDepartures: vi.fn<LiveReader['stopDepartures']>(missing),
		alerts: vi.fn<LiveReader['alerts']>(missing),
		network: vi.fn<LiveReader['network']>(missing),
	};
}
