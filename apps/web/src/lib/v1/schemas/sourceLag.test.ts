import { describe, it, expect } from 'vitest';
import { ManifestLiveFilesSchema } from './manifest';
import { liveTimingFor } from '#lib/components/map/liveTiming.ts';

describe('live source lag contract', () => {
	it('defaults old manifests to zero and derives provider timing', () => {
		const old = ManifestLiveFilesSchema.parse({ generated_utc: '2026-11-09T12:00:00Z', ttl_s: 20 });
		expect(old.source_lag_s).toBe(0);
		expect(liveTimingFor({ files: { live: old } })).toEqual({
			ttlS: 20,
			sourceLagS: 0,
			staleCutoffS: 150,
			horizonS: 70,
		});
		const oc = ManifestLiveFilesSchema.parse({ ...old, source_lag_s: 60 });
		expect(liveTimingFor({ files: { live: oc } })).toEqual({
			ttlS: 20,
			sourceLagS: 60,
			staleCutoffS: 210,
			horizonS: 130,
		});
	});
	it.each([-1, 1.5, Infinity, NaN])('rejects invalid lag %s', (source_lag_s) => {
		expect(
			ManifestLiveFilesSchema.safeParse({ generated_utc: '2026-11-09T12:00:00Z', source_lag_s })
				.success,
		).toBe(false);
	});
});
